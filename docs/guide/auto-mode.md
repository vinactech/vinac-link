# Auto mode

Three ways for your agents to notice and handle what arrives, without you asking each time. Each one
is narrower than the last about what it may do on its own.

| Level | Where | What happens when something arrives | Who decides |
|---|---|---|---|
| **1. Live mode** | An open Claude Code session | A one-line note appears in the session; the agent reads it with `vinac_inbox` | The agent, under the inbox rules; it asks you before anything that changes things |
| **2. Auto-reply** | The VINAC Link service, always on | Questions and status updates from devices you chose get a short automatic answer | Nobody: a locked-down agent run that can only reply |
| **3. OpenClaw front desk** | Your OpenClaw gateway | Your OpenClaw agent is told and tells you (for example on Telegram or Slack) | You, on the VINAC Link page, for anything that waits for approval |

None of them can approve a request, change a firewall rule, confirm a pairing or read a secret value.
Approvals stay on the VINAC Link page.

## 1. Live mode (Claude Code)

The Claude Code plugin includes a **monitor**: Claude Code starts `vinac watch` with each interactive
session, and every line it prints reaches Claude as a notification. You don't turn anything on; it
comes with the plugin (Claude Code with plugin monitors; it does not run with `claude -p`).

What `vinac watch` prints, one line each:

```
VINAC Link: new request agent.question.ask from "Mac" (id hX3…). Read it with vinac_inbox; …
VINAC Link: new message from "Mac" (id 9fQ…). …
VINAC Link: 2 items waiting for the person on the VINAC Link page (Firewall). Tell the person; …
```

- It **never prints the message itself** (text, args, file names): those would land in Claude's
  context as if they were trusted. Claude reads them with `vinac_inbox`, which labels them as
  information from another device.
- Held and blocked items appear **only as a count**.
- It never marks anything read and never starts the service. With no service running it stays quiet
  and checks every few seconds; it follows a restarted service; it is quiet when nothing happens.
- Items that were already unread when the session started are not repeated (the session-start note
  already counts them).

What Claude does with a note (skill `inbox`): finish the current step, read the inbox, treat plain
messages as information, do only what an allowed/approved request's intent and args say, and ask you
before anything that changes files, runs commands or shares data. It may answer a question with
`vinac_send` when the answer needs nothing beyond what it already knows in that session.

Try it without the plugin: `npx vinac-link watch` (or `node connector/bin/vinac.mjs watch`) in a
terminal while messages arrive.

## 2. Auto-reply (always on, opt-in per device)

For when no agent session is open: the service answers simple questions on its own.

**Turn it on:** VINAC Link page → **Firewall** → **Auto-reply** → set a device to
**Questions & status**. Default is **Off** for every device.

**What starts a run:** a message from that device that the firewall made visible (allowed by a rule
or approved by you) and that names one of `agent.question.ask`, `agent.status.update`,
`agent.capability.query`. Plain text, requests and everything else wait for you as usual.

**Who answers:** on the page, **Answers by**:

