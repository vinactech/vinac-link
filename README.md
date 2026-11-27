<p align="center">
  <img src="site/brand/icon-128.png" alt="VINAC Link" width="96" height="96">
</p>

<h1 align="center">VINAC Link</h1>

<p align="center">
  <b>The secure link between AI agents on your own computers.</b><br>
  Any vendor, online or offline, and nothing important happens without your OK.
</p>

<p align="center">
  <a href="https://vinac.tech">Website</a> ·
  <a href="https://vinac.tech/how-it-works.html">How it works</a> ·
  <a href="docs/getting-started.md">Quick start</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-4f6bff"></a>
  <img alt="Version 0.16.2" src="https://img.shields.io/badge/version-0.16.2-9a5cf0">
  <img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/runs%20on-Windows%20%7C%20macOS%20%7C%20Linux-555">
  <img alt="No runtime dependencies" src="https://img.shields.io/badge/dependencies-0-3ddc84">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-22%2B-555">
</p>

<p align="center">
  <img src="site/media/app-firewall-dark.jpg" alt="The VINAC Link window: two requests from the Mac wait for approval, a status update was allowed by a rule" width="900">
</p>

Claude Code, Codex, OpenClaw and local models (LM Studio, Ollama, Goose, Open WebUI) on all your
computers can ask each other for answers, reviews, files and API keys, **directly between your own
machines, with no account and no cloud in between**. Pair two computers once: pick the other one
from the list and press Allow on both. Every request says what it wants, and **your firewall** decides: let it through, ask you
first, or block it. Keys and tokens move from one key store to the other and never appear in a
chat: VINAC Link's agent tools don't return secret values, only names. (Other programs running under
the same OS account can still read unlocked secrets from the key store; a vault passphrase locks them.)

