-- Money (part 2): import, export and backups.
--   * money_snapshot() returns everything a person keeps in Money as one JSON value: it is what an export reads
--     and what a backup stores.
--   * money_replace() swaps a person's Money data for a new set in one transaction, after saving what was there
--     as a backup. An Excel import and going back to a backup both run through it.
-- The functions run as the caller, so the row-level rules on every money table still apply.

create table public.money_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),  -- what was about to happen when it was taken
  data jsonb not null,                                                -- a money_snapshot()
  created_at timestamptz not null default now()
);
create index on public.money_backups (user_id);
alter table public.money_backups enable row level security;
create policy own_money_backups on public.money_backups for all
  using (user_id = auth.uid() and public.has_money()) with check (user_id = auth.uid() and public.has_money());
grant select, insert, update, delete on public.money_backups to authenticated;
grant all on public.money_backups to service_role;

create or replace function public.money_snapshot() returns jsonb
language plpgsql stable set search_path = public as $$
declare
  t text;
  found jsonb;
  snap jsonb := '{}';
begin
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_months', 'money_items', 'money_entries'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where user_id = auth.uid()', t) into found;
    snap := snap || jsonb_build_object(t, found);
  end loop;
  return snap;
end $$;

-- p holds rows by table name, in the shape money_snapshot() returns. A table that p does not name is left alone.
create or replace function public.money_replace(p jsonb, p_label text) returns void
language plpgsql set search_path = public as $$
declare
  t text;
  snap jsonb := public.money_snapshot();
begin
  if not public.has_money() then
    raise exception 'Money is not turned on';
  end if;
  if exists (select 1 from jsonb_each(snap) where value <> '[]'::jsonb) then
    insert into public.money_backups (label, data) values (p_label, snap);
  end if;
  -- Only the ten newest backups are kept.
  delete from public.money_backups where user_id = auth.uid()
    and id not in (select id from public.money_backups where user_id = auth.uid() order by created_at desc limit 10);

  -- Entries and items go first: they point at the lists.
  foreach t in array array['money_entries', 'money_items', 'money_months', 'money_people', 'money_increases', 'money_types', 'money_banks'] loop
    if p ? t then
      execute format('delete from public.%I where user_id = auth.uid()', t);
    end if;
  end loop;
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_months', 'money_items', 'money_entries'] loop
    if p ? t then
      -- Every row is written as the caller's own, whatever user_id it carried.
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, (select coalesce(jsonb_agg(jsonb_build_object(''created_at'', now()) || e || jsonb_build_object(''user_id'', auth.uid())), ''[]'') from jsonb_array_elements($1) e))',
        t, t) using p -> t;
    end if;
  end loop;
end $$;

-- Go back to a backup. What is there now is saved as a backup first, so going back can itself be undone.
create or replace function public.money_restore(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  b public.money_backups;
begin
  select * into b from public.money_backups where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'That backup no longer exists';
  end if;
  perform public.money_replace(b.data, 'Before going back to the backup of ' || to_char(b.created_at, 'DD Mon YYYY'));
end $$;

grant execute on function public.money_snapshot(), public.money_replace(jsonb, text), public.money_restore(uuid) to authenticated;