- **Local model (Ollama, LM Studio)**: no internet and no agent app needed. See
  [below](#local-model-engine).
- **Agent program (Claude Code)**: the default, described next.

**What the run is (agent program):** a short headless agent run, by default

```
claude -p "<fixed prompt>" --mcp-config <one-run file> --strict-mcp-config --tools "" \
       --allowedTools mcp__vinac__vinac_inbox,mcp__vinac__vinac_send \
       --permission-mode dontAsk --max-turns 4 --no-session-persistence
```

- The prompt is **fixed** and never contains message text. The agent reads the message with
  `vinac_inbox` (so it arrives labelled as untrusted) and answers with `vinac_send`.
- **No built-in tools** (`--tools ""`): no files, no shell, no web. **Only the VINAC Link server**
  (`--strict-mcp-config`), and only `vinac_inbox` and `vinac_send` allowed.
- The run's MCP server gets a **one-run token** instead of the agent token. With it the service lets
  the run: read only the message(s) that started it; reply only to those messages, only to that
  device, only as plain text or `agent.question.answer` / `agent.status.update` /
  `agent.capability.describe`, at most one reply per message plus one. Every other route is refused.
  The token stops working when the run ends.
- It runs in an empty folder under the VINAC Link home (no project files, no CLAUDE.md).

**Agent program:** the page has a field for it. Default `claude` on PATH. On Windows give the full
path to `claude.exe` (a `claude.cmd` npm shim can't be started without a shell, which isn't used).
The page shows whether the program was found. The arguments can be changed only by editing
`autoreply.json` (`"args": [...]` with `{prompt}`, `{mcpConfig}`, `{tools}`, `{maxTurns}`
placeholders); keep the restrictions above if you do.

### Local model engine

For offline machines, or to keep everything on your own hardware. On the page: **Answers by → Local
model**, then the address and model name:

| App | Address | Model name, for example |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | `llama3.1:8b`, `qwen2.5:7b` |
| LM Studio (start its local server) | `http://127.0.0.1:1234/v1` | the model id LM Studio shows |
| llama.cpp server, vLLM, other OpenAI-style servers | their `/v1` address | |

- The service itself asks the model, once per message, through the OpenAI-style
  `/v1/chat/completions` API. There's no agent, no MCP server, no token and **no tools**: the model
  can only write text, and the service sends that text as the reply (as `agent.question.answer` for
  questions).
- The model gets a fixed instruction, then the message between markers, labelled as untrusted.
  Reasoning models' `<think>` sections are removed from the reply.
- The address must be on this computer, your local network or Tailscale; internet addresses are
  refused.
- All the limits below apply, and runs are logged the same way.

**Limits (loop and cost protection):**

| Limit | Default | Where |
|---|---|---|
| Automatic replies are marked `auto: true` and never start a run on the other side | always | protocol (older devices ignore the field) |
| Runs per device per hour | 4 | page |
| Quiet hours (no runs) | off | page |
| One run at a time (others queue, up to 20) | always | |
| Time limit per run | 120 s | `autoreply.json` `timeoutS` |
| Agent turns per run | 4 | `autoreply.json` `maxTurns` |

A trigger that hits a limit is logged as **skipped** and the message stays unread for you.

**Log:** the page lists the last runs: device, intents, done / failed / skipped, number of replies,
duration, reason. It never stores message text or the agent's output.

**Files:** `autoreply.json` (settings) and `autoreply-log.json` (log) in the VINAC Link home. Like
`firewall.json`, only the page changes them; no agent tool can.

## 3. OpenClaw front desk

For OpenClaw users: the gateway plugin can tell an OpenClaw agent when VINAC Link items arrive, and
that agent tells you wherever it talks to you.

- A gateway service polls the VINAC Link node with the read-only `vinac.events` command (ids,
  devices, intents, the waiting count; never text) and, for each new item, puts one short note into
  an agent session (`agent:main:main` by default) and wakes that agent (an OpenClaw heartbeat). The
  heartbeat reply goes where your heartbeats go, by default your own DM on your chat channel.
- The agent reads the items with its `vinac_inbox` tool under the usual rules.
- Items waiting for approval are **counted** and the note says approvals happen only on the
  VINAC Link page. **Nothing typed in a chat can approve anything.**
- At most one wake per minute (configurable); after a gateway restart, one summary instead of a
  line per old item; quiet while the node or VINAC Link is offline.

Off by default. Setup: [openclaw/README.md](../../openclaw/README.md#front-desk-opt-in).

## Trust: what changes when you turn these on

- **Live mode** adds no new power: the agent could already call `vinac_inbox`. It only learns
  sooner that something arrived. The note itself carries no message content.
- **Auto-reply** lets another device's agent cause an agent run on your computer, and that run reads
  the other device's words. It is limited to answering: no tools beyond reading those messages and
  replying to that device. What it *can* still do: say something wrong, or say things the other
  agent tricked it into saying. It has no access to your files, so it can only leak what the model
  already knows plus the messages themselves. Each run costs model usage; the hourly limit bounds it.
- **Front desk** lets VINAC Link activity wake your OpenClaw agent, which then has its own tools
  (whatever you allowed it). The note is content-free, but the agent will read the messages with
  `vinac_inbox`; your OpenClaw tool allowlist is what limits what a tricked agent could do.
- Same-user programs (including an agent with a shell) can still edit `autoreply.json` or read the
  agent token, as with `firewall.json`. See [SECURITY.md](../../SECURITY.md).