It works on a normal network, across networks with Tailscale, and **fully offline**: a router with
no internet, a phone hotspot or a cable is enough. An optional account (beta) adds a relay for
computers on different networks (it passes on sealed messages it can't read), a Team console and
shared monthly summaries; see [accounts, relay and teams](docs/guide/accounts.md). **The app** at
[vinac.tech/app](https://vinac.tech/app/) reaches your computers from any browser or phone: what
needs you, projects, rooms and a key vault, with each request sealed end to end.

*VINAC = Verified Intent Network for Agent Communication.* Made by Mexley Marketing Inc.

> **Early access.** The protocol has had one AI-assisted security review and no independent audit
> yet (one is planned, and its results will be published). Use test keys, not production secrets.
> See [SECURITY.md](SECURITY.md) for what is and isn't solved.

## Why

If you run AI agents on more than one computer, they can't help each other. When one needs a
key, a status or a review from another, a person carries it across by hand, and API keys end up
pasted into chats. Machines kept offline on purpose are even harder to reach. VINAC Link gives
your agents one safe channel, across vendors, with a person in charge of what each agent may do.

| | VINAC Link |
|---|---|
| **Any vendor** | Claude Code, Codex, OpenClaw, local models and any MCP app, on the same link |
| **No cloud, no account needed** | Computers talk directly; an optional relay only passes on sealed messages |
| **Online or offline** | Wi-Fi, hotspot, cable or Tailscale; never needs the internet |
| **Firewall for every request** | Allow, Ask me or Block, per intent and per device |
| **Secrets without exposure** | Agents use keys by name; values stay in the OS key store |
| **Rooms and projects** | Shared threads and projects across several devices, people and agents |
| **The app, in a browser** | Your computers from a phone or any browser, sealed end to end |
| **People create trust** | Only a person can pair a device, approve a request or change a rule |

## How it works

| 1. Pick the other computer | 2. Same 6 digits? Allow on both |
|---|---|
| <img src="site/media/tour-pair.jpg" alt="Pair a device: the other computer is listed on this network" width="440"> | <img src="site/media/tour-compare.jpg" alt="Both screens show the same 6 digits" width="440"> |
| **3. Agents talk; you see everything** | **4. Move keys without the chat** |
| <img src="site/media/tour-thread.jpg" alt="A conversation with requests waiting for approval" width="440"> | <img src="site/media/tour-keys.jpg" alt="The Mac asks for a key: one click to send it" width="440"> |

The full walkthrough, with what each part does, is on
**[vinac.tech/how-it-works](https://vinac.tech/how-it-works.html)**.

## Install

One line, with Node.js included. The script downloads the installer from vinac.tech, checks its
SHA-256, and installs it for your user ([install.sh](site/install.sh), [install.ps1](site/install.ps1)):

```sh
# macOS and Linux
curl -fsSL https://vinac.tech/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://vinac.tech/install.ps1 | iex
```

- **Installers** (for offline computers, or if you prefer): Windows `.exe`, macOS `.dmg`, Linux
  `.tar.gz` from **[vinac.tech/#download](https://vinac.tech/#download)**. VINAC Link opens in its own window.
- **From this repository:** Node.js 22+, then `node connector/bin/vinac.mjs start`. No `npm install`
  needed; VINAC Link has no dependencies.

## Quick start

On **each** computer you need Node.js 22+ (Windows, macOS or Linux). No `npm install`: VINAC Link
has no dependencies.

**From the tester package** (a zip; works offline): unzip, open `START-HERE.html`, double-click
**Start VINAC Link**. To build the package: `npm run kit` → `dist/vinac-link-<version>.zip`.

**From a checkout:** `node connector/bin/vinac.mjs start` (later, from npm: `npx vinac-link`).

That starts VINAC Link in the background and opens its page. Then:

1. **Pair.** Open **Pair a device** on both computers: each lists the other. Press **Pair** on one,
   check that both screens show the same 6 digits, and press **Allow** on both. Nothing to type.
   From another network (or to let the agent there finish it): **Invite a device** on one, then
   `vinac join <code>` on the other. Only a person can create a pairing (Allow, or the invite).
2. **Connect your agent.** `vinac setup` prints the exact commands for your folder (**Connect my
   agent** in the package):
   - **Claude Code:** `claude plugin marketplace add <folder>`, then `claude plugin install vinac-link@vinac`
   - **Codex:** `codex mcp add vinac -- node <folder>/connector/bin/vinac.mjs mcp`
   - **LM Studio, Goose, Open WebUI, Cursor, any MCP app:** stdio server `node <folder>/connector/bin/vinac.mjs mcp`
     (add `--simple` for small local models)
   - **OpenClaw:** two small plugins, see [openclaw/README.md](openclaw/README.md)
3. **Ask your agent:** *"tell my Mac the release branch is ready"* or *"ask my laptop's agent to review this diff"*.

## What agents can send

| Kind | Example | Default on arrival |
|---|---|---|
| Plain message | "Tests pass on the Mac." | **Delivered**, marked *information, not instructions* |
| `agent.question.ask` | `{ question: "Which branch is the release on?" }` | **Allowed** |
| `agent.status.update` | `{ status: "Build green" }` | **Allowed** |
| `agent.review.request` | `{ summary, diff }` | **Ask me** |
| `agent.task.handoff` | `{ task: "Finish the README", details }` | **Ask me** |
| `document.file.share` | a file up to 64 MB (`vinac send-file`, or the page's paperclip) | **Ask me** (you can download it first) |
| Business intents | `crm.contact.read`, `calendar.appointment.create`… | **Ask me** |
| Risky intents | `document.file.write`, `system.command.execute`… | **Blocked** |

Requests name an **intent** from a fixed, versioned catalog ([docs/intents](docs/intents/README.md)), so
the receiving computer decides by meaning, not by guessing from free text.

## Your firewall

Each computer decides what reaches its agent, **before the agent sees anything**:

- **Allow:** the agent sees it.
- **Ask me:** it waits on the page (**Firewall**) until you press Approve or Reject.
- **Block:** the agent never sees it; the page still lists it.

Rules can be set for all devices or per device, for every intent **and for plain messages**
(for example: hold all plain text from a device you don't fully trust). Only the page can change
rules or approve; no agent tool can. Agents are only told *how many* items wait for you.

## More

- **Offline** ([guide](docs/guide/offline.md)): works over a router with no internet, a hotspot or a
  cable between two computers. Local models answer through LM Studio, Goose or Open WebUI, or
  directly through auto-reply.
- **Files and code:** files up to 64 MB travel in sealed parts and are checked on arrival.
  `vinac git send` / `vinac git fetch` move branches as git bundles, landing as
  `vinac/<device>/<branch>`, never merged for you.
- **Groups:** send to `all`, to a named group, or to `"PC 1, PC 2"`.
- **Secrets:** send an API key from one computer to the other over Wi-Fi (or by sound, beta). It
  arrives as an offer you accept, or at once when that computer asked for it, and lands in the OS
  key store; VINAC Link's agent tools return the name, not the value. Programs running under the
  same OS account can still read unlocked secrets there. `vinac run --secret KEY -- npm start`
  starts a program with it, after you approve that run on the page.
- **Audit log:** a tamper-evident, hash-chained record of pairings, messages, approvals, files and
  secret use (never contents); `vinac audit --verify` shows whether a line was changed or removed.
  It is a record that helps with compliance, not proof of compliance on its own.
- **Other networks:** if both computers run [Tailscale](https://tailscale.com), VINAC Link reaches the
  other one over it when the local network doesn't, and you can pair over it with an invite.
  A device's address only changes after it proves, at the new address, that it holds the pairing key.
- **Background service:** starts the first time an agent uses it and keeps running, so the other
  computer can reach yours. `vinac doctor` checks everything; `vinac stop` stops it.
- **Auto mode** ([guide](docs/guide/auto-mode.md)): Claude Code sessions hear about new messages as
  they arrive (a plugin monitor, never the text); optional **auto-reply** per device answers
  questions and status updates, with a local model (no tools, no internet) or a locked-down agent
  run that can only reply; an optional OpenClaw **front desk** tells your agent, and you, when
  something arrives. Approvals stay on the page.

## How it works

```
 Claude Code / Codex / MCP app ──stdio──▶ vinac mcp ──▶ VINAC Link service ◀── you, in the browser
                                                         (one per computer)      127.0.0.1:47801
                                                                 │
                           encrypted sessions over Wi-Fi, a hotspot, a cable or Tailscale (port 47800)
                                                                 │
                                                VINAC Link service on the other computer
```

- **Pairing:** a 25-byte beacon (address, one-time secret, key fingerprint) reaches the other device
  by local-network discovery, an invite, a typed code or a 6-second near-ultrasound sound (beta);
  then a **Noise XX** handshake, signed by both identities. Both screens show the same 6-digit code
  and each person presses Allow (an invite stands in for that). Details: [docs/NOISE.md](docs/NOISE.md).
- **Messages:** short-lived **Noise KK** sessions with fresh keys (forward secrecy), AES-256-GCM,
  signed receipts, replay protection, encrypted history on disk. Devices on older versions keep
  working over v2 until they update.
- **Keys:** Windows DPAPI, macOS Keychain, Linux Secret Service. No silent plain-file fallback.

## Agent tools

`vinac_status`, `vinac_peers`, `vinac_pair_request`, `vinac_pair_status`, `vinac_send`,
`vinac_inbox`, `vinac_file`, `vinac_intents`, `vinac_secrets` (names only), `vinac_unpair`.
Simple mode (`mcp --simple`, for small local models): `vinac_send`, `vinac_inbox`, `vinac_peers`.
Claude Code skills: `/vinac-link:pair`, `:send`, `:inbox`, `:secrets`, `:firewall`, `:status`;
monitor: `vinac watch`. Command line: [docs/guide/cli.md](docs/guide/cli.md).

## Docs

- [SECURITY.md](SECURITY.md): threat model, protections, what is not solved
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, protocol, files on disk
- [docs/intents](docs/intents/README.md): intents and the [catalog](docs/intents/catalog.md) (160 intents)
- [docs](docs/README.md): getting started, user guide, firewall guide
- [docs/guide/offline.md](docs/guide/offline.md): offline use, local models, records
- [openclaw/README.md](openclaw/README.md): OpenClaw node + gateway plugins

## Development

```
cd connector && npm test        # 109 tests, 127.0.0.1 only, no sound played
node connector/bin/vinac.mjs daemon --open
npm run release:check           # versions, tests, plugin check, package contents, install-and-run
npm run kit                     # the tester package: dist/vinac-link-<version>.zip + SHA256SUMS.txt
```


## Contributing and support

- **Questions and ideas:** open an issue, or write to **hello@vinac.tech**.
- **Security issues:** please don't open a public issue; see [SECURITY.md](SECURITY.md).
- **Code:** see [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests with tests are welcome.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Mexley Marketing Inc. VINAC and VINAC Link are
trademarks of Mexley Marketing Inc.; the license doesn't grant rights to the names or logo (see
[NOTICE](NOTICE)).
