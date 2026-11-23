-- VINAC Link Team console (0.13), step 3: teams, members, invites and signed activity summaries.
-- The console (vinac.tech/console) talks to these tables from the browser with the publishable key, so
-- Row Level Security is the whole access model:
--   - a team is visible only to its members; owners and admins invite, remove and rename;
--   - teammates see each other's linked computers (name, fingerprint, platform, version, last seen);
--   - an invite is visible to the team's owners/admins and to the person with that email;
--   - joining happens only through accept_invite(), for the email the invite names;
--   - activity summaries are uploaded by a member for their own linked computer, signed by that
--     computer's identity key (the console checks the signature). Counts only, never contents.
-- Helpers live in a schema the Data API does not expose.

create schema if not exists app_private;
grant usage on schema app_private to authenticated;

-- ---- tables ---------------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user on public.team_members (user_id);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$'),
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  unique (team_id, email)
);
create index if not exists team_invites_email on public.team_invites (email);

create table if not exists public.team_reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$'),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- the exact signed text (JSON), so the signature can be checked byte for byte
  payload text not null check (char_length(payload) <= 8000),
  signature text not null check (signature ~ '^[A-Za-z0-9_-]{86}$'),
  created_at timestamptz not null default now(),
  unique (team_id, fingerprint, period)
);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.team_reports enable row level security;

-- ---- helpers (security definer: read membership without tripping RLS on itself) --------------
create or replace function app_private.role_in(t uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select m.role from public.team_members m where m.team_id = t and m.user_id = (select auth.uid())
$$;

create or replace function app_private.shares_team(u uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members a join public.team_members b on a.team_id = b.team_id
    where a.user_id = (select auth.uid()) and b.user_id = u
  )
$$;

create or replace function app_private.my_email() returns text
  language sql stable set search_path = '' as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''))
$$;

revoke all on function app_private.role_in(uuid), app_private.shares_team(uuid), app_private.my_email() from public, anon;
grant execute on function app_private.role_in(uuid), app_private.shares_team(uuid), app_private.my_email() to authenticated;

-- ---- policies -------------------------------------------------------------------------------
create policy "teams: members read" on public.teams
  for select to authenticated using (app_private.role_in(id) is not null);
create policy "teams: owners and admins rename" on public.teams
  for update to authenticated using (app_private.role_in(id) in ('owner', 'admin')) with check (app_private.role_in(id) in ('owner', 'admin'));
create policy "teams: owners delete" on public.teams
  for delete to authenticated using (app_private.role_in(id) = 'owner');

create policy "members: members read" on public.team_members
  for select to authenticated using (app_private.role_in(team_id) is not null);
create policy "members: owners set roles" on public.team_members
  for update to authenticated
  using (app_private.role_in(team_id) = 'owner' and user_id <> (select auth.uid()))
  with check (role in ('admin', 'member') and user_id <> (select auth.uid()));
-- Anyone but an owner may leave; owners and admins may remove members who are not owners.
create policy "members: leave or remove" on public.team_members
  for delete to authenticated
  using (role <> 'owner' and (user_id = (select auth.uid()) or app_private.role_in(team_id) in ('owner', 'admin')));

create policy "invites: admins and the invitee read" on public.team_invites
  for select to authenticated using (app_private.role_in(team_id) in ('owner', 'admin') or email = app_private.my_email());
create policy "invites: admins invite" on public.team_invites
  for insert to authenticated
  with check (app_private.role_in(team_id) in ('owner', 'admin') and invited_by = (select auth.uid()) and (role = 'member' or app_private.role_in(team_id) = 'owner'));
create policy "invites: admins revoke, the invitee declines" on public.team_invites
  for delete to authenticated using (app_private.role_in(team_id) in ('owner', 'admin') or email = app_private.my_email());

create policy "reports: members read" on public.team_reports
  for select to authenticated using (app_private.role_in(team_id) is not null);
create policy "reports: members share their own computer's" on public.team_reports
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and app_private.role_in(team_id) is not null
    and exists (select 1 from public.devices d where d.user_id = (select auth.uid()) and d.fingerprint = team_reports.fingerprint)
  );
create policy "reports: replace own" on public.team_reports
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and app_private.role_in(team_id) is not null);
create policy "reports: own or admins delete" on public.team_reports
  for delete to authenticated using (user_id = (select auth.uid()) or app_private.role_in(team_id) in ('owner', 'admin'));

-- Teammates see each other's linked computers and display names.
create policy "devices: teammates read" on public.devices
  for select to authenticated using (app_private.shares_team(user_id));
create policy "profiles: teammates read" on public.profiles
  for select to authenticated using (app_private.shares_team(id));

-- ---- actions that need more than one row: functions, checked inside ----------------------------
create or replace function public.create_team(team_name text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.'; end if;
  if (select count(*) from public.team_members where user_id = (select auth.uid()) and role = 'owner') >= 5 then
    raise exception 'You already own 5 teams.';
  end if;
  insert into public.teams (name, created_by) values (btrim(team_name), (select auth.uid())) returning id into t;
  insert into public.team_members (team_id, user_id, role) values (t, (select auth.uid()), 'owner');
  return t;
end;
$$;

create or replace function public.accept_invite(invite uuid) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare i public.team_invites;
begin
  select * into i from public.team_invites where id = invite;
  if i.id is null or i.email <> app_private.my_email() then raise exception 'That invitation is not for this account.'; end if;
  if i.expires_at < now() then raise exception 'That invitation has expired. Ask for a new one.'; end if;
  insert into public.team_members (team_id, user_id, role) values (i.team_id, (select auth.uid()), i.role)
    on conflict (team_id, user_id) do nothing;
  delete from public.team_invites where id = i.id;
  return i.team_id;
end;
$$;

-- Members of a team with their email (from Auth) and role: only for that team's members.
create or replace function public.team_roster(team uuid)
  returns table (user_id uuid, email text, role text, joined_at timestamptz, display_name text)
  language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.joined_at, p.display_name
  from public.team_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.team_id = team and app_private.role_in(team) is not null
  order by m.joined_at
$$;

revoke all on function public.create_team(text), public.accept_invite(uuid), public.team_roster(uuid) from public, anon;
grant execute on function public.create_team(text), public.accept_invite(uuid), public.team_roster(uuid) to authenticated;

-- ---- Data API access: signed-in users only -----------------------------------------------------
revoke all on public.teams, public.team_members, public.team_invites, public.team_reports from anon;
grant select, delete on public.teams to authenticated;
grant update (name) on public.teams to authenticated;
grant select, delete on public.team_members to authenticated;
grant update (role) on public.team_members to authenticated;
grant select, insert, delete on public.team_invites to authenticated;
grant select, insert, delete on public.team_reports to authenticated;
-- Sharing again for the same month is an upsert (see the accounts migration about upserts).
grant update (team_id, user_id, fingerprint, period, payload, signature, created_at) on public.team_reports to authenticated;
