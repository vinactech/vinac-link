---
name: secrets
description: Help the person move an API key or token between paired computers with VINAC Link (by Wi-Fi, or sound in beta) without the value ever appearing in the chat, including asking another device for a key a program needs. Use when the person wants to share, receive or request a key, token or password between their devices.
---

# Move a secret between devices

Secret values never pass through you. You guide, and you can ask; the person sends and approves.

1. Call `vinac_peers` to confirm the two devices are paired (otherwise use the `pair` skill).
2. **This computer needs a key** (for example `.env.example` lists `STRIPE_KEY` and `vinac_secrets`
   doesn't have it): ask the device that has it, with `vinac_send` and
   `intent: "person.secret.request"`, `args: { "name": "STRIPE_KEY", "reason": "npm start needs it" }`.
   Its person sees *"<this device> asks for STRIPE_KEY · Send"* on the Secrets page and sends it with
   one click. Because this device asked, the key is accepted here automatically (for an hour).
   Then check `vinac_secrets` for the name.
3. **The person wants to send one**: on the sending computer, **Secrets** → **Send** (or **Send…**
   on a stored secret) → pick the device → **Wi-Fi**. On the receiving computer it arrives as an
   **offer** the person accepts (Secrets › **Accept**), or at once if that device is in Auto mode.
   **By sound** (beta, no network) the receiving computer must first press **Receive by sound**.
4. If a secret with the same name already exists from that device, the new one waits as
   **Replacement waiting** until the person presses **Approve**.
5. An offered secret (`offered: true` in `vinac_secrets`) can't be used until the person accepts it;
   tell them, don't try to work around it.

Never ask the person to paste a secret into the chat, and never read secret values by other
means (key store, files in `~/.vinac`, the page or its endpoints). If the person pastes one
anyway, don't repeat it and suggest they rotate it.
