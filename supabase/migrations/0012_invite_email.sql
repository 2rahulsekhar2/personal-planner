-- Invite email: the app can send an addressed invite itself.
-- This function is the gate the server calls before sending: it checks the caller owns the circle,
-- applies the sending limits, records the send, and hands back what the email needs.

alter table public.circle_invites add column if not exists emailed_at timestamptz;

create or replace function public.mark_invite_emailed(p_token uuid)
returns table (email text, circle_name text, inviter_email text, role text, expires_at timestamptz, access_days integer)
language plpgsql security definer set search_path = public as $$
declare
  i public.circle_invites;
begin
  select ci.* into i from public.circle_invites ci
    join public.circles c on c.id = ci.circle_id
   where ci.token = p_token and c.owner_id = auth.uid()
     for update of ci;
  if i.id is null then raise exception 'Invite not found'; end if;
  if i.email is null then raise exception 'A link invite has no address to email'; end if;
  if i.accepted_at is not null or i.declined_at is not null or i.expires_at <= now() then
    raise exception 'This invite is no longer open';
  end if;
  -- Limits, so the app's mailbox cannot be used to flood anyone.
  if i.emailed_at > now() - interval '2 minutes' then
    raise exception 'This invite was emailed a moment ago. Try again in a couple of minutes';
  end if;
  if (select count(*) from public.circle_invites ci join public.circles c on c.id = ci.circle_id
       where c.owner_id = auth.uid() and ci.emailed_at > now() - interval '1 day') >= 20 then
    raise exception 'You have reached today''s limit of 20 invite emails';
  end if;
  update public.circle_invites set emailed_at = now() where id = i.id;
  return query select i.email, i.circle_name, i.inviter_email, i.role, i.expires_at, i.access_days;
end $$;

revoke all on function public.mark_invite_emailed(uuid) from public, anon;
grant execute on function public.mark_invite_emailed(uuid) to authenticated;
