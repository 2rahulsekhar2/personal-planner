-- Import, export and backups (0016) meet shared budgets (0017): they cover the private budget only.
-- 0016 took "my Money data" to be every row with my user_id. With shared budgets that also matches rows I added
-- to a circle: a bank, a person, my "planned" mark, the paid marks I made on shared items. An import would then
-- have deleted those from the circle. Both functions now read and replace private rows only (circle_id null),
-- and month entries only of private items. A shared budget is never exported, backed up, or replaced.

create or replace function public.money_snapshot() returns jsonb
language plpgsql stable set search_path = public as $$
declare
  t text;
  found jsonb;
  snap jsonb := '{}';
begin
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_months', 'money_items'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where user_id = auth.uid() and circle_id is null', t) into found;
    snap := snap || jsonb_build_object(t, found);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]') into found from public.money_entries e
   where exists (select 1 from public.money_items i where i.id = e.item_id and i.user_id = auth.uid() and i.circle_id is null);
  return snap || jsonb_build_object('money_entries', found);
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

  -- Entries and items go first: they point at the lists. Only private rows are removed.
  if p ? 'money_entries' then
    delete from public.money_entries e
     where exists (select 1 from public.money_items i where i.id = e.item_id and i.user_id = auth.uid() and i.circle_id is null);
  end if;
  foreach t in array array['money_items', 'money_months', 'money_people', 'money_increases', 'money_types', 'money_banks'] loop
    if p ? t then
      execute format('delete from public.%I where user_id = auth.uid() and circle_id is null', t);
    end if;
  end loop;
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_months', 'money_items'] loop
    if p ? t then
      -- Every row is written as the caller's own and private, whatever it carried. A row that was shared when an
      -- older backup was taken is left out.
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, (select coalesce(jsonb_agg(jsonb_build_object(''created_at'', now()) || e || jsonb_build_object(''user_id'', auth.uid())), ''[]'') from jsonb_array_elements($1) e where e ->> ''circle_id'' is null))',
        t, t) using p -> t;
    end if;
  end loop;
  if p ? 'money_entries' then
    -- Only months of the private items just written.
    insert into public.money_entries select * from jsonb_populate_recordset(null::public.money_entries,
      (select coalesce(jsonb_agg(e || jsonb_build_object('user_id', auth.uid())), '[]') from jsonb_array_elements(p -> 'money_entries') e
        where exists (select 1 from public.money_items i where i.id = (e ->> 'item_id')::uuid and i.user_id = auth.uid() and i.circle_id is null)));
  end if;
end $$;
