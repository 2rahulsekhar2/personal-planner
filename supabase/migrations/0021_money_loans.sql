-- Money: a loan. It is an expense item paid every month (the EMI) that also knows what was borrowed, so the app
-- can say what is still owed and when it ends. money_items.amount stays the EMI; loan holds the rest, as the app wrote it:
--   {"principal": 500000, "rate": 9.5, "kind": "reducing", "months": 60, "balance": 310000, "balance_on": "2026-11-01"}
-- kind is "reducing" (interest on what is still owed) or "flat" (interest on the amount taken, every month).
-- balance and balance_on are optional: "the lender says this much was owed on this date", and the sums carry on from there.
-- Null means the item is not a loan.

alter table public.money_items add column if not exists loan jsonb;
alter table public.money_items drop constraint if exists money_items_loan_object;
alter table public.money_items add constraint money_items_loan_object
  check (loan is null or jsonb_typeof(loan) = 'object');

-- Same function as in 0020, now carrying loan: a shared loan goes through approval with the rest of the item.
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
    insert into public.money_items (user_id, circle_id, kind, name, amount, amount_steps, loan, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes)
    values (p.created_by, p.circle_id, r.kind, r.name, r.amount, r.amount_steps, r.loan, r.freq, r.start_date, r.end_date, r.bank_id, r.type_id, r.increase_id, coalesce(r.person_ids, '{}'), r.notes);
  else
    update public.money_items
       set kind = r.kind, name = r.name, amount = r.amount, amount_steps = r.amount_steps, loan = r.loan, freq = r.freq, start_date = r.start_date, end_date = r.end_date,
           bank_id = r.bank_id, type_id = r.type_id, increase_id = r.increase_id, person_ids = coalesce(r.person_ids, '{}'), notes = r.notes
     where id = p.item_id and circle_id = p.circle_id;
  end if;
end $$;

-- Replacing a function keeps its grants, but say it again: this one is for the approval functions only.
revoke execute on function public.money_apply(public.money_proposals) from public, anon, authenticated;
