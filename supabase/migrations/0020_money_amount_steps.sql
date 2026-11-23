-- Money: an income or expense whose amount changes from a date on.
-- money_items.amount stays the amount from the first date. amount_steps lists the later changes, each "from this
-- date, this amount", as the app wrote them:
--   [{"from": "2026-04-01", "amount": 225000}, {"from": "2027-04-01", "amount": 250000}]
-- A change holds until the next one, or the item's last date. Null or [] means the amount never changes.
-- One month's own figure (money_entries.budget) still wins over all of this for that month.

alter table public.money_items add column if not exists amount_steps jsonb;
alter table public.money_items drop constraint if exists money_items_amount_steps_array;
alter table public.money_items add constraint money_items_amount_steps_array
  check (amount_steps is null or jsonb_typeof(amount_steps) = 'array');

-- Same function as in 0017, now carrying amount_steps: a shared item's changes of amount go through approval
-- with the rest of it.
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
    insert into public.money_items (user_id, circle_id, kind, name, amount, amount_steps, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes)
    values (p.created_by, p.circle_id, r.kind, r.name, r.amount, r.amount_steps, r.freq, r.start_date, r.end_date, r.bank_id, r.type_id, r.increase_id, coalesce(r.person_ids, '{}'), r.notes);
  else
    update public.money_items
       set kind = r.kind, name = r.name, amount = r.amount, amount_steps = r.amount_steps, freq = r.freq, start_date = r.start_date, end_date = r.end_date,
           bank_id = r.bank_id, type_id = r.type_id, increase_id = r.increase_id, person_ids = coalesce(r.person_ids, '{}'), notes = r.notes
     where id = p.item_id and circle_id = p.circle_id;
  end if;
end $$;

-- Replacing a function keeps its grants, but say it again: this one is for the approval functions only.
revoke execute on function public.money_apply(public.money_proposals) from public, anon, authenticated;
