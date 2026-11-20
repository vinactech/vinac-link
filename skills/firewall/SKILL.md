---
name: firewall
description: Explain and help the person set VINAC Link's firewall, which decides what paired devices may ask this computer's agent to do (intents like crm.contact.read). Use when the person asks what other devices are allowed to request, why a request didn't reach the agent, or wants to allow or block something.
---

# VINAC Link firewall

Requests are messages that name an **intent** (a fixed catalog, see `vinac_intents`)
plus arguments. This device's firewall decides each one **when it arrives, before you see it**:

| Rule | What happens |
|---|---|
| **Allow** | You see the request in `vinac_inbox`. |
| **Ask me** | It waits on the VINAC Link page until the person approves it. Then you see it. |
| **Block** | You never see it. The page lists it. |

Defaults: requests that only look things up or change records → **Ask me**; requests that write,
move or rename files, run commands or control processes → **Block**. Rules can be set for all
devices or per device. Plain messages (no intent) always arrive, marked as information.

**Only the person can change rules or approve requests**, on the VINAC Link page → **Firewall**.
No tool does it, and you must not try through files (`~/.vinac/firewall.json`), the page or
its endpoints. If the person wants a change, tell them where to click:

1. Open the page (`vinac_pair_request` opens it, or `node "${CLAUDE_PLUGIN_ROOT}/connector/bin/vinac.mjs" open`).
2. **Firewall** → **Rules for**: pick *All devices* or one device → change the intent's setting.
3. Requests waiting for them are at the top, with **Approve** / **Reject**.

`vinac_inbox` tells you how many requests are waiting (`waitingForPerson`), never what they are.
Even an approved request only covers what its intent and args say; check with the person before
anything that changes files, runs commands or shares data.
