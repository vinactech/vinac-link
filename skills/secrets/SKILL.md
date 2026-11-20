---
name: secrets
description: Help the person move an API key or token between paired computers with VINAC Link (by sound or Wi-Fi) without the value ever appearing in the chat. Use when the person wants to share or receive a key, token or password between their devices.
---

# Move a secret between devices

Secret values never pass through you. You guide; the person types and approves.

1. Call `vinac_peers` to confirm the two devices are paired (otherwise use the `pair` skill).
2. Tell the person:
   - On the **receiving** computer: VINAC Link page → **Secrets** → **Receive a secret**
     (it accepts secrets for 3 minutes).
   - On the **sending** computer: open the conversation with that device → key button →
     enter a name (like `OPENAI_API_KEY`) and the value → **By sound** (~15 s, devices close
     together) or **By Wi-Fi**.
   - If a secret with the same name already exists from that device, the new one waits as
     **Replacement waiting** until the person presses **Approve**.
3. Afterwards call `vinac_secrets` to confirm the **name** arrived.

Never ask the person to paste a secret into the chat, and never read secret values by other
means (key store, files in `~/.vinac`, the page or its endpoints). If the person pastes one
anyway, don't repeat it and suggest they rotate it.
