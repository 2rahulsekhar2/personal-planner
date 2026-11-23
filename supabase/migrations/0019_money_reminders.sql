-- Money reminders: a push when a bill falls due, and when a shared budget needs you or answers you.
-- They are rows in the existing reminders table, so the sender that already runs every minute delivers them.
--   * Approvals are written here, by a trigger, the moment a request is made or settled.
--   * Bills are written by the app's reminder job (it knows how items repeat): one for the morning an expense
--     falls due. This file only cancels one when the bill is paid, skipped or deleted first.

-- A reminder is now about an appointment, a task, or something in Money. money_ref names the Money subject
-- ("bill:<item>:<date>", "proposal:<id>:ask") and keeps a person from being told the same thing twice.
alter table public.reminders add column if not exists money_ref text;
do $$
declare c text;
begin
  -- The original rule, "an appointment or a task, never both", was created without a name.
  for c in select conname from pg_constraint
            where conrelid = 'public.reminders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%appointment_id%task_id%' loop
    execute format('alter table public.reminders drop constraint %I', c);
  end loop;
end $$;
alter table public.reminders add constraint reminders_one_subject check (num_nonnulls(appointment_id, task_id, money_ref) = 1);
create unique index if not exists reminders_money_ref on public.reminders (user_id, money_ref);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
-- A new request tells everyone it waits on. A request settled by someone else tells the person who asked.
-- A request carried out at once (nobody else to ask) tells nobody: the asker did it themself.
create or replace function public.money_notify_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  circle text;
  asker text;
  what text;
begin
  select name into circle from public.circles where id = new.circle_id;
  what := case new.action when 'add' then 'add ' when 'change' then 'change ' else 'delete ' end
    || coalesce(new.payload ->> 'name', (select name from public.money_items where id = new.item_id), 'an item')
    || coalesce(', ₹' || round((new.payload ->> 'amount')::numeric)::text, '');
  if tg_op = 'INSERT' then
    select split_part(email, '@', 1) into asker from public.circle_members where circle_id = new.circle_id and user_id = new.created_by;
    insert into public.reminders (user_id, money_ref, send_at, title, body)
    select u, 'proposal:' || new.id || ':ask', now(), 'Approval needed in ' || circle,
           coalesce(asker, 'A member') || ' asked to ' || what || '. Open Money to approve or reject.'
      from public.money_waiting_on(new) u
    on conflict do nothing;
    return new;
  end if;
  if new.status <> 'pending' then
    -- Settled: whoever has not been told yet no longer needs asking.
    update public.reminders set status = 'cancelled' where money_ref = 'proposal:' || new.id || ':ask' and status = 'pending';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') and auth.uid() is distinct from new.created_by then
    insert into public.reminders (user_id, money_ref, send_at, title, body)
    values (new.created_by, 'proposal:' || new.id || ':' || new.status, now(),
            case new.status when 'approved' then 'Approved in ' else 'Rejected in ' end || circle,
            case new.status when 'approved' then 'Your request to ' || what || ' is now in the budget.'
                 else 'Your request to ' || what || ' was rejected: ' || coalesce(new.reason, 'no reason given') || '.' end)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists money_notify_request on public.money_proposals;
create trigger money_notify_request after insert or update of status on public.money_proposals
for each row execute function public.money_notify_request();

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------
-- Paid or skipped before the reminder went out: there is nothing left to remind about.
create or replace function public.money_cancel_bill_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'money_items' then
    update public.reminders set status = 'cancelled' where status = 'pending' and money_ref like 'bill:' || old.id || ':%';
    return old;
  end if;
  if new.paid_at is not null or new.skipped then
    update public.reminders set status = 'cancelled'
     where status = 'pending' and money_ref like 'bill:' || new.item_id || ':' || to_char(new.month, 'YYYY-MM') || '-%';
  end if;
  return new;
end $$;

drop trigger if exists money_cancel_bill_reminder on public.money_entries;
create trigger money_cancel_bill_reminder after insert or update on public.money_entries
for each row execute function public.money_cancel_bill_reminder();
drop trigger if exists money_cancel_bill_reminder on public.money_items;
create trigger money_cancel_bill_reminder after delete on public.money_items
for each row execute function public.money_cancel_bill_reminder();

-- Trigger functions only: nothing here is for the app to call.
revoke execute on function public.money_notify_request(), public.money_cancel_bill_reminder() from public, anon, authenticated;
