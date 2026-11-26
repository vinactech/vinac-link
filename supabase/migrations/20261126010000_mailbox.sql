-- VINAC Link mailbox (0.16), step 4: sealed items for a computer that isn't connected.
-- An item is sealed on the sending computer with a key derived from the PAIRING key of the two
-- computers (AES-256-GCM), so only those two can open it. Stored here: the sealed bytes, which
-- device it is from and to, which accounts, the team (if any) and times. Never contents or keys.
-- Rules: a signed-in person may leave items for their own account or for a teammate (shares a team),
-- at most 500 waiting at a time; the recipient reads and deletes them; the sender may delete theirs.
-- Items expire after 7 days (hidden by the select rule; purge_mailbox() removes them).

create table if not exists public.mailbox (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete cascade,
  from_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  from_device text not null check (from_device ~ '^[0-9a-f]{16}$'),
  to_device text not null check (to_device ~ '^[0-9a-f]{16}$'),
  sealed text not null check (sealed ~ '^[A-Za-z0-9_-]+$' and char_length(sealed) <= 210000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists mailbox_to on public.mailbox (to_user, to_device, created_at);
create index if not exists mailbox_from on public.mailbox (from_user);
alter table public.mailbox enable row level security;

-- Only these columns can be written (the rest have defaults the client can't change).
revoke all on public.mailbox from anon, authenticated;
grant select, delete on public.mailbox to authenticated;
grant insert (team_id, to_user, from_device, to_device, sealed) on public.mailbox to authenticated;

create or replace function app_private.mailbox_pending(u uuid) returns bigint
  language sql stable security definer set search_path = '' as $$
  select count(*) from public.mailbox m where m.from_user = u and m.expires_at > now()
$$;

create policy "mailbox: leave for yourself or a teammate" on public.mailbox
  for insert to authenticated
  with check (
    from_user = (select auth.uid())
    and (to_user = (select auth.uid()) or app_private.shares_team(to_user))
    and (team_id is null or app_private.role_in(team_id) is not null)
    and app_private.mailbox_pending((select auth.uid())) < 500
  );

create policy "mailbox: recipient and sender read" on public.mailbox
  for select to authenticated
  using ((to_user = (select auth.uid()) or from_user = (select auth.uid())) and expires_at > now());

create policy "mailbox: recipient and sender delete" on public.mailbox
  for delete to authenticated
  using (to_user = (select auth.uid()) or from_user = (select auth.uid()));

-- Removes expired items. Run by hand from the SQL editor, or schedule it (pg_cron) later.
create or replace function app_private.purge_mailbox() returns bigint
  language sql security definer set search_path = '' as $$
  with gone as (delete from public.mailbox where expires_at <= now() returning 1) select count(*) from gone
$$;
