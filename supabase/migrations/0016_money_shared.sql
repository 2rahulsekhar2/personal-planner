-- Money (part 2): a budget shared with a circle, where the members agree on every change.
--   * A family plan belongs to one circle. Its owner (the family admin) turns it on; every member then has Money.
--   * Every money row is private (circle_id null) or belongs to one circle.
--   * A shared income or expense cannot be written directly. Adding, changing or deleting one is a request
--     (money_proposals) that takes effect once every other owner or member has approved it. Viewers do not approve.
--   * Recording what happened (paid, actual amount) needs no approval. Lists (types, increases, people) are
--     edited by any member; a bank only by the person who added it.

-- ---------------------------------------------------------------------------
-- Family plan
-- ---------------------------------------------------------------------------
alter table public.subscriptions add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.subscriptions drop constraint if exists subscriptions_user_id_product_key;
alter table public.subscriptions add constraint subscriptions_family_has_circle check ((plan = 'family') = (circle_id is not null));
-- One personal subscription a person, one family subscription a circle. An owner can hold both.
create unique index subscriptions_personal on public.subscriptions (user_id, product) where circle_id is null;
create unique index subscriptions_family on public.subscriptions (circle_id, product);

drop policy if exists read_my_subscriptions on public.subscriptions;
create policy read_my_subscriptions on public.subscriptions for select
  using (user_id = auth.uid() or (circle_id is not null and public.is_circle_member(circle_id)));

-- Money is on for a person with their own subscription, or in a circle that has a family plan.
create or replace function public.has_money() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions s
                  where s.product = 'money' and s.status = 'active'
                    and ((s.circle_id is null and s.user_id = auth.uid()) or (s.circle_id is not null and public.is_circle_member(s.circle_id))));
$$;

