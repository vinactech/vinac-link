# Architecture

## Components

| Part | Where | What it does |
|---|---|---|
| **Service** (`connector/src/daemon.js`) | one per computer | Pairing, sessions, messages, requests, firewall, files, secrets. Listens on the network (port 47800) and on `127.0.0.1:47801` (page + agent API). |
| **Page** (`connector/web/`) | browser, 127.0.0.1 only | Conversations, pairing (sound/code), Secrets, Firewall (rules + approvals). The only place a person confirms pairings, approves requests and changes rules. |
| **Agent tools** (`connector/src/mcp.js`) | stdio MCP server | `vinac_*` tools for Claude Code, Codex and other MCP apps. Starts the service in the background if needed. |
| **Plugin** (`.claude-plugin/`, `.codex-plugin/`, `skills/`, `hooks/`) | the repo root | Claude Code / Codex plugin: tools, skills, a session-start note about unread items. |
| **OpenClaw** (`openclaw/node`, `openclaw/gateway`) | node host + gateway | The same tools for OpenClaw agents, through OpenClaw's node connection. |
| **Sound modem** (`lab/js`, `lab/worklets`) | browser | 4-FSK at 17.1/17.7/18.3/19.5 kHz, 100 bit/s, Reed-Solomon. Used for the pairing beacon and for secrets by sound. |
| **CLI** (`connector/bin/vinac.mjs`) | terminal / npx | `start`, `setup`, `doctor`, `status`, `open`, `stop`, `daemon`, `mcp`. |

## Protocol v3 (Noise)

Current devices pair with **Noise XX** and open sessions with **Noise KKpsk0** (paired with v3) or
**NNpsk0** (paired with v2, both updated), keeping the code swap, the pairing key and receipts.
Wire format and downgrade rules: [NOISE.md](NOISE.md). Devices on v2 keep working through the v2
handshakes below; once a device has used v3, v2 sessions with it are refused.

## Pairing (protocol v2, for older devices)

1. Device A plays a 25-byte beacon (or shows it as a code): A's IP and port, an 8-byte one-time
   secret, A's key fingerprint. Over Tailscale, the beacon carries A's Tailscale address.
2. B connects: name, port, identity key, an ephemeral X25519 key, a commitment to a nonce, and its
   other addresses (candidates). A answers with its keys, nonce and its own candidates; B checks A's
   key against the beacon fingerprint and A's port against the beacon port.
3. B reveals its nonce; both build one transcript (secret, both identities, both ephemeral keys,
   both nonces, names, ports, roles, version) and sign it.
4. Each shows `code(transcript, own role)`; the person types it on the other device, which checks it
   against `code(transcript, other role)`. Then HMAC confirmations from the pairing key.
5. Each stores the other's public key, name, address, candidates and the pairing key (wrapped by the
   OS key store).

## Messages and requests

- **Session:** v3: a Noise handshake on `/noise` with the pairing key as psk (see NOISE.md). v2: fresh
  X25519 on both sides, authenticated by `authKey(pairingKey)`. Either way: per-direction keys and a
  receipt key; memory only; renewed hourly or after 500 uses.
- **Sealed payload:** AES-256-GCM, AAD = label | kind | from | to | session | port. Receipts are an
  HMAC over the exact ciphertext.
- **Inner message:** `{ id, text, sentAt, replyTo, by, intent?, args? }`. A request always carries
  readable `text` too, so older devices show something.
- **On arrival:** validate → replay ledger → (file: check name/size/sha256, store encrypted) →
  **firewall decision** → history → audit line. Held/blocked items never reach the agent's inbox;
  agents only get a count of what waits for the person.
- **Bigger files (192 KB – 64 MB):** sealed kind `chunk` on `/chunk`, inner `{ t, i, n, data }`
  (512 KB parts; every part but the last is full size), each with its own receipt; stored encrypted
  under `transfers/` (AAD binds device, transfer, index, count). Then one `msg` with
  `document.file.share` args `{ name, mime, size, sha256, transfer, parts }`: the receiver puts the
  parts together, checks size and sha256, stores the file and applies the firewall as usual.
- **Several devices** (`to`: `all`, a group, `A, B`): one independent sealed send per device.

## Firewall decision

```
key = intent or "@text"
rule = rules[device][key] ?? rules["*"][key] ?? default(risk(key))      # allow | ask | block
allow -> visible to the agent
ask   -> pending; the person approves (visible) or rejects (never visible)
block -> never visible; listed on the page
```

## Addresses

A peer record has `address` (used) and `alt` (candidates: Tailscale, a cable's link-local address, other private addresses). When
the address doesn't answer, the sender proves the device at each candidate (`/whoami`, HMAC from the
pairing key) and switches only on success. Incoming traffic from a new address triggers the same proof.

## Files on disk (`~/.vinac`; older installs keep `~/.agentlink`)

| File | Content |
|---|---|
| `identity.json` | device name, public key, private key wrapped by the OS key store; the X25519 key for Noise, wrapped the same way |
| `peers.json` | paired devices: public key, Noise key (v3), `proto: 3` once v3 was used, address, candidates, wrapped pairing key |
| `history.key.json` | history key, wrapped by the OS key store |
| `messages.enc` | messages, AES-256-GCM with the history key (last 500) |
| `files/*.enc` | shared files, AES-256-GCM with the history key |
| `transfers/` | parts of bigger files still arriving, encrypted; removed after an hour |
| `firewall.json` | the person's rules |
| `autoreply.json`, `autoreply-log.json` | auto-reply settings (page only) and the last 100 runs |
| `groups.json` | group names → paired device ids |
| `audit.jsonl` | hash-chained event log, no contents (rotated at 8 MB to `audit-<time>.jsonl`) |
| `secrets.json` | received secrets: names and wrapped values |
| `replay.json` | ids seen recently |
| `api-token`, `daemon.json` | local agent API token; running service's ports and pid |

## Ports

- `47800`: network side (pairing, sessions, messages, whoami). Allow on private networks.
- `47801`: page and agent API, bound to `127.0.0.1` only.
