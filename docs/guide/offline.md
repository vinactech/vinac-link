# Offline use

VINAC Link is built for agents that work **without the internet**: on a local model, on a closed
network, or on machines that only meet now and then. Nothing in it needs a server, an account or an
internet connection.

## What works offline, and what doesn't

| | Without internet |
|---|---|
| Pairing (nearby devices, invite, typed code or sound; compare and Allow) | ✓ |
| Messages, requests, the firewall, approvals | ✓ |
| Files up to 64 MB, git branches | ✓ |
| Secrets by sound or Wi-Fi, `vinac run` | ✓ |
| Auto-reply with a **local model** (Ollama, LM Studio) | ✓ |
| Auto-reply with Claude Code, agents on cloud models (Claude Code, Codex) | ✗ the model needs the internet; VINAC Link itself doesn't |
| Tailscale | ✗ needs the internet to connect |
| Installing | ✓ from the tester package (a zip, no downloads at install time); `npx` needs the internet |

## Connecting two computers without the internet

Any network the two can share works: a router with no internet, a phone or laptop **hotspot**, or a
**network cable** straight between them. See [networks](networks.md#no-internet).

## Offline agents

1. Run a local model: [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai), downloaded
   while you still have the internet.
2. Give an agent app the VINAC Link tools: LM Studio, Goose or Open WebUI
   ([how](agents.md#local-models-offline-agents)). Use `mcp --simple` for small models.
3. Or skip the agent app: let the VINAC Link service answer questions itself with the local model
   ([auto-reply, local engine](auto-mode.md#local-model-engine)).

## Moving work between machines

- **Files:** `vinac send-file`, up to 64 MB, encrypted, checked by SHA-256 on arrival.
- **Code:** `vinac git send` / `vinac git fetch`: branches as git bundles, landing as
  `vinac/<device>/<branch>`, never merged for you.
- **Status and questions:** `agent.status.update`, `agent.question.ask`; to several machines at
  once with groups (`vinac group set site "PC 1,PC 2"`).
- **Keys:** secrets by sound or Wi-Fi, used with `vinac run` after approval on the page.

## Keeping a record

Sites without the internet often need to show what moved where. `vinac audit` lists every pairing,
message, file, approval and secret use (never contents), and `vinac audit --verify` shows whether
any line was changed or removed. See [command line → audit](cli.md#audit).

## Not yet

- **Machines that are never on together** (air-gapped, a ship and the shore): today both must be
  reachable at the moment of sending. Sealed bundles carried on a USB stick are next on the
  roadmap.
- **No network at all** between machines close to each other: sound carries the pairing beacon and
  secrets only. Short messages by sound, QR codes, Bluetooth and LoRa radios are ideas on the roadmap.
