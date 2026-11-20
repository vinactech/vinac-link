# Pairing

Pairing makes two computers trust each other. It's the only step that creates trust, so **only a
person can complete it**: each person types the other screen's 6-digit code.

## Ways to start

| Situation | Do this |
|---|---|
| Both computers in the same room | A: **Announce** (6-second near-ultrasound sound). B: **Listen** (microphone). |
| No speaker/microphone, or noisy room | A: **Announce**, open *No sound?* and read out the code. B: **Listen**, type the code. |
| Computers on different networks, both on Tailscale | A: *announce over Tailscale* (link under the two buttons). B: type the code shown on A. |

The sound and the code carry the same 25 bytes: A's address and port, an 8-byte one-time secret
and A's key fingerprint. It's useless to anyone who isn't on the network (or tailnet) during those
3 minutes, and it doesn't let anyone pair without the code swap.

## The code swap

After the devices exchange keys, each screen shows **its own** code. Type A's code into B and B's
code into A. A device never shows the code it expects, so neither an agent nor a recording of one
screen is enough. Three wrong codes cancel the pairing on both.

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
