# VINAC Link for OpenClaw

Gives OpenClaw agents the VINAC Link tools: messages and intent-checked requests between paired
computers, with the same firewall and limits as the Claude Code / Codex plugin. Optionally, a
**front desk** tells an agent (and so you) when items arrive.

OpenClaw often runs its **gateway** somewhere other than the computer that runs VINAC Link
(for example the gateway in WSL or on a server, VINAC Link on Windows). So there are two small plugins:

```
 OpenClaw agent ──tool──▶ vinac-link-gateway ──node.invoke──▶ vinac-link-node ──▶ VINAC Link service
                          (on the gateway)     (OpenClaw's own   (OpenClaw node host   (127.0.0.1:47801,
                                                node connection)  on the VINAC Link PC)   same as Claude's)
```

- **`node/`** (`vinac-link-node`): runs in the OpenClaw node host on the computer with VINAC Link.
  Declares ten node commands, one per capability: `vinac.status`, `.peers`, `.intents`,
  `.secrets`, `.pair_status`, `.pair_request`, `.send`, `.file`, `.inbox`, and `.events` (read-only,
  no message text, used only by the front desk; not an agent tool). Each checks its input strictly
  and calls VINAC Link's local agent API (starting the service in the background if needed).
  Needs `../../connector` next to it, so install the whole repository folder.
- **`gateway/`** (`vinac-link-gateway`): runs in the gateway. Registers the matching
  `vinac_*` tools (all optional, so each agent must allowlist them) and, if enabled, the front desk
  service. Each tool calls only its own fixed command on the node that offers `vinac.status` (or a
  pinned `nodeId` / `nodeName` from config). Self-contained: copy just this folder to the gateway.

Not available to OpenClaw agents, by design: confirming a pairing, seeing pairing codes,
secret values, firewall rules, approving requests, unpairing. Those stay on the VINAC Link page.

## Install

Go step by step and check after each one. Make a copy of each `openclaw.json` before editing it.

Node host (the computer with VINAC Link; Windows paths shown):

1. Copy the repository (or the npm package) to a stable place, e.g. `%USERPROFILE%\.openclaw\local-plugins\vinac-link`.
2. In the node host's `openclaw.json` (`%USERPROFILE%\.openclaw\openclaw.json`): add
   `...\local-plugins\vinac-link\openclaw\node` to `plugins.load.paths` and
   `"vinac-link-node": { "enabled": true }` to `plugins.entries`.
3. Add the commands to the node host's `--commands` list (in `node.cmd`, or wherever the node host
   is started): `vinac.status,vinac.peers,vinac.intents,vinac.secrets,vinac.pair_status,vinac.pair_request,vinac.send,vinac.file,vinac.inbox`,
   plus `vinac.events` if you will use the front desk. Restart the node host.

Gateway (wherever it runs, e.g. a WSL distro or a Linux server):

4. Copy `openclaw/gateway` to `~/.openclaw/local-plugins/vinac-link-gateway` and link
   `node_modules/openclaw` to the gateway's OpenClaw install (as other local plugins do).
5. In the gateway's `~/.openclaw/openclaw.json`: add that path to `plugins.load.paths`,
   `vinac-link-gateway` to `plugins.allow`, `"vinac-link-gateway": { "enabled": true }` to
   `plugins.entries`, the same `vinac.*` commands to the gateway's node-command allowlist, and the
   `vinac_*` tools to the `tools.allow` of each agent that should have them (at least
   `vinac_inbox` and `vinac_send` for the front desk's agent).
6. Restart the gateway, then check: `openclaw nodes list` shows the node with the `vinac.*`
   commands, `openclaw plugins inspect vinac-link-gateway` shows it loaded, and the agent can call
   `vinac_status`.

## Front desk (opt-in)

When enabled, a gateway service watches the VINAC Link node and, for each new item, puts a short
note into an agent session and wakes that agent; the agent's heartbeat reply reaches you where your
heartbeats go (by default your own DM, e.g. Telegram or Slack). Notes contain the device name,
intent and message id only, never the message. Items waiting for approval are only counted, and the
note says to approve on the VINAC Link page: **no chat message can approve a VINAC Link request.**

7. After steps 1-6 work, add to the gateway's `openclaw.json`:

   ```json
   "plugins": { "entries": { "vinac-link-gateway": {
     "enabled": true,
     "config": { "frontDesk": { "enabled": true } }
   } } }
   ```

   Options inside `frontDesk` (all optional):

   | Key | Default | |
   |---|---|---|
   | `sessionKey` | `agent:main:main` | Session that gets the notes (the main DM session in single-agent setups). |
   | `agentId` | the session's agent | Agent to wake. |
   | `minWakeSeconds` | 60 | At most one wake per this many seconds (notes still queue). |
   | `waitSeconds` | 25 | Long-poll per node call (0–30). |
   | `retrySeconds` | 30 | Pause after the node or VINAC Link is unreachable. |
   | `notifyWaiting` / `wakeOnMessages` | true / true | Which events to report. |
   | `notify` | heartbeat default | `{ "target", "to", "accountId" }`, passed as the heartbeat delivery override. |

8. Make sure `vinac.events` is in both command allowlists (steps 3 and 5) and that the agent for
   `sessionKey` has `vinac_inbox` and `vinac_send` in its `tools.allow`.
9. Restart the gateway. Send a test `agent.question.ask` from the other computer; within a minute
   the agent should mention it in your DM. A request set to "Ask me" should produce a note that
   something waits for you on the VINAC Link page.

To turn it off: set `frontDesk.enabled` to `false` (or remove it) and restart the gateway.

If notes don't reach your DM, check where your OpenClaw heartbeats are delivered and that
`sessionKey` is the session of your main DM. Questions: hello@vinac.tech.

## Tests

`cd ../connector && npm test` includes `tests/openclaw.test.mjs` (manifests and tool lists, input
checks, gateway tool → node command → VINAC Link on two paired demo devices, including the
firewall, and safe node selection) and `tests/frontdesk.test.mjs` (notes and wakes without message
text, counts for waiting items, wake rate limit, restart summary, offline node).
