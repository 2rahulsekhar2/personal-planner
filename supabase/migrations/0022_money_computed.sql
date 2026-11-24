-- Money: a computed item. Its month is worked out from other items by a formula, for example Salary - Tax or
-- (Rent + Power) * 50%. money_items.formula holds the formula as the app wrote it, piece by piece:
--   [{"t": "item", "id": "<money_items.id>"}, {"t": "op", "v": "-"}, {"t": "num", "v": 2000}, {"t": "op", "v": "*"}, {"t": "pct", "v": 10}]
-- op is one of + - * / ( ). An item used in a formula is a part: it is no longer a line of its own, and counts
-- only through the item that uses it. Null means the item is not computed. amount is then unused (0).
-- shortcut: nothing here stops a formula naming an item of another budget or a deleted one; the app reads either as 0 and says so.

alter table public.money_items add column if not exists formula jsonb;
alter table public.money_items drop constraint if exists money_items_formula_array;
alter table public.money_items add constraint money_items_formula_array
  check (formula is null or jsonb_typeof(formula) = 'array');

-- Same function as in 0021, now carrying formula: a shared computed item goes through approval like any other.
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
    insert into public.money_items (user_id, circle_id, kind, name, amount, amount_steps, loan, formula, freq, start_date, end_date, bank_id, type_id, increase_id, person_ids, notes)
    values (p.created_by, p.circle_id, r.kind, r.name, r.amount, r.amount_steps, r.loan, r.formula, r.freq, r.start_date, r.end_date, r.bank_id, r.type_id, r.increase_id, coalesce(r.person_ids, '{}'), r.notes);
  else
    update public.money_items
       set kind = r.kind, name = r.name, amount = r.amount, amount_steps = r.amount_steps, loan = r.loan, formula = r.formula, freq = r.freq, start_date = r.start_date, end_date = r.end_date,
           bank_id = r.bank_id, type_id = r.type_id, increase_id = r.increase_id, person_ids = coalesce(r.person_ids, '{}'), notes = r.notes
     where id = p.item_id and circle_id = p.circle_id;
  end if;
end $$;

-- Replacing a function keeps its grants, but say it again: this one is for the approval functions only.
revoke execute on function public.money_apply(public.money_proposals) from public, anon, authenticated;
