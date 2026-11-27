# Security

**VINAC Link is experimental.** The design had one AI-assisted security review (2026-10-29; every
finding was fixed and has a test that tries the attack) and **no human review**. Do not rely on it
for production secrets yet.

**Reporting:** please report vulnerabilities privately to **hello@vinac.tech** with "Security" in
the subject. We reply within a few days and credit you if you like. Please don't open a public issue
for a security problem.

## What we protect against

| Attacker | Goal we stop |
|---|---|
| Another device on the same network | Reading, faking, replaying or redirecting messages; joining as a paired device |
| Someone in the room with a microphone/speaker | Pairing without a person checking the same 6 digits and pressing Allow on both devices; reading secrets sent by sound without the pairing key |
| A malicious web page in your browser | Using the local page or its API (CSRF, DNS rebinding, framing) |
| A paired but compromised device | Getting its requests or files past your firewall; replaying; moving your record of its address |
| A confused or prompt-injected agent on this computer, **using VINAC Link's tools** | Confirming a pairing, reading secret values, changing firewall rules, approving requests |

## How

| Area | Protection |
|---|---|
| Protocol v3 | Pairing with **Noise XX**, sessions with **Noise KKpsk0 / NNpsk0** (25519, ChaChaPoly, SHA256), checked against the official test vectors ([docs/NOISE.md](docs/NOISE.md)). The code swap, signatures over the transcript and receipts stay. Once a device used v3, v2 sessions with it are refused. The rows below describe v2, still used with older devices. |
| Pairing | Beacon/code carries address + one-time secret + key fingerprint. X25519 with a nonce commitment; one transcript binds both identities, keys, nonces, the beacon secret, names, ports, roles and protocol version, signed by both (Ed25519). Each side shows its own 6-digit code and checks the one the person types (3 attempts). An agent cannot confirm from its own screen. |
| Sessions | Fresh X25519 per session, authenticated with a key derived from the pairing key, separate keys per direction, memory only, renewed hourly or after 500 uses (forward secrecy). AES-256-GCM; AAD binds kind, sender, recipient, session and port. |
| Delivery | "Delivered" requires a receipt (HMAC over the exact ciphertext) only the real peer can make. |
| Replays | Every accepted id is remembered for its whole acceptance window (10 min ± margin). |
| Addresses | A peer's address (LAN or Tailscale) changes only after it proves, at the new address, that it holds the pairing key. Candidate addresses are limited to private, Tailscale and loopback ranges. |
| Firewall | Requests (named intents) and plain text are decided on arrival by the person's rules, before any agent sees them. Unknown intents, malformed args, missing required args and tampered files are refused by both sender and receiver. Only the page can change rules or approve. |
| Files | Up to 64 MB. Over 192 KB, they travel as sealed parts (each with its own receipt), stored encrypted until the closing message; then size and sha256 are checked before the firewall decides. Names without folders; at most 4 unfinished transfers per device, deleted after an hour. Readable by agents only after the firewall lets them through; big ones only by saving them (`vinac file save`, never overwriting). Downloaded by the page as attachments, never rendered. `vinac send-file` reads the file in the agent's own command; the service never opens a path an agent names. |
| Git | `vinac git fetch` verifies the bundle and fetches its branches into `refs/remotes/vinac/<device>/`; it never checks out, merges or runs hooks. |
| `vinac run` | Secret values go to a program only after the person approves that run on the page, which shows the command and folder. One use per approval, 2-minute expiry, logged. |
| Standing grants (0.11) | Made only on the page, from a run the person approves ("Allow for 1 h / 8 h / 24 h / 7 days"). A grant names one agent identity (or the default token), the keys, the exact command (optionally followed by more arguments) and one folder with its subfolders; at most 7 days, revocable, unusable while the vault is locked. A granted run is started by the service itself, with the service's own PATH, no stdin, and output passed back through the redactor: the values never reach the agent or the agent API. One run per answer; every grant, use and revocation is audited. Since 0.16.3 a grant is bound to the argument list the service starts (not a display string) and to the variable each key goes into; on Windows the program starts without a shell, and an npm-style `.cmd` file gets only plain arguments. Grants made before 0.16.3 match nothing. |
| One-time run approvals (0.16.3) | The values of a run approved once are handed out only to the identity that asked, once, within 30 seconds of the approval; the record is checked again and removed after any wait, so two waiting callers can't both collect it. They go to the program that asked (`vinac run`), which starts the command itself; see "`vinac run` trusts the command it is told" below. |
| Rooms (0.16.3) | Text, cards and files in a room pass the same checks with the posting agent's identity (project agents, paused rooms, card types, rates) before anything is stored. A room name that several rooms share reaches no room. |
| Phone vault (0.11, beta) | The computer shows a QR link whose code (a one-time X25519 key and 16-byte secret) sits after `#`, so it never reaches the web server. The phone answers by sound with its X25519 key and an HMAC tag; both derive keys with HKDF and show 6 digits; only the page's Allow stores the phone (its sealing key wrapped by the OS key store). Keys from the phone: AES-256-GCM with the header as additional data and a counter that must grow (replays refused), accepted only while the person listens. On the phone, the vault is AES-256-GCM with a PBKDF2-SHA256 key (600,000 rounds) from the passphrase, kept in the browser's storage; it locks after 5 minutes. The web app loads nothing from other sites. |
| Agent identities (0.11) | Made only on the page; each has its own token (`agt_…`), shown once and stored only as SHA-256. Requests carry the agent's name into the audit log; grants can be limited to one agent; removing an agent ends its token and its grants. |
| Audit log | One hash-chained line per event, never contents; `vinac audit --verify` finds changed or removed lines. |
| Local-model auto-reply | The model gets a fixed instruction and the message marked untrusted, no tools; the service sends its text only as an automatic reply to that device. Model addresses must be loopback, private or Tailscale. |
| Secrets | Accepted only for 3 minutes after the person presses Receive. Stored in the OS key store; agent tools return names only. Replacements wait for approval. Optional vault passphrase: values are also sealed to an X25519 vault key whose private half is encrypted with scrypt(passphrase); readable only while unlocked (15 minutes), 5 wrong tries a minute. Copy clears the clipboard after 30 s; `vinac run` hides printed values. |
| Firewall modes | Restricted / Standard / Auto set defaults by risk per device or for all; high risk is blocked in every mode; the person's rules win. "Approve for 1 hour" never covers high risk. At most 25 pending per device; pending requests expire after 3 days. |
| Outbox | Messages for an unreachable device wait inside the encrypted history and are resent (fresh timestamp, same id, so a replay is still refused) for up to 24 hours. |
| Storage | OS key store (DPAPI / Keychain / Secret Service) or nothing; message history and files encrypted at rest; atomic writes; damaged files stop the service instead of being read as empty. |
| Local page | Exact Host check, same-origin only, page token, CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`. |
| Abuse | Rate limits per address and per peer, size limits, connection and time limits. |
| Live mode (`vinac watch`) | Prints device name (cleaned to letters, digits and a few marks, 32 chars), intent and id; never text, args or file names; held/blocked items only as a count. Uses a read-only endpoint that marks nothing read. |
| Auto-reply | Off per device by default; only the page turns it on. Starts only for visible `agent.question.ask` / `agent.status.update` / `agent.capability.query`. Fixed prompt without message text; no built-in tools; only the VINAC Link MCP server. A one-run token reads only the triggering messages and replies only to them, to that device, as plain text or info answers, at most n+1 times. Replies carry `auto: true` and never start a run. Runs per hour, quiet hours, one at a time, time limit. |
| OpenClaw front desk | Off by default. Notes carry device, intent and id only; waiting items only as a count; no approval through chat. |

## Not solved (do not rely on these)

- **Programs running as you.** Any program with your account (including an agent with a shell) can
  read the OS key store, the page token and VINAC Link's files. Agent *tools* never return secret
  values, but a determined agent with shell access can. Partly addressed: with a vault passphrase,
  secret values can't be read while the vault is locked (they can while it's unlocked). Planned: a
  broker under its own OS account.
- **Plain text still persuades.** The firewall decides what reaches the agent, but a delivered plain
  message can still talk a tricked agent into something. That's why it's labelled untrusted, and why
  you can hold plain text per device.
- **Sound secrets** are sealed with a key from the long-lived pairing key (no forward secrecy). A
  nearby microphone can record the tones; a recording plus a later stolen pairing key reveals them.
  Sound suggests proximity but can be relayed. Planned: the receiving device makes a one-time key
  when the person presses Receive, so an old recording opens nothing. Use test keys until the
  independent review.
- **Protocol v3 is new and not reviewed.** Pairing and sessions now use Noise (XX, KKpsk0/NNpsk0),
  but some parts are still our own: the commit/reveal code swap, binding the Ed25519 identity to the
  Noise key, keys exported from the handshake, and the message layer (AES-256-GCM, random nonces).
  They need the human review planned next ([what to check](docs/NOISE.md#for-the-security-review)).
- **v2 is still spoken with older devices.** Between two devices that never used v3, someone on
  the network can hide v3 and keep them on v2 (still authenticated by the pairing key). After the
  first v3 session that is refused. v2 is removed before 1.0.
- **On-path devices** can't read or fake anything but can delay or drop traffic.
- The **"by agent / person"** label on messages is the sender's claim. So is `auto: true`: a device
  that leaves it off on its automatic replies can make two auto-responders answer each other; the
  hourly limit per device still caps that.
- **Auto mode widens who can start agent work.** With auto-reply on, a paired device's agent can
  cause a model run on your computer that reads its words (cost, and answers you didn't review);
  the run can only reply, but what it says may be wrong or talked into. The OpenClaw front desk
  wakes an agent that has whatever tools you allowed it; a tricked agent is limited by that
  allowlist, not by VINAC Link. A device's display name is chosen on that device and appears
  (cleaned and shortened) in live-mode and front-desk notes.
- Same-user programs can edit `autoreply.json` (including the agent program) just like
  `firewall.json`; the OS-account broker on the roadmap closes this.
- **`vinac run` trusts the command it is told.** The page shows the command a program *says* it will
  run; a program running as you (or an agent with a shell) can ask under a harmless-looking command
  and keep the value. Approve only runs you started. The OS-account broker closes this too.
- **The phone vault is a web app.** It is only as safe as the site that serves it (vinac.tech) and
  the phone's browser: a compromised site could ship a page that leaks keys after you unlock. Its
  passphrase key is PBKDF2 (no memory-hard function in browsers yet). Keep production keys out of it
  until the native app (Keychain / Secure Enclave). Sound keys from the phone use a key derived at
  pairing time, without forward secrecy.
- **A grant gives the keys to whatever the allowed command runs.** `npm test` runs the scripts in
  that folder's `package.json`; an agent that can edit them can make the granted command print or
  send the key in a form the redactor doesn't recognise. Grant only commands and folders whose
  contents you trust, for as short a time as works. Agent identities are labels for accountability,
  not a wall: a program running as you can read another agent's token from its settings.
- **The audit log can be rewritten whole** by a program running as you; `--verify` only catches
  partial edits. Keep the latest hash elsewhere to catch a full rewrite.
- **Groups and big files** don't change who can reach your agent: each device's own firewall still
  decides on arrival. A big file costs disk space and time until it is checked; the limits above
  bound that.

## Wire compatibility

Protocol v3, with v2 kept for older devices. The fixed labels inside the cryptography and the
key-store item names never change between versions; changing them would break existing pairings.
