# Pairing

Pairing makes two computers trust each other. It's the only step that creates trust, so **only a
person can complete it**: by pressing Allow on both screens, or by making an invite.

## Ways to pair

| Situation | Do this |
|---|---|
| Two computers on the same network (recommended) | Open **Pair a device** on both. Each lists the other under *On this network*. Press **Pair** on one, check that both screens show the same 6 digits, press **Same code: Allow** on both. Nothing to type. |
| Another network (Tailscale), or let the agent there finish the setup | On A: **Invite a device** (choose the mode it starts in, tick *Over Tailscale* if needed) › **Make an invite**. On B, run `vinac join <code>`, or give that line to B's agent, or paste the code under **More ways › Enter a code**. One use, 10 minutes. |
| The devices don't see each other | **More ways › Show a code here** on A, **Enter a code** on B; then compare and Allow. |
| Same room, no network to find each other on (beta) | **More ways › Play the sound** on A, **Listen for it** on B (microphone). Then compare and Allow. |

While *Pair a device* is open, the device sends a small packet on the local network every 1.5 s
(UDP multicast 239.255.47.80 and broadcast, port 47809): its name and the same 25 bytes the sound
and the typed code carry (address and port, an 8-byte one-time secret, its key fingerprint). It
stops when you leave the screen. Anyone on the network can read it, and that's fine: it doesn't let
anyone pair without both people's Allow. On a Mac, macOS asks once to allow VINAC Link on the local
network; say Allow (or later: System Settings › Privacy & Security › Local Network).

## Compare and Allow

After the devices exchange keys (Noise XX), both screens show **the same 6 digits**. They come from
the handshake, and the device that connects commits to its random number before it sees the other
one's, so a device in the middle can't make the two screens agree (1 in a million). If the digits
match, press **Same code: Allow** on both. If they differ, press **Different: cancel**: something
else answered. Allow on one screen alone does nothing.

An older VINAC Link (before 0.10) still asks to have the other screen's code typed. Open *The other
device asks you to type a code instead?* on the new device: it shows the code to type there and has
a box for the code the older one shows.

## Invites

An invite is a one-time code made on the page (never by an agent), valid for 10 minutes, and never
sent over the network. Whoever uses it first is paired without comparing codes, because the person
created the trust by making it: so give it only to the device (or agent) you mean. The new device
starts in the mode chosen for the invite (Restricted by default). `vinac join` refuses ordinary
pairing codes, and an invite can't be played as sound.

## What gets stored

Each side keeps the other's public key, name, address (and Tailscale address if any) and the
pairing key, wrapped by the OS key store (DPAPI, Keychain, Secret Service). Nothing goes to a server.

## Removing a device

Page → the conversation → device details (ⓘ) → **Remove this device**. The other device is told (authenticated) and
removes the pairing too. Agents can also call `vinac_unpair`; pairing again always needs a person.

## Tips

- Keep the devices within a couple of metres for sound; turn the volume up a little.
- If B hears nothing, check the microphone isn't muted (hardware mute buttons count) and that the
  page has microphone permission.
- Pairing with a device on an older protocol version fails with "update both"; existing pairings keep
  working across updates.
