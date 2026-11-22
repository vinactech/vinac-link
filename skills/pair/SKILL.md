---
name: pair
description: Pair this computer with another one through VINAC Link (pick it from the list of nearby devices and press Allow on both, or join with an invite the person made on the other device). Use when the person wants to connect a second computer, phone or agent to this one.
---

# Pair with another device

Pairing makes a new trusted device, so **a person creates that trust**: either by pressing Allow on
both screens, or by making an invite on the other device. Your job is to open the page, explain the
steps, run `vinac join` when the person gives you an invite, and report the result.

1. Call `vinac_status`. If a device with that name is already in `vinac_peers`, say so and stop.
2. Call `vinac_pair_request`. It opens the VINAC Link page in the browser (http://127.0.0.1:47801).
3. Tell the person, in short steps:
   - **Same network (recommended):** open **Pair a device** on both computers. Each lists the other
     under *On this network*. Press **Pair** next to the other computer on one of them. Both screens
     then show the same 6 digits: if they match, press **Same code: Allow** on both. No typing.
   - **Another network, or let the agent there finish it:** on the other computer, **Pair a device ›
     Invite a device › Make an invite**. The person gives you the `vinac join …` line (or the code);
     run it here: `vinac join <code>`. It works once, for 10 minutes.
   - If the devices don't see each other: **More ways › Show a code here** on one and **Enter a code**
     on the other, then compare and Allow. Sound (beta) is there too.
4. Wait with `vinac_pair_status` (check every few seconds, at most ~3 minutes), or for `vinac join` to
   print "Paired with …".
5. Report: paired with *name*, or why it stopped. On a Mac, if devices never show up or stay offline,
   ask the person to allow VINAC Link in System Settings › Privacy & Security › Local Network.

Only use an invite the person gave you for this. Never type, guess, compare or read out the codes
yourself, never press Allow, never make invites, and never complete pairing through files, the
page's endpoints or the network. If the person asks you to do it for them, explain that their Allow
(or their invite) is what proves a person approved the new device.
