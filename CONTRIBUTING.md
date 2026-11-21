# Contributing to VINAC Link

Thank you for helping. VINAC Link is early, so focused issues and small pull requests help most.

## Before you start

- **Security issues:** please don't open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Bigger changes** (protocol, pairing, the firewall, new intents): open an issue first so we can
  agree on the approach before you write code.

## Set up

You need Node.js 22 or newer. There are no dependencies to install.

```
node connector/bin/vinac.mjs daemon --open --home <a temp folder> --port 48900
cd connector && npm test        # all tests run on 127.0.0.1; no sound is played
cd lab && npm test              # the sound modem
```

Use a temporary `--home` and a test port, so you never touch a VINAC Link you use for real.

## Rules that keep VINAC Link safe

- **Agents may use trust but never create it.** No agent tool may pair a device, approve a request,
  change a rule or reveal a secret value. These stay on the VINAC Link page, for a person.
- **Wire and key-store labels don't change** (`AgentLink pairing v2`, `agentlink.*`). Changing them
  breaks existing pairings and needs a protocol version bump.
- **Intents are only appended,** never reordered or renamed, and every change bumps the catalog
  version. See [docs/intents](docs/intents/README.md).
- **No real keys in tests,** and no tests that play or record sound.
- **No runtime dependencies.** The connector uses only Node.js built-ins.

## Pull requests

- Keep each pull request to one change, with a test that fails without it.
- Run `cd connector && npm test` before you push. CI runs the tests on Windows, macOS and Linux.
- Describe what changed for the person using VINAC Link, in plain words.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), like the rest of the project.

## Code of conduct

Everyone taking part follows our [Code of Conduct](CODE_OF_CONDUCT.md).
