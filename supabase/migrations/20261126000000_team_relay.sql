-- VINAC Link team relay (0.16), step 2: one private broadcast channel per team.
-- Topic 'relay-team:<team id>'. Only signed-in members of that team may join it (read) or send on it
-- (write). Frames on it are sealed end to end between computers that were paired by people, and each
-- computer also checks that the other's key matches the team directory, so Supabase only routes them;
-- it can't read or forge them. The account channel ('relay:<account id>') policies stay as they are.
-- (Policies only: realtime.messages is owned by Supabase, so no ALTER TABLE here.)

create policy "relay: join a team channel as a member" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'relay-team:%'
    and exists (
      select 1 from public.team_members m
      where m.user_id = (select auth.uid())
        and m.team_id::text = substring((select realtime.topic()) from 12)
    )
  );

create policy "relay: send on a team channel as a member" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'relay-team:%'
    and exists (
      select 1 from public.team_members m
      where m.user_id = (select auth.uid())
        and m.team_id::text = substring((select realtime.topic()) from 12)
    )
  );
