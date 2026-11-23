-- VINAC Link relay (0.13), step 2: Realtime Authorization for the relay channel.
-- Each account has one private broadcast channel, topic 'relay:<account id>'. Only that account's
-- signed-in sessions may join it (read) or send on it (write). Frames on it are already sealed end to
-- end between devices paired in person, so Supabase only routes them; it can't read or forge them.
-- Also turn OFF "Allow public access" in Realtime settings, so only private channels exist.
-- (Policies only: realtime.messages is owned by Supabase, so no ALTER TABLE here.)

create policy "relay: join own account channel" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'relay:' || (select auth.uid())::text
  );

create policy "relay: send on own account channel" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'relay:' || (select auth.uid())::text
  );
