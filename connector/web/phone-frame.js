// Phone vault (0.11): formats shared by the computer's page and service and the phone web app
// (vinac.tech/app). Only bytes here; each side does its own cryptography (Node crypto on the
// computer, WebCrypto on the phone).
//
// Pairing a phone, no network needed:
//   1. The computer makes a one-time X25519 key pair and a 16-byte secret and shows a QR code of
//      https://vinac.tech/app/#p=<base64url(PAIR LINK)>. The part after # never leaves the phone.
//        PAIR LINK: 0x01 | computer public key (32) | secret (16) | computer name (UTF-8, <= 24 bytes)
//   2. The phone makes its own X25519 key pair; both sides derive
//        okm = HKDF-SHA256(ikm = X25519(...), salt = secret, info = "VINAC phone v1" | cpub | ppub, 64)
//        kmac = okm[0..32], kenc = okm[32..64]
//      and the 6 digits: HMAC-SHA256(kmac, "code") -> first 4 bytes as a number, mod 1 000 000.
//   3. The phone plays HELLO by sound; the computer checks its tag, shows the phone's name and the
//      6 digits, and the person presses Allow there.
//        HELLO:  0xC6 | phone public key (32) | name length (1) | name (2..20 bytes) | tag (16) | CRC-16
//        tag = HMAC-SHA256(kmac, 0xC6 | ppub | len | name)[0..16]
//
// Sending a key from the phone (the computer listens: Secrets > Receive by sound):
//        SECRET: 0xC7 | phone id (8) | counter (4, big-endian) | nonce (12) | AES-256-GCM(kenc) | CRC-16
//        phone id = SHA-256(ppub)[0..8]; additional data = the 25-byte header; inside:
//        name (1..40, [A-Za-z0-9_.-]) | 0x00 | value (UTF-8, 1..200 bytes)
//      The counter only grows, so a recording played again is refused.
import { crc16 } from './beacon.js';

export const PHONE_HELLO = 0xc6;
export const PHONE_SECRET = 0xc7;
export const PAIR_LINK_VERSION = 1;
export const PHONE_INFO = 'VINAC phone v1';
export const PHONE_NAME_MIN = 2, PHONE_NAME_MAX = 20;
export const HELLO_MIN = 1 + 32 + 1 + PHONE_NAME_MIN + 16 + 2;
export const HELLO_MAX = 1 + 32 + 1 + PHONE_NAME_MAX + 16 + 2;
export const SECRET_HEAD = 1 + 8 + 4 + 12;
export const PHONE_SECRET_MIN = SECRET_HEAD + 1 + 1 + 1 + 16 + 2;
export const PHONE_SECRET_MAX = SECRET_HEAD + 40 + 1 + 200 + 16 + 2;
export const APP_URL = 'https://vinac.tech/app/';

const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true });
const b64u = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = text => Uint8Array.from(atob(String(text).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export { b64u, unb64u };

/** Cleans a display name and cuts it to `max` UTF-8 bytes (never in the middle of a character). */
export function cleanName(name, max) {
  let s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  while (te.encode(s).length > max) s = s.slice(0, -1);
  return s;
}

export function encodePairLink({ cpub, secret, name }) {
  const n = te.encode(cleanName(name, 24));
  const out = new Uint8Array(1 + 32 + 16 + n.length);
  out[0] = PAIR_LINK_VERSION; out.set(cpub, 1); out.set(secret, 33); out.set(n, 49);
  return `${APP_URL}#p=${b64u(out)}`;
}

export function decodePairLink(fragmentOrUrl) {
  const m = String(fragmentOrUrl).match(/[#&]p=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  let b;
  try { b = unb64u(m[1]); } catch { return null; }
  if (b.length < 49 || b.length > 49 + 24 || b[0] !== PAIR_LINK_VERSION) return null;
  let name;
  try { name = td.decode(b.subarray(49)); } catch { return null; }
  return { cpub: b.slice(1, 33), secret: b.slice(33, 49), name: name || 'your computer' };
}

/** HKDF info for one pairing: "VINAC phone v1" | cpub | ppub. */
export function pairInfo(cpub, ppub) {
  const l = te.encode(PHONE_INFO);
  const out = new Uint8Array(l.length + 64);
  out.set(l); out.set(cpub, l.length); out.set(ppub, l.length + 32);
  return out;
}

export function codeFromMac(mac) {
  const n = ((mac[0] << 24) >>> 0) + (mac[1] << 16) + (mac[2] << 8) + mac[3];
  const s = String(n % 1_000_000).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

export function withCrc(bytes) {
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes);
  const c = crc16(bytes);
  out[bytes.length] = c >> 8; out[bytes.length + 1] = c & 255;
  return out;
}

const crcOk = b => crc16(b.subarray(0, b.length - 2)) === ((b[b.length - 2] << 8) | b[b.length - 1]);

/** HELLO without its tag and CRC (the part the tag covers). */
export function helloBody(ppub, name) {
  const n = te.encode(cleanName(name, PHONE_NAME_MAX).padEnd(PHONE_NAME_MIN, ' '));
  const out = new Uint8Array(1 + 32 + 1 + n.length);
  out[0] = PHONE_HELLO; out.set(ppub, 1); out[33] = n.length; out.set(n, 34);
  return out;
}

export function parseHello(bytes) {
  const b = Uint8Array.from(bytes);
  if (b.length < HELLO_MIN || b.length > HELLO_MAX || b[0] !== PHONE_HELLO || !crcOk(b)) return null;
  const len = b[33];
  if (len < PHONE_NAME_MIN || len > PHONE_NAME_MAX || b.length !== 34 + len + 16 + 2) return null;
  let name;
  try { name = td.decode(b.subarray(34, 34 + len)).trim(); } catch { return null; }
  return { ppub: b.slice(1, 33), name, body: b.slice(0, 34 + len), tag: b.slice(34 + len, 34 + len + 16) };
}

export function secretHeader(phoneId, counter, nonce) {
  const h = new Uint8Array(SECRET_HEAD);
  h[0] = PHONE_SECRET; h.set(phoneId, 1);
  new DataView(h.buffer).setUint32(9, counter >>> 0, false);
  h.set(nonce, 13);
  return h;
}

export function parseSecretFrame(bytes) {
  const b = Uint8Array.from(bytes);
  if (b.length < PHONE_SECRET_MIN || b.length > PHONE_SECRET_MAX || b[0] !== PHONE_SECRET || !crcOk(b)) return null;
  return { header: b.slice(0, SECRET_HEAD), phoneId: b.slice(1, 9), counter: new DataView(b.buffer).getUint32(9, false), nonce: b.slice(13, 25), sealed: b.slice(SECRET_HEAD, b.length - 2) };
}

/** Inside a SECRET: name | 0 | value. */
export function secretPlain(name, value) {
  const n = te.encode(name), v = te.encode(value);
  const out = new Uint8Array(n.length + 1 + v.length);
  out.set(n); out.set(v, n.length + 1);
  return out;
}

export function phoneFrameLooksValid(bytes) {
  return !!(bytes && (parseHello(bytes) || parseSecretFrame(bytes)));
}
