# Architecture — VINAC-FM Near-Ultrasound Lab v0.1

## Layer separation

### Intent catalog v0.2.0
Identity of the action only. The app embeds a fixed catalog of 30 intents. Arbitrary `domain.entity.action` strings are not accepted merely because they match the syntax.

### VINAC-FM NUS
Browser physical-channel experiment. It creates/receives structured near-ultrasonic frames and returns measured acoustic/modem evidence.

### Security/session layer
A temporary browser research session binds a frame to a session, sequence, nonce, expiry, payload digest and intent from the catalog. HMAC-SHA-256 (128-bit transmitted tag) authenticates the compact research frame. CRC-16 is used only for link integrity.

### Policy engine
Not implemented here as a policy service. The lab's verified result is evidence that a future policy engine can consume.

## Frame v0.1

Logical layout:

```
MAGIC            1 B
VERSION          1 B
PROFILE          1 B
FLAGS            1 B
SESSION TAG      4 B
SEQUENCE         2 B
INTENT ID        1 B
NONCE            6 B
EXPIRY            4 B
PAYLOAD LENGTH   1 B
PAYLOAD          0..255 B
ACTION HASH TAG 12 B   (truncated SHA-256)
AUTH TAG         16 B   (truncated HMAC-SHA-256)
CRC-16            2 B
```

Fixed overhead: 52 bytes.

This is intentionally compact enough for acoustic experiments. Truncation is documented and should be revisited before any production protocol freeze.

## CP-4FSK PHY

- Four high-frequency tones.
- Two bits per symbol.
- AudioWorklet TX uses a continuous oscillator phase across frequency changes.
- Primary amplitude remains constant across FSK symbols; packet start/end are smoothly faded.
- Receiver captures raw PCM through AudioWorklet.
- Main-thread research decoder uses Goertzel tone-energy correlation.
- A marker + 24-symbol 0/1/2/3 training pattern establishes packet alignment.
- Current implementation is fixed-clock per frame: no adaptive equalizer or symbol-clock recovery yet.

The initial default tone set at 48 kHz is approximately:

```
17.4, 18.0, 18.6, 19.2 kHz
```

The calibration UI can select another four-tone set within Nyquist constraints.

## OOK legacy mode

Included only as a baseline for comparison with earlier VINAC browser work. It uses one carrier with smoothed amplitude transitions. CP-4FSK should be treated as the primary test path.

## Security decision sequence

```
physical signal
  -> training / preamble
  -> symbols
  -> complete frame
  -> CRC
  -> session tag
  -> expiry
  -> intent policy expectation
  -> action hash
  -> HMAC
  -> replay/consumption cache
  -> VERIFIED
```

This structure is why high-frequency energy from a clap, voice, song or fan is not sufficient to produce a valid authorization artifact.

## Threat-model boundaries

Tested in v0.1:
- accidental broadband acoustic interference;
- wrong carrier/symbol stream;
- CRC corruption;
- HMAC corruption;
- action hash tampering;
- expiry;
- different expected intent;
- reuse of a consumed authenticated frame.

Not proven:
- live low-latency relay resistance;
- compromised sender/receiver browser or OS;
- deliberate high-power jamming;
- hardware-rooted identity;
- calibrated distance bounding;
- formal false-accept/false-reject rates across real hardware.
