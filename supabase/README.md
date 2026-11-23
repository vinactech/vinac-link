# Supabase (optional accounts, 0.13)

VINAC Link works without an account. An account adds what needs a server: linking your computers to
one place, the relay between networks, and the Team console. This folder holds the database setup.

- `migrations/`: SQL applied in order to the project (SQL editor, or `supabase db push` with the
  Supabase CLI). Every table has Row Level Security; a signed-in person sees and changes only their
  own rows. Tables are exposed to the Data API only by explicit grants.
- What is stored: the account's email (by Supabase Auth), and for each linked computer its name,
  identity fingerprint and public key, platform, app version, and when it was linked and last seen.
  Never message contents, secret values, audit entries or private keys.
- The app uses only the project URL and the **publishable** key (safe to ship; RLS protects the data).
  The secret key is never used by the app and never stored in this repository.
- Relay (`20261123010000_relay.sql`): one private Realtime broadcast channel per account,
  `relay:<account id>`; policies on `realtime.messages` let only that account's signed-in sessions join
  or send. In Realtime settings, turn **off** "Allow public access" so only private channels exist.
  Frames on it are sealed end to end between devices paired in person: Supabase routes them (and sees
  device ids, sizes and times), but can't read or forge them. Pairing never goes through it.
