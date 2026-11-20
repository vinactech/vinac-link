# connector/ (the VINAC Link service)

Developer notes. For users, start with the [main README](../README.md); security is in
[SECURITY.md](../SECURITY.md), the protocol in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Run

- `node bin/vinac.mjs start`: start in the background and open the page (what `npx vinac-link` does)
- `node bin/vinac.mjs daemon --open`: run in this window instead (Ctrl+C stops it)
- Windows: double-click `start-vinac.cmd`; macOS: `start-vinac.command`
- No `npm install` needed; Node 22+. Keep this folder next to `../lab` (the sound modem).

Settings (environment): `VINAC_HOME` (default `~/.vinac`, or `~/.agentlink` if only that exists),
`VINAC_PORT` (47800; the page is port + 1), `VINAC_KEYSTORE` (`dpapi`, `keychain`,
`secret-service`, or `file` for tests only), `VINAC_LAN_HOST`, `VINAC_NO_BROWSER`, `VINAC_INPROCESS`.
The older `AGENTLINK_*` names still work.

## Code

| File | |
|---|---|
| `src/daemon.js` | the service: pairing, sessions, messages, firewall, files, secrets, page and agent API routes |
| `src/crypto.js` | identities, pairing transcript and codes, session keys, receipts, sealing |
| `src/firewall.js`, `src/logos.js` | rules and decisions; the intent catalog and risk levels |
| `src/store.js`, `src/keystore.js` | files on disk (atomic, encrypted history and files); OS key stores |
| `src/net.js` | addresses (LAN, Tailscale, candidates), HTTP helpers, rate limits |
| `src/mcp.js`, `src/setup.js` | MCP server and agent API client; hook, doctor, setup text, stop |
| `bin/vinac.mjs` | the CLI |
| `web/` | the page (conversations, pairing, secrets, firewall) and the beacon / secret frame formats |

## Tests

`npm test`: pairing, messaging, secrets (including sound through a simulated noisy room), the MCP
server, plugin files and hook, the background service, the firewall (including attempts to get
around it), agent intents, file sharing, Tailscale address fallback, the Linux keyring (with a
stand-in for `secret-tool`), OpenClaw plugins, and DPAPI on Windows. Everything listens on
127.0.0.1 only; nothing plays sound.