-- This circle has a family plan and I am in it: I may read its budget.
create or replace function public.money_family(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_circle_member(cid)
     and exists (select 1 from public.subscriptions where circle_id = cid and product = 'money' and status = 'active');
$$;

-- ... and I am its owner or a member, not a viewer: I may also take part in it.
create or replace function public.money_family_edit(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.money_family(cid) and public.can_add_to_circle(cid, auth.uid());
$$;

-- The family admin turns the plan on or off. Off hides the shared budget; nothing is deleted.
create or replace function public.money_set_family(p_circle uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.circles where id = p_circle and owner_id = auth.uid()) then
    raise exception 'Only the circle''s owner can change its family plan';
  end if;
  if not exists (select 1 from public.subscriptions where user_id = auth.uid() and circle_id is null and product = 'money' and status = 'active') then
    raise exception 'Turn on Money for yourself first';
  end if;
  insert into public.subscriptions (user_id, product, plan, status, circle_id)
  values (auth.uid(), 'money', 'family', case when p_on then 'active' else 'ended' end, p_circle)
  on conflict (circle_id, product) do update set status = excluded.status, user_id = excluded.user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Private or shared: circle_id on every money table
-- ---------------------------------------------------------------------------
alter table public.money_banks add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.money_types add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.money_increases add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.money_people add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.money_items add column if not exists circle_id uuid references public.circles (id) on delete cascade;
alter table public.money_months add column if not exists circle_id uuid references public.circles (id) on delete cascade;

-- A family person who is also a member of the circle. One row a member; people without an account have null here.
alter table public.money_people add column if not exists member_id uuid references auth.users (id) on delete set null;
create unique index money_people_member on public.money_people (circle_id, member_id);

-- A shared month is planned once every owner and member has marked it: one row each.
alter table public.money_months drop constraint if exists money_months_pkey;
create unique index money_months_one on public.money_months (user_id, month, coalesce(circle_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Policies. For each table: read_* says who sees a row, write_* who may add, change or remove it.
do $$
declare
  t text;
  mine constant text := '(circle_id is null and user_id = auth.uid() and public.has_money())';
  theirs constant text := '(circle_id is not null and public.money_family(circle_id))';
  ours constant text := '(circle_id is not null and public.money_family_edit(circle_id))';
begin
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_items', 'money_months', 'money_entries'] loop
    execute format('drop policy if exists own_%I on public.%I', t, t);
  end loop;
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_items', 'money_months'] loop
    execute format('create policy read_%I on public.%I for select using (%s or %s)', t, t, mine, theirs);
  end loop;
  -- Lists: any owner or member of the circle.
  foreach t in array array['money_types', 'money_increases', 'money_people'] loop
    execute format('create policy write_%I on public.%I for all using (%s or %s) with check (%s or %s)', t, t, mine, ours, mine, ours);
  end loop;
  -- A bank, and a person's own "planned" mark: only whoever added it.
  foreach t in array array['money_banks', 'money_months'] loop
    execute format('create policy write_%I on public.%I for all using (%s or (user_id = auth.uid() and %s)) with check (%s or (user_id = auth.uid() and %s))', t, t, mine, ours, mine, ours);
  end loop;
  -- Incomes and expenses: private ones only. A shared one changes through money_propose and money_decide.
  execute format('create policy write_money_items on public.money_items for all using (%s) with check (%s)', mine, mine);
end $$;

-- A month of an item follows the item. On a shared item anyone taking part records what was paid; the month's
-- own budget and "skip" would change the plan, so they are refused there.
create policy read_money_entries on public.money_entries for select
  using (exists (select 1 from public.money_items i where i.id = item_id));  -- the item's own policy decides
create policy write_money_entries on public.money_entries for all
  using (exists (select 1 from public.money_items i where i.id = item_id
                  and ((i.circle_id is null and i.user_id = auth.uid() and public.has_money()) or (i.circle_id is not null and public.money_family_edit(i.circle_id)))))
  with check (exists (select 1 from public.money_items i where i.id = item_id
                  and ((i.circle_id is null and i.user_id = auth.uid() and public.has_money())
                    or (i.circle_id is not null and public.money_family_edit(i.circle_id) and budget is null and not skipped))));

-- ---------------------------------------------------------------------------
-- Requests and approvals
-- ---------------------------------------------------------------------------
create table public.money_proposals (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  item_id uuid references public.money_items (id) on delete cascade,  -- null: a new item
  action text not null check (action in ('add', 'change', 'delete')),
  payload jsonb not null default '{}',   -- the item as asked for; empty for a delete
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reason text,                           -- why it was rejected
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz
);
create index on public.money_proposals (circle_id, status);

create table public.money_approvals (
  proposal_id uuid not null references public.money_proposals (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  approved_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

alter table public.money_proposals enable row level security;
alter table public.money_approvals enable row level security;
-- Read only. Every write goes through the functions below.
create policy read_money_proposals on public.money_proposals for select using (public.money_family(circle_id));
create policy read_money_approvals on public.money_approvals for select
  using (exists (select 1 from public.money_proposals p where p.id = proposal_id));

-- Who still has to approve: current owners and members other than the person asking, who were already in the
-- circle when the request was made. Someone who joins later does not hold up older requests.
create or replace function public.money_waiting_on(p public.money_proposals) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from public.circle_members m
   where m.circle_id = p.circle_id and m.role <> 'viewer' and (m.expires_at is null or m.expires_at > now())
     and m.user_id <> p.created_by and m.joined_at <= p.created_at
     and not exists (select 1 from public.money_approvals a where a.proposal_id = p.id and a.user_id = m.user_id);
$$;

-- Carry a request out. Internal: called only once the approvals are in.
create or replace function public.money_apply(p public.money_proposals) returns void
language plpgsql security definer set search_path = public as $$
declare r public.money_items;
begin
  -- First, while the row still exists: deleting the item takes its requests with it.
  update public.money_proposals set status = 'approved', decided_at = now() where id = p.id;
  if p.action = 'delete' then
    delete from public.money_items where id = p.item_id and circle_id = p.circle_id;
    return;
  end if;
  r := jsonb_populate_record(null::public.money_items, p.payload);
  if p.action = 'add' then
    insert into public.money_items (user_id, circle_id, kind, name, amount, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes)
    values (p.created_by, p.circle_id, r.kind, r.name, r.amount, r.freq, r.start_date, r.end_date, r.bank_id, r.type_id, r.increase_id, coalesce(r.person_ids, '{}'), r.notes);
  else
    update public.money_items
       set kind = r.kind, name = r.name, amount = r.amount, freq = r.freq, start_date = r.start_date, end_date = r.end_date,
           bank_id = r.bank_id, type_id = r.type_id, increase_id = r.increase_id, person_ids = coalesce(r.person_ids, '{}'), notes = r.notes
     where id = p.item_id and circle_id = p.circle_id;
  end if;
end $$;

-- Ask to add, change or delete a shared item. Returns 'approved' when nobody else has to agree
-- (it has then been carried out), otherwise 'pending'.
create or replace function public.money_propose(p_circle uuid, p_action text, p_item uuid, p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  p public.money_proposals;
  r public.money_items;
begin
  if not public.money_family_edit(p_circle) then raise exception 'You cannot change this circle''s budget'; end if;
  if p_action not in ('add', 'change', 'delete') then raise exception 'Unknown request'; end if;
  if p_action <> 'add' and not exists (select 1 from public.money_items where id = p_item and circle_id = p_circle) then
    raise exception 'That item is not in this circle''s budget';
  end if;
  if p_action <> 'delete' then
    -- Checked now, so that a request cannot fail later in an approver's hands.
    r := jsonb_populate_record(null::public.money_items, p_payload);
    if r.kind is null or r.kind not in ('income', 'expense') or length(trim(coalesce(r.name, ''))) not between 1 and 120
       or r.amount is null or r.amount < 0 or r.start_date is null or (r.end_date is not null and r.end_date < r.start_date)
       or r.freq is null or r.freq not in ('once', 'daily', 'weekly', 'monthly', 'yearly') then
      raise exception 'The item is incomplete';
    end if;
    if (r.bank_id is not null and not exists (select 1 from public.money_banks where id = r.bank_id and circle_id = p_circle))
       or (r.type_id is not null and not exists (select 1 from public.money_types where id = r.type_id and circle_id = p_circle))
       or (r.increase_id is not null and not exists (select 1 from public.money_increases where id = r.increase_id and circle_id = p_circle)) then
      raise exception 'The bank, type and yearly increase must belong to this circle';
    end if;
  end if;
  insert into public.money_proposals (circle_id, item_id, action, payload)
  values (p_circle, case when p_action = 'add' then null else p_item end, p_action, case when p_action = 'delete' then '{}'::jsonb else p_payload end)
  returning * into p;
  if not exists (select 1 from public.money_waiting_on(p)) then
    perform public.money_apply(p);
    return 'approved';
  end if;
  return 'pending';
end $$;

-- Approve or reject someone else's request. A rejection needs a reason and sends it back to the person who asked.
-- The family admin can approve a rejected request, which settles it.
create or replace function public.money_decide(p_proposal uuid, p_approve boolean, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare p public.money_proposals;
begin
  select * into p from public.money_proposals where id = p_proposal for update;
  if p.id is null or not public.money_family_edit(p.circle_id) then raise exception 'Request not found'; end if;
  if p.created_by = auth.uid() then raise exception 'You cannot decide your own request'; end if;
  if p.status = 'rejected' and p_approve and exists (select 1 from public.circles where id = p.circle_id and owner_id = auth.uid()) then
    perform public.money_apply(p);
    update public.money_proposals set decided_by = auth.uid() where id = p.id;
    return 'approved';
  end if;
  if p.status <> 'pending' then raise exception 'This request is already settled'; end if;
  if not p_approve then
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Say why you are rejecting it'; end if;
    update public.money_proposals set status = 'rejected', reason = trim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p.id;
    return 'rejected';
  end if;
  insert into public.money_approvals (proposal_id, user_id) values (p.id, auth.uid()) on conflict do nothing;
  if not exists (select 1 from public.money_waiting_on(p)) then
    perform public.money_apply(p);
    return 'approved';
  end if;
  return 'pending';
end $$;

-- Take back my own request, while it is waiting or after it was rejected.
create or replace function public.money_withdraw(p_proposal uuid) returns void
language sql security definer set search_path = public as $$
  update public.money_proposals set status = 'withdrawn', decided_at = now()
   where id = p_proposal and created_by = auth.uid() and status in ('pending', 'rejected');
$$;

-- Two records of one person become one: every item for the first is now for the second, and the first is removed.
-- In a circle only the family admin may do this; among private people, their owner.
create or replace function public.money_merge_people(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.money_people;
  b public.money_people;
begin
  select * into a from public.money_people where id = p_from;
  select * into b from public.money_people where id = p_into;
  if a.id is null or b.id is null or a.id = b.id or a.circle_id is distinct from b.circle_id then raise exception 'Pick two people from the same family'; end if;
  if a.circle_id is null and (a.user_id <> auth.uid() or b.user_id <> auth.uid() or not public.has_money()) then raise exception 'Person not found'; end if;
  if a.circle_id is not null and not (public.money_family(a.circle_id) and exists (select 1 from public.circles where id = a.circle_id and owner_id = auth.uid())) then
    raise exception 'Only the family admin can merge people';
  end if;
  update public.money_items
     set person_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(array_replace(person_ids, p_from, p_into)) x)
   where p_from = any (person_ids) and circle_id is not distinct from a.circle_id;
  delete from public.money_people where id = p_from;
end $$;

-- money_apply and money_waiting_on are for the functions above only.
revoke execute on function public.money_apply(public.money_proposals), public.money_waiting_on(public.money_proposals) from public, anon, authenticated;
grant select on public.money_proposals, public.money_approvals to authenticated;
grant all on public.money_proposals, public.money_approvals to service_role;
grant execute on function
  public.has_money(), public.money_family(uuid), public.money_family_edit(uuid), public.money_set_family(uuid, boolean),
  public.money_propose(uuid, text, uuid, jsonb), public.money_decide(uuid, boolean, text), public.money_withdraw(uuid),
  public.money_merge_people(uuid, uuid)
to authenticated;
