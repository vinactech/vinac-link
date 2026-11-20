// Session and pairing link. Everything the receiver must match travels in the
// link's #fragment (never sent to the web server): session id, temporary key,
// speed, error-correction strength and the four tones.
import { base64UrlToBytes, bytesToBase64Url, randomBytes } from './bytes.js';

export const SPEEDS = Object.freeze({
  fast: { key: 'fast', label: 'Fast', bps: 100, profile: 'robust' },
  steady: { key: 'steady', label: 'Steady', bps: 50, profile: 'compat' },
  slow: { key: 'slow', label: 'Slow', bps: 25, profile: 'slow' },
});
export const DEFAULT_TONES = Object.freeze([17400, 18000, 18600, 19200]);

export function newSession() {
  return { id: bytesToBase64Url(randomBytes(8)), key: randomBytes(32) };
}

export function speedByBps(bps) {
  return Object.values(SPEEDS).find(s => s.bps === Number(bps)) || null;
}

/** Builds the link a receiver opens. Settings are part of the pairing. */
export function pairingLink(base, { session, speed, fec, tones }) {
  const p = new URLSearchParams({
    s: session.id, k: bytesToBase64Url(session.key), r: String(speed.bps), e: String(fec), t: tones.join(','), role: 'receive',
  });
  return `${base}#${p.toString()}`;
}

/** Reads a pairing link fragment (new and older lab formats). Returns null if none. */
export function readPairing(hash) {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const id = h.get('s') || h.get('sid'), key = h.get('k') || h.get('key');
  if (!id || !key) return null;
  let keyBytes;
  try { keyBytes = base64UrlToBytes(key); } catch { return null; }
  if (keyBytes.length < 16) return null;
  const tones = (h.get('t') || h.get('tones') || '').split(',').map(Number).filter(f => f >= 12000 && f <= 23000);
  const role = h.get('role');
  return {
    session: { id, key: keyBytes },
    speed: speedByBps(h.get('r')),
    fec: h.has('e') ? Number(h.get('e')) : null,
    tones: tones.length === 4 ? tones : null,
    role: role === 'receive' || role === 'receiver' ? 'receive' : role === 'sender' ? 'send' : null,
  };
}
