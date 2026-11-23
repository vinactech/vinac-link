-- VINAC Link accounts (0.13), step 1: profiles and linked devices.
-- Accounts are optional. A device record holds only what identifies the computer (its name, its
-- public identity key and fingerprint, platform and app version) and when it was linked and last
-- seen. Never message contents, secret values, audit entries or keys that could decrypt anything.
-- Row Level Security on every table: a signed-in person sees and changes only their own rows.
-- Tables are exposed to the Data API only by the explicit grants below (the project does not grant
-- new tables automatically).

-- ---- profiles: one per account -------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- A profile is made when the account is created (the person signs in for the first time).
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
-- Accounts made before this migration get their profile now.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- ---- devices: computers linked to the account ----------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- the device's identity fingerprint as VINAC Link shows it (XXXX-XXXX-XXXX-XXXX)
  fingerprint text not null check (fingerprint ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$'),
  -- its Ed25519 identity public key, base64url (32 bytes)
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  name text not null check (char_length(name) between 1 and 60),
  platform text check (platform is null or platform in ('win32', 'darwin', 'linux')),
  app_version text check (app_version is null or app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (user_id, fingerprint)
);
alter table public.devices enable row level security;

create policy "devices: read own" on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy "devices: link own" on public.devices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "devices: update own" on public.devices
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "devices: unlink own" on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));

create index if not exists devices_user_id on public.devices (user_id);

-- ---- Data API access: signed-in users only, never anonymous ------------------------------
revoke all on public.profiles, public.devices from anon;
grant select, update (display_name) on public.profiles to authenticated;
grant select, insert, delete on public.devices to authenticated;
-- Linking is an upsert (insert ... on conflict do update), which needs UPDATE on every column it
-- sends. The policies above still pin every row to its owner (user_id = auth.uid()).
grant update (user_id, fingerprint, public_key, name, platform, app_version, last_seen_at) on public.devices to authenticated;
