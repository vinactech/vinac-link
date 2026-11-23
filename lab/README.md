# VINAC-FM Near-Ultrasound Lab

A self-contained browser research application for measurable near-ultrasound experiments across laptops, phones and tablets.

**Status:** research/beta tester. It is not a security certification and does not claim guaranteed physical presence or relay resistance.

## What is implemented

- Four modes: Loopback, Sender, Receiver, Security Lab.
- Primary CP-4FSK modem with continuous phase and smooth packet fades.
- Legacy OOK baseline for comparison.
- AudioWorklet-based TX and RX path; link timing does not depend on `requestAnimationFrame()`.
- Versioned binary frame with protocol/version/profile/session/sequence/intent/nonce/expiry/payload/authenticator/CRC.
- CRC-16 link-integrity verification.
- HMAC-SHA-256 frame authentication (truncated to 128 bits for the research frame; documented in UI/report).
- Action binding to intents from the shared intent catalog (version 0.2.0).
- Replay cache, expiry checks and consumed-frame rejection.
- Live spectrum and simple waterfall display.
- Measured counters: attempted/decoded/verified frames, raw bitrate, payload goodput, PER, BER when a known payload is used, SNR proxy and frame duration.
- Audible masking / cover sound: Off, Pink Noise, Rain, Ambient, Local Audio File.
- Security Lab synthetic tests: silence, clap impulse, speech-band noise, wrong carrier, wrong symbols, CRC corruption, HMAC corruption, expiry, wrong intent/action binding and replay.
- JSON and CSV report export.
- No raw microphone upload or storage. Security replay capture is held only in memory.
- Current browser media-track settings are shown/exported so ignored AGC/noise-suppression requests are visible.

## Intent catalog

The lab embeds a fixed catalog of 30 intents (version 0.2.0): the names that say what a request is for. Arbitrary strings are not treated as known intents. In this tester an intent only identifies the action; it does not make authorization decisions.

## Run locally

Microphone access requires a secure context. `localhost` is accepted by modern browsers.

```bash
cd vinac-fm-nus-lab
npm test
npm run serve
```

Open:

`http://127.0.0.1:8080/`

For testing on phones, deploy the folder behind HTTPS. A plain LAN `http://192.168.x.x` URL will normally not be allowed to use the microphone.

## Hosting the lab

- **Static files only.** No build step, no external dependencies, no server code. Copy the whole
  folder to any path on a web server and keep the `js/` and `worklets/` paths as they are. If the
  site uses a framework or router, serve this folder as plain static files.
- **HTTPS.** Two-device tests need the microphone, which browsers allow only on secure pages
  (`https://`, or `localhost` while developing).
- **Content Security Policy.** No remote scripts are needed, so a strict policy works. It must allow
  same-origin JavaScript modules, AudioWorklet modules from the same origin, `blob:` URLs (for the
  report downloads) and microphone permission for the lab's page.
- **The test key stays in the browser.** The receiver link carries a temporary session key after the
  `#`, which browsers don't send to the server. Don't add analytics or scripts that read the fragment,
  and don't upload microphone audio.

## Two-device flow

1. Open the lab on Device A and choose **Sender**.
2. Click **New Session**.
3. Copy the generated Receiver Link to Device B. The temporary research session key is placed in the URL fragment so it is not part of the normal HTTP request URL.
4. On Device B choose **Receiver**, allow microphone access and click **Start Receiver**.
5. Set matching profile/modulation on both devices. Start with Robust / 100 bps or Balanced / 250 bps.
6. Send test frames. Use the measured results rather than the profile labels as performance claims.

## Important limitations

- Browser speakers and microphones vary substantially above ~15 kHz.
- iOS/Android audio processing can ignore requested `echoCancellation`, `noiseSuppression` and `autoGainControl` settings.
- This version uses a simple Goertzel CP-4FSK receiver without adaptive equalization. It is intended to find the practical device-pair envelope before adding QPSK/equalization.
- The app demonstrates replay resistance for stale/consumed authenticated frames. **Live relay resistance is not validated.**
- Browser audio is not a hardware root of trust. A fully compromised sender/receiver device can defeat browser-only assumptions.
- The SNR value is a modem-oriented proxy derived from selected-tone energy vs nearby/other-tone energy, not a calibrated SPL/SNR measurement.
- The Security Lab synthetic DSP tests are regression tests, not a substitute for over-the-air adversarial testing.

## Recommended experiment sequence

1. Same laptop, loopback at 100 bps.
2. Laptop -> phone at 100 bps, 0.5 m.
3. 100 -> 250 -> 500 -> 1000 bps while recording packet success and goodput.
4. Repeat at 1 m, 2 m, different orientations.
5. Repeat with masking Off / Pink / Rain / Ambient.
6. Introduce speech, claps, music and TV noise near the receiver.
7. Use Security Lab replay and tamper tests.
8. Export each run to JSON/CSV.

## File map

- `index.html` — UI shell.
- `styles.css` — responsive VINAC instrument styling.
- `js/app.js` — application controller/UI.
- `js/logos.js` — the intent catalog (v0.2.0) the lab accepts.
- `js/bytes.js` — binary helpers/base64url/CRC.
- `js/crypto.js` — session keys, canonical action hash, HMAC.
- `js/frame.js` — binary VINAC-NUS frame encoder/parser/verifier.
- `js/modem.js` — profile definitions, CP-4FSK/OOK mapping, Goertzel decoder, synthetic PCM helpers.
- `js/audio.js` — AudioWorklet TX/RX and microphone/output graph.
- `js/masking.js` — audible masking sources.
- `js/security-lab.js` — synthetic interference/protocol test campaign.
- `js/report.js` — JSON/CSV export.
- `worklets/vinac-tx-processor.js` — phase-continuous waveform generator.
- `worklets/vinac-rx-processor.js` — raw PCM capture blocks.
- `tests/*.test.mjs` — pure deterministic tests.

## Next engineering step after collecting data

If 4-FSK proves stable across target devices, add an adaptive channel estimator/equalizer and evaluate QPSK as a separate modem profile rather than replacing the robust FSK path.
