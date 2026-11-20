// Builds an authenticated frame and plays it. Expiry covers the frame's own
// airtime, so slow speeds are not rejected as expired on arrival.
import { randomBytes, utf8 } from './bytes.js';
import { createFrame, FIXED_FRAME_BYTES } from './frame.js';
import { codedLength } from './fec.js';
import { PROFILES } from './modem.js';

const FRESHNESS_MARGIN_S = 30;

/** Seconds a frame with this payload takes to play. */
export function airtimeSeconds(payloadText, { bps, fec }) {
  const frameLen = FIXED_FRAME_BYTES + utf8(payloadText).length;
  const symbols = (fec ? codedLength(frameLen, fec) : frameLen) * 4 + 32;
  return symbols / (bps / 2);
}

export async function sendMessage(engine, { session, sequence, speed, fec, tones, intent, text }) {
  const airtime = airtimeSeconds(text, { bps: speed.bps, fec });
  const frame = await createFrame({
    sessionId: session.id, sessionKey: session.key, sequence, profileId: PROFILES[speed.profile].id,
    intent, nonce: randomBytes(6), expiry: Math.floor(Date.now() / 1000) + Math.ceil(airtime) + FRESHNESS_MARGIN_S, payload: text,
  });
  const played = await engine.playFrame(frame.bytes, { modulation: 'fsk4', rawBps: speed.bps, tones, fec });
  return { bytes: frame.bytes.slice(), durationMs: played.durationMs };
}

/** Plays an already-sent frame again, unchanged: a receiver must refuse it. */
export async function replayMessage(engine, bytes, { speed, fec, tones }) {
  const played = await engine.playFrame(bytes, { modulation: 'fsk4', rawBps: speed.bps, tones, fec });
  return { durationMs: played.durationMs };
}
