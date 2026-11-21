# Command line

Run with `npx vinac-link <command>` (once it's on npm), `vinac <command>` from the tester package's
folder (`./vinac` on macOS and Linux), or `node connector/bin/vinac.mjs <command>` from anywhere.

| Command | What it does |
|---|---|
| `start` *(default)* | Starts the service in the background (if it isn't running), opens the page in its own app window (Edge, Chrome, Brave or Chromium; otherwise a browser tab), prints this device and next steps. `--tab` opens a normal browser tab instead, `--no-open` opens nothing. |
| `setup` | Prints how to connect Claude Code, Codex, OpenClaw or any MCP app. Changes nothing. |
| `doctor` | Checks Node, the key store, the service, paired devices and anything waiting. Changes nothing. `--json` for scripts. |
| `status` | This device, pairing in progress, unread messages (JSON). |
| `open` | Opens the page. |
| `stop` | Stops the background service (do this after updating). |
| `daemon` | Runs the service in this terminal (`--name "My PC"`, `--open`, `--host IP` to advertise a specific address). |
| `mcp` | The MCP server on stdio, for agent apps. `--simple` lists only `vinac_send`, `vinac_inbox` and `vinac_peers` (for small local models). |
| `watch` | Prints one line per new message the agent may read and a count when more items wait for you; never the text; marks nothing read; doesn't start the service. Used by the Claude Code plugin's monitor ([auto mode](auto-mode.md)). |
| `send-file PATH` | Sends a file up to 64 MB. `--to DEVICE` (or a group, `all`, `"A, B"`), `--text "note"`. |
| `files` | Lists received files the firewall let through (`--json`). |
| `file save ID` | Saves a received file. `--out DIR` (default: here); never overwrites. |
| `git send` | Sends the current branch as a git bundle. `--to`, `--branch B`, `--since REF` (only newer commits), `--all`, `--repo DIR`. |
| `git fetch ID` | Checks a received bundle and adds its branches as `vinac/<device>/<branch>`. Nothing is checked out or merged. `--repo DIR`. |
| `group` | `group list`, `group set NAME "PC 1,PC 2"`, `group remove NAME`. Send to a group by its name. |
| `audit` | The latest entries of the audit log (`--last N`, `--json`). `--verify` checks the whole chain. |
| `run` | `run --secret NAME[=ENV_VAR] ... -- COMMAND ARGS`: starts the command with secrets in its environment after the person approves on the page. |
| `version` | Prints the version. |

Options for most commands: `--home DIR` (default `~/.vinac`), `--port N` (default 47800).

## Audit

`audit.jsonl` in the VINAC Link home gets one line per event: pairing and unpairing, each message
sent or received (id, device, intent, size, what the firewall did), approvals, rule and auto-reply
changes, secrets received, sent, revealed, deleted or used by `vinac run`, files saved, and
auto-reply runs. Never message text, args, file contents or secret values.

Each line includes the SHA-256 of the line before it, so `vinac audit --verify` finds any line that
was changed or removed. A program running as you could still rewrite the whole file; to catch
that, keep the `Latest hash` that `--verify` prints somewhere else (a note, a printout) and compare
later.

## Environment

| Variable | |
|---|---|
| `VINAC_HOME` | where identity, pairings and history live |
| `VINAC_PORT` | network port (the page uses port + 1) |
| `VINAC_KEYSTORE` | `dpapi`, `keychain`, `secret-service`; `file` only for tests |
| `VINAC_LAN_HOST` | address to listen on (default all) |
| `VINAC_NO_BROWSER` | don't open browsers |
| `VINAC_INPROCESS` | run the service inside the MCP process instead of in the background |
| `VINAC_API_TOKEN` | set by the service for auto-reply runs (a one-run token); not for people to set |

The older `AGENTLINK_*` names still work.
