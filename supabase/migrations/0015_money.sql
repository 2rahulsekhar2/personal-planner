-- Money (part 1): a private budget beside the calendar.
--   * Money is off until a person turns it on: the server adds a subscriptions row after checking an emailed code.
--   * Every money table can be read and written only by its owner, and only while that subscription is active.
--   * An income or expense is one row holding its rule (how much, how often, from when). Its months are worked
--     out by the app; a money_entries row exists only for a month that was changed, skipped or paid.

-- Which side of the app was open last: restored on the next visit, on any device.
alter table public.profiles add column if not exists last_mode text not null default 'time' check (last_mode in ('time', 'money'));

-- ---------------------------------------------------------------------------
-- Turning Money on
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product text not null check (product in ('money')),
  plan text not null default 'personal' check (plan in ('personal', 'family')),
  status text not null default 'active' check (status in ('active', 'ended')),
  activated_at timestamptz not null default now(),
  unique (user_id, product)
);
alter table public.subscriptions enable row level security;
-- Read only. No write policy: a person cannot give themselves a subscription; the server does, with the service role.
create policy read_my_subscriptions on public.subscriptions for select using (user_id = auth.uid());

-- The emailed code, kept as a hash. No policies at all: only the server reads or writes it.
create table public.money_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0
);
alter table public.money_codes enable row level security;

-- Used by every money policy. Security definer so the policies do not depend on the subscriptions policy.
create or replace function public.has_money() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions where user_id = auth.uid() and product = 'money' and status = 'active');
$$;

-- ---------------------------------------------------------------------------
-- The lists an income or expense draws on
-- ---------------------------------------------------------------------------
create table public.money_banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  balance numeric(14, 2) not null default 0,  -- typed in by the owner
  balance_at date,                             -- the day it was last typed in
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.money_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null check (kind in ('income', 'expense')),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.money_increases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  percent numeric(5, 2) not null check (percent > 0 and percent <= 100),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- The family: people money is spent on or earned by. They need no account.
create table public.money_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  relationship text not null check (length(trim(relationship)) between 1 and 40),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Incomes and expenses
-- ---------------------------------------------------------------------------
create table public.money_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  name text not null check (length(trim(name)) between 1 and 120),
  amount numeric(14, 2) not null check (amount >= 0),  -- the budget for one occurrence
  freq text not null default 'once' check (freq in ('once', 'daily', 'weekly', 'monthly', 'yearly')),
  start_date date not null,                              -- the date itself when freq is 'once'
  end_date date check (end_date is null or end_date >= start_date),  -- null: no end
  bank_id uuid references public.money_banks (id) on delete set null,
  type_id uuid references public.money_types (id) on delete set null,
  increase_id uuid references public.money_increases (id) on delete set null,
  person_ids uuid[] not null default '{}',               -- money_people it is for; the amount splits equally
  notes text,
  created_at timestamptz not null default now()
);

-- One month of one item, stored only once that month differs from the rule or has been paid.
create table public.money_entries (
  item_id uuid not null references public.money_items (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  budget numeric(14, 2) check (budget >= 0),  -- this month's budget, when it differs from the rule
  actual numeric(14, 2) check (actual >= 0),  -- what was really paid or received
  paid_at timestamptz,
  skipped boolean not null default false,
  primary key (item_id, month)
);

-- Months the owner has reviewed and marked as planned.
create table public.money_months (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  planned_at timestamptz not null default now(),
  primary key (user_id, month)
);

create index on public.money_banks (user_id);
create index on public.money_types (user_id);
create index on public.money_increases (user_id);
create index on public.money_people (user_id);
create index on public.money_items (user_id);
create index on public.money_entries (user_id);

-- The same rule on every money table: your own rows, while Money is on.
do $$
declare t text;
begin
  foreach t in array array['money_banks', 'money_types', 'money_increases', 'money_people', 'money_items', 'money_entries', 'money_months'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_%I on public.%I for all using (user_id = auth.uid() and public.has_money()) with check (user_id = auth.uid() and public.has_money())', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant select on public.subscriptions to authenticated;
grant execute on function public.has_money() to authenticated;
grant all on public.subscriptions, public.money_codes, public.money_banks, public.money_types, public.money_increases,
  public.money_people, public.money_items, public.money_entries, public.money_months to service_role;
