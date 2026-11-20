# Getting started

You need **two computers** (Windows, macOS or Linux) with **Node.js 22 or newer**, able to reach
each other: the same Wi-Fi, a hotspot, a cable between them, or both on
[Tailscale](https://tailscale.com). No internet is needed.

## 1. Start VINAC Link on both

**Tester package:** unzip it, open `START-HERE.html`, double-click **Start VINAC Link** (`.cmd` on
Windows, `.command` on macOS; `sh start-linux.sh` on Linux).

**Checkout or folder:** `node connector/bin/vinac.mjs start` (later, from npm: `npx vinac-link`).

It starts in the background, opens its page (`http://127.0.0.1:47801`) and prints this device's
name, address and fingerprint. It keeps running after you close the window; **Stop VINAC Link** (or
`vinac stop`) stops it.

On first start your OS may ask:
- **Windows:** allow Node.js on *private* networks (the other computer connects on port 47800).
- **macOS:** allow Keychain access (VINAC Link keeps its keys there), and allow incoming connections.
  The first time, open the `.command` files with right-click → Open.
- **Linux:** a keyring must be running (GNOME Keyring or KWallet) with `secret-tool` installed
  (`sudo apt install libsecret-tools`).

## 2. Pair them

On the page, **Pair a device**:

1. Computer A: **Announce this device**. It plays a short, almost inaudible sound for 6 seconds.
2. Computer B: **Listen for a device** (allow the microphone). No sound, or too far apart? Type the
   code shown under *No sound?* on A into B instead.
3. Each screen now shows a **6-digit code**. Type **A's code on B** and **B's code on A**.

Done: both list each other under conversations. Only a person can do step 3; agents can open the
page and watch, nothing more. Details: [guide/pairing.md](guide/pairing.md).

## 3. Connect your agent

```
vinac setup
```

prints the steps for each app, with the real paths on your computer (**Connect my agent** in the
package does this, and adds the Claude Code plugin if you say yes). In short:

| App | How |
|---|---|
| Claude Code | `claude plugin marketplace add <folder>` then `claude plugin install vinac-link@vinac` |
| Codex | `codex mcp add vinac -- node <folder>/connector/bin/vinac.mjs mcp` |
| LM Studio, Goose, Open WebUI (local models) | an MCP stdio server: `node <folder>/connector/bin/vinac.mjs mcp --simple` |
| Cursor, LibreChat, other MCP apps | an MCP stdio server: `node <folder>/connector/bin/vinac.mjs mcp` |
| OpenClaw | [openclaw/README.md](../openclaw/README.md) |

More: [guide/agents.md](guide/agents.md).

## 4. Try it

Ask your agent on A:

> Ask my other computer's agent which branch the release is on.

It sends `agent.question.ask`. On B, questions arrive straight away (risk *info*), and B's agent
answers with `agent.question.answer`.

Then try something that needs your OK:

> Ask the other computer to review my current diff.

On B, **Firewall → Waiting for you** shows `agent.review.request` with the diff. Approve it and B's
agent sees it. Read [guide/firewall.md](guide/firewall.md) to set your own rules.

More to try: send a file with the paperclip, `vinac git send` a branch, turn on auto-reply with a
local model, or unplug the internet and try again ([offline use](guide/offline.md)).

## 5. Check everything

```
vinac doctor
```

shows Node, the key store, the service, the network address, paired devices (online/offline), git,
and anything waiting for you.
