# Sound: how it works, best speakers, troubleshooting

VINAC Link can use sound when two devices can't reach each other over a network: to start a
pairing, to move a key from one computer to another, and to hand a key from the
[phone vault](secrets.md#your-keys-on-your-phone-phone-vault-beta) to a computer. Sound is a **beta**: it works today, and
we are still testing it on more phones, speakers and microphones. When the devices share a network,
Wi-Fi is faster and needs no setup.

## How it works

- **High tones, near the top of hearing.** The data travels as four tones between 17.1 and
  19.5 kHz. Most adults hear a faint chirp, or nothing at all; pets and children may hear more.
- **Slow and sturdy on purpose.** 100 bits per second, with error correction, so a few missed
  tones don't matter. A pairing sound lasts about 6 seconds; a key takes between about 10 and 35
  seconds depending on its length, and repeats up to 5 times until the other device has it.
- **One way at a time.** One device plays, the other listens with its microphone. The page shows a
  meter while it listens, so you can see that it hears something.
- **Nothing to steal from a recording.**
  - A pairing sound carries only a one-time public key and a short check. Pairing still needs a
    person to compare the same 6 digits on both screens and press Allow on both.
  - A key sent by sound is sealed (encrypted) for the one paired device you chose. Someone who
    records the sound gets bytes they can't open. A replayed recording is refused.
  - A key from the phone vault is encrypted with a key only that phone and this computer share,
    with a counter that only goes up, so replays are refused too.
- **Only while you ask for it.** A computer listens only while the person has pressed
  **Receive** (or is pairing). A sound played at any other time does nothing.

## Which speakers and microphones work best

These are general guidelines for the current release, not results for specific models.

| Works well | Often fails |
|---|---|
| Built-in laptop speakers and microphones | Bluetooth speakers, headsets and earbuds: most cut everything above about 16 kHz, and add delay |
| Phone speakers (for the phone vault), held 10 to 50 cm from the computer | Conference-call speakerphones and "voice" headsets, which keep only speech frequencies |
| Wired or USB desk speakers | Microphones with noise suppression or "audio enhancements" turned on |
| A quiet room, devices 0.5 to 2 metres apart, the speaker facing the other device | A fan, air conditioner or music right next to the microphone |

Tips:
- **Volume** around 70 to 100% on the playing device. Louder isn't always better: if a small
  speaker rattles, turn it down a little.
- **Choose the speaker** on the page (*Speaker* in the pairing and secret dialogs) if the computer
  has more than one output, for example a monitor's speakers.
- **Turn off microphone effects** on the listening computer:
  - Windows: *Settings › System › Sound › (your microphone) › Audio enhancements: Off*, and turn off
    any "noise suppression" or "voice focus" in the microphone's own app.
  - macOS: *Control Center › Mic Mode: Standard* (not Voice Isolation) while a call app is open.
  - Call apps (Teams, Zoom, Meet) can keep their filters on the microphone while they run: close
    them while you pair or receive.

## Troubleshooting

**The listening device hears nothing (the meter stays flat)**
- Is the right microphone selected, unmuted (hardware mute buttons count), and allowed for the page?
  The browser asks the first time; if you said no, allow it in the site settings (the lock icon in
  the address bar) and try again.
- Bring the devices closer, point the speaker at the microphone, turn the volume up.
- Is the playing device using a Bluetooth speaker or headset? Switch it to its built-in speaker.

**"Heard it, but the sound was damaged"**
Usually an echo or a noise in the room. Play it again a little closer, away from walls and fans.

**It worked once, then stopped**
Another app may have taken the microphone, or a call app turned its filters on. Close other apps
that use the microphone and press **Receive…** › **By sound** again.

**The phone plays, the computer doesn't react**
The computer must be listening first: on the computer, open **Secrets**, press **Receive…** and choose
**From your phone**, then press **Send** on the phone. Keep the phone's volume up and the phone near
the computer's microphone.

**Nothing works in this room**
Use another way: on the same network, Wi-Fi needs no sound at all; across networks, use an
[invite](pairing.md); for a key, type or paste it on the other computer. Sound is never required.

## Coming later

We are working on dedicated hardware for links like this. More when it is ready.
