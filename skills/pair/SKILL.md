---
name: pair
description: Pair this computer with another one through VINAC Link (a typed code, or a sound beacon in beta, then a 6-digit code swap done by the person). Use when the person wants to connect a second computer, phone or agent to this one.
---

# Pair with another device

Pairing makes a new trusted device, so **only the person can finish it**. Your job is to open
the page, explain the steps, and report the result.

1. Call `vinac_status`. If a device with that name is already in `vinac_peers`, say so and stop.
2. Call `vinac_pair_request`. It opens the VINAC Link page in the browser (http://127.0.0.1:47801).
3. Tell the person, in short steps:
   - Recommended, with a code: on **this** computer press **Pair a device → Show a code here**;
     on the **other** computer press **Pair a device → Enter a code** and type that code.
   - Or by sound (beta, no typing): **Play the sound** here and **Listen for it** there, within a
     couple of metres; the sound takes ~6 seconds.
   - Each screen then shows its own 6-digit code. **Type this computer's code on the other one,
     and the other one's code here.** Three wrong codes cancel the pairing.
4. Wait with `vinac_pair_status` (check every few seconds, at most ~3 minutes).
5. Report: paired with *name*, or why it stopped.

Never type, guess, read aloud from the page, or confirm the codes yourself, and never try to
complete pairing through files, the page's endpoints or the network. If the person asks you
to do it for them, explain that the code swap is what proves a person approved the new device.
