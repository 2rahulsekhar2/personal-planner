-- Activity log: who did what, for the Activity page.
-- Rows are written only by the triggers below. You can read your own rows, and rows
-- for items shared with a circle you belong to. Private items stay private.

create table public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,                 -- copied: someone who left a circle can no longer be looked up
  circle_id uuid,                      -- null: private. No foreign key, so history outlives a deleted circle (then only its author can read it)
  kind text not null check (kind in ('appointment', 'task', 'circle')),
  action text not null,
  title text not null,                 -- the item's title, or the circle's name, at the time
  created_at timestamptz not null default now()
);
create index on public.activity_log (user_id, created_at desc);
create index on public.activity_log (circle_id, created_at desc) where circle_id is not null;

alter table public.activity_log enable row level security;
create policy read_activity on public.activity_log for select
  using (user_id = auth.uid() or (circle_id is not null and public.is_circle_member(circle_id)));
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- Appointments and tasks. The argument is the kind: 'appointment' or 'task'.
create or replace function public.log_item_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  r jsonb := coalesce(n, o);
  who text;
  act text;
begin
  -- No user row means the account is being deleted and this is its cascade: nothing to log.
  select email into who from auth.users where id = (r->>'user_id')::uuid;
  if who is null then return null; end if;

  if tg_op = 'INSERT' then act := 'added';
  elsif tg_op = 'DELETE' then act := 'deleted';
  elsif (n - 'updated_at') = (o - 'updated_at') then return null;
  elsif n->>'circle_id' is distinct from o->>'circle_id' then
    -- The circle that loses the item is told too.
    if o->>'circle_id' is not null then
      insert into public.activity_log (user_id, email, circle_id, kind, action, title)
      values ((r->>'user_id')::uuid, who, (o->>'circle_id')::uuid, tg_argv[0], 'unshared', r->>'title');
    end if;
    if n->>'circle_id' is null then return null; end if;
    act := 'shared';
  elsif n->>'status' = 'cancelled' and o->>'status' <> 'cancelled' then act := 'cancelled';
  elsif n->>'outcome' is distinct from o->>'outcome' and n->>'outcome' is not null then act := n->>'outcome';  -- done, not_done
  elsif n->>'state' is distinct from o->>'state' then act := n->>'state';                                      -- completed, dismissed, pending
  elsif n->>'starts_at' is distinct from o->>'starts_at' or n->>'ends_at' is distinct from o->>'ends_at'
     or n->>'due_date' is distinct from o->>'due_date' or n->>'due_time' is distinct from o->>'due_time' then act := 'rescheduled';
  else act := 'edited';
  end if;

  insert into public.activity_log (user_id, email, circle_id, kind, action, title)
  values ((r->>'user_id')::uuid, who, (r->>'circle_id')::uuid, tg_argv[0], act, r->>'title');
  return null;
end $$;

create trigger appointments_activity after insert or update or delete on public.appointments
for each row execute function public.log_item_activity('appointment');
create trigger tasks_activity after insert or update or delete on public.tasks
for each row execute function public.log_item_activity('task');

-- Circle membership: created, joined, left, removed.
create or replace function public.log_member_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.circle_members := coalesce(new, old);
  circle_name text;
begin
  -- No circle row means the whole circle is being deleted: log_circle_deleted covers that.
  select name into circle_name from public.circles where id = m.circle_id;
  if circle_name is null or not exists (select 1 from auth.users where id = m.user_id) then return null; end if;
  insert into public.activity_log (user_id, email, circle_id, kind, action, title)
  values (
    m.user_id, m.email, m.circle_id, 'circle',
    case when tg_op = 'INSERT' then case when m.role = 'owner' then 'created' else 'joined' end
         when auth.uid() = m.user_id then 'left'
         else 'removed' end,
    circle_name
  );
  return null;
end $$;

create trigger circle_members_activity after insert or delete on public.circle_members
for each row execute function public.log_member_activity();

create or replace function public.log_circle_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log (user_id, email, circle_id, kind, action, title)
  select u.id, u.email, old.id, 'circle', 'deleted', old.name from auth.users u where u.id = old.owner_id and u.email is not null;
  return null;
end $$;

create trigger circles_activity after delete on public.circles
for each row execute function public.log_circle_deleted();

revoke all on function public.log_item_activity(), public.log_member_activity(), public.log_circle_deleted() from public, anon, authenticated;

-- Start the log with what the tables already know: when each item was added and when each member joined.
insert into public.activity_log (user_id, email, circle_id, kind, action, title, created_at)
select a.user_id, u.email, a.circle_id, 'appointment', 'added', a.title, a.created_at
  from public.appointments a join auth.users u on u.id = a.user_id where u.email is not null
union all
select t.user_id, u.email, t.circle_id, 'task', 'added', t.title, t.created_at
  from public.tasks t join auth.users u on u.id = t.user_id where u.email is not null
union all
select m.user_id, m.email, m.circle_id, 'circle', case when m.role = 'owner' then 'created' else 'joined' end, c.name, m.joined_at
  from public.circle_members m join public.circles c on c.id = m.circle_id
order by 7;
