-- Circles: groups (family, team, friends) whose members will share appointments and tasks.
-- Phase 1 is membership only: create a circle, invite, accept or decline, leave.
-- Nothing is shared by joining; sharing items comes in a later migration.
--
-- All writes go through the functions below (security definer), so the tables have
-- read-only policies and the rules live in one place.

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,                 -- copied at join time; members cannot read auth.users
  role text not null check (role in ('owner', 'member', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index on public.circle_members (user_id);

create table public.circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  circle_name text not null,           -- copied, because the invitee cannot read the circle yet
  inviter_email text not null,
  email text,                          -- null: a link invite, usable by whoever opens it first
  role text not null default 'member' check (role in ('member', 'viewer')),
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.circle_invites (circle_id);
create index on public.circle_invites (lower(email));

-- Membership test used by the policies. Security definer so that the policy on
-- circle_members does not have to query circle_members under its own policy.
create or replace function public.is_circle_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.circle_members where circle_id = cid and user_id = auth.uid());
$$;

create or replace function public.my_email() returns text
language sql stable as $$
  select lower(nullif(auth.jwt() ->> 'email', ''));
$$;

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_invites enable row level security;

create policy read_my_circles on public.circles for select using (public.is_circle_member(id));
create policy read_circle_members on public.circle_members for select using (public.is_circle_member(circle_id));
-- An invite is visible to the person it is addressed to and to the circle's owner.
create policy read_invites on public.circle_invites for select using (
  lower(email) = public.my_email()
  or exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
create or replace function public.create_circle(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null or public.my_email() is null then raise exception 'Sign in first'; end if;
  insert into public.circles (name, owner_id) values (trim(p_name), auth.uid()) returning id into cid;
  insert into public.circle_members (circle_id, user_id, email, role) values (cid, auth.uid(), public.my_email(), 'owner');
  return cid;
end $$;

-- Owner only. p_email null makes a link invite. Returns the token to put in the link.
create or replace function public.invite_to_circle(p_circle uuid, p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.circles;
  addr text := lower(nullif(trim(p_email), ''));
  tok uuid;
begin
  select * into c from public.circles where id = p_circle;
  if c.id is null or c.owner_id <> auth.uid() then raise exception 'Only the owner can invite'; end if;
  if addr is not null then
    if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'That email address does not look right'; end if;
    if exists (select 1 from public.circle_members where circle_id = p_circle and lower(email) = addr) then
      raise exception 'They are already in this circle';
    end if;
    -- One open invite per address: a new one replaces the old.
    delete from public.circle_invites where circle_id = p_circle and lower(email) = addr and accepted_at is null;
  end if;
  insert into public.circle_invites (circle_id, circle_name, inviter_email, email, role)
  values (p_circle, c.name, public.my_email(), addr, coalesce(p_role, 'member'))
  returning token into tok;
  return tok;
end $$;

-- What a link shows before the person decides. Readable by any signed-in user who has the token.
create or replace function public.get_invite(p_token uuid)
returns table (circle_name text, inviter_email text, role text, expires_at timestamptz, usable boolean)
language sql stable security definer set search_path = public as $$
  select i.circle_name, i.inviter_email, i.role, i.expires_at,
         (i.accepted_at is null and i.declined_at is null and i.expires_at > now()
          and (i.email is null or i.email = public.my_email())
          and not public.is_circle_member(i.circle_id))
    from public.circle_invites i
   where i.token = p_token and auth.uid() is not null;
$$;

create or replace function public.respond_to_invite(p_token uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.circle_invites;
begin
  if auth.uid() is null or public.my_email() is null then raise exception 'Sign in first'; end if;
  select * into i from public.circle_invites where token = p_token for update;
  if i.id is null then raise exception 'Invite not found'; end if;
  if i.email is not null and i.email <> public.my_email() then raise exception 'This invite is for a different email address'; end if;
  if i.accepted_at is not null or i.declined_at is not null then raise exception 'This invite was already used'; end if;
  if i.expires_at <= now() then raise exception 'This invite has expired'; end if;

  if not p_accept then
    -- Declining an addressed invite closes it; a link stays usable by someone else.
    if i.email is not null then update public.circle_invites set declined_at = now() where id = i.id; end if;
    return null;
  end if;

  insert into public.circle_members (circle_id, user_id, email, role)
  values (i.circle_id, auth.uid(), public.my_email(), i.role)
  on conflict (circle_id, user_id) do nothing;
  update public.circle_invites set accepted_at = now() where id = i.id;
  return i.circle_id;
end $$;

-- Owner only: withdraw an invite that has not been accepted.
create or replace function public.revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.circle_invites i
   using public.circles c
   where i.id = p_invite and c.id = i.circle_id and c.owner_id = auth.uid() and i.accepted_at is null;
  if not found then raise exception 'Invite not found'; end if;
end $$;

-- Anyone can leave. The owner must hand the circle over first, unless they are the last member,
-- in which case the circle is deleted.
create or replace function public.leave_circle(p_circle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.circles;
begin
  select * into c from public.circles where id = p_circle for update;
  if c.id is null or not public.is_circle_member(p_circle) then raise exception 'You are not in this circle'; end if;
  if c.owner_id = auth.uid() then
    if exists (select 1 from public.circle_members where circle_id = p_circle and user_id <> auth.uid()) then
      raise exception 'Make someone else the owner before you leave';
    end if;
    delete from public.circles where id = p_circle;
    return;
  end if;
  delete from public.circle_members where circle_id = p_circle and user_id = auth.uid();
end $$;

-- Owner only: hand the circle to another member. The old owner stays as a member.
create or replace function public.transfer_circle(p_circle uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.circles where id = p_circle and owner_id = auth.uid()) then
    raise exception 'Only the owner can do this';
  end if;
  if p_user = auth.uid() or not exists (select 1 from public.circle_members where circle_id = p_circle and user_id = p_user) then
    raise exception 'Pick another member of this circle';
  end if;
  update public.circle_members set role = 'member' where circle_id = p_circle and user_id = auth.uid();
  update public.circle_members set role = 'owner' where circle_id = p_circle and user_id = p_user;
  update public.circles set owner_id = p_user where id = p_circle;
end $$;

-- Owner only: remove another member.
create or replace function public.remove_circle_member(p_circle uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.circles where id = p_circle and owner_id = auth.uid()) then
    raise exception 'Only the owner can do this';
  end if;
  if p_user = auth.uid() then raise exception 'Use leave instead'; end if;
  delete from public.circle_members where circle_id = p_circle and user_id = p_user;
end $$;

-- Owner only: delete the circle for everyone.
create or replace function public.delete_circle(p_circle uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.circles where id = p_circle and owner_id = auth.uid();
  if not found then raise exception 'Only the owner can do this'; end if;
end $$;

-- Signed-in users only.
revoke all on function
  public.is_circle_member(uuid), public.create_circle(text), public.invite_to_circle(uuid, text, text),
  public.get_invite(uuid), public.respond_to_invite(uuid, boolean), public.revoke_invite(uuid),
  public.leave_circle(uuid), public.transfer_circle(uuid, uuid), public.remove_circle_member(uuid, uuid),
  public.delete_circle(uuid)
from public, anon;
grant execute on function
  public.is_circle_member(uuid), public.create_circle(text), public.invite_to_circle(uuid, text, text),
  public.get_invite(uuid), public.respond_to_invite(uuid, boolean), public.revoke_invite(uuid),
  public.leave_circle(uuid), public.transfer_circle(uuid, uuid), public.remove_circle_member(uuid, uuid),
  public.delete_circle(uuid)
to authenticated;

-- Members may read these tables (the policies above decide which rows); nobody writes directly.
revoke all on public.circles, public.circle_members, public.circle_invites from anon, authenticated;
grant select on public.circles, public.circle_members, public.circle_invites to authenticated;
