// VINAC Link pairing beacon: the 25 bytes one device plays as sound so a nearby
// device can find it and start pairing. Works in the browser and in Node.
//
//   0      magic 0xB1 (beacon format 1), or 0xB2 for an invite (a code the person made to be redeemed
//          with `vinac join`; the inviting device confirms by itself, so it is never played or broadcast)
//   1-4    IPv4 address of the announcing device on the local network
//   5-6    its pairing port (big-endian)
//   7-14   pairing secret: random, used once, mixed into the pairing keys
//   15-22  identity fingerprint: first 8 bytes of SHA-256(Ed25519 public key)
//   23-24  CRC-16/CCITT of bytes 0-22
//
// The beacon is not secret from people in the room. Its job is to say "this
// device, this key, right here". Pairing then needs a person on each device
// to confirm that both screens show the same 6 digits.

export const BEACON_MAGIC = 0xb1;
export const INVITE_MAGIC = 0xb2;
export const BEACON_BYTES = 25;
export const BEACON_TONES = Object.freeze([17100, 17700, 18300, 19500]);
export const BEACON_BPS = 100;
export const BEACON_FEC = 32;

export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function encodeBeacon({ ip, port, secret, fingerprint, invite = false }) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('BEACON_BAD_IP');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BEACON_BAD_PORT');
  if (secret?.length !== 8 || fingerprint?.length !== 8) throw new Error('BEACON_BAD_FIELDS');
  const b = new Uint8Array(BEACON_BYTES);
  b[0] = invite ? INVITE_MAGIC : BEACON_MAGIC;
  b.set(parts, 1);
  b[5] = port >> 8; b[6] = port & 255;
  b.set(secret, 7);
  b.set(fingerprint, 15);
  const c = crc16(b.subarray(0, 23));
  b[23] = c >> 8; b[24] = c & 255;
  return b;
}

export function decodeBeacon(bytes) {
  if (!bytes || bytes.length !== BEACON_BYTES) return { ok: false, reason: 'BEACON_LENGTH' };
  if (bytes[0] !== BEACON_MAGIC && bytes[0] !== INVITE_MAGIC) return { ok: false, reason: 'BEACON_MAGIC' };
  if (crc16(bytes.subarray(0, 23)) !== ((bytes[23] << 8) | bytes[24])) return { ok: false, reason: 'BEACON_CRC' };
  return {
    ok: true,
    ip: [...bytes.subarray(1, 5)].join('.'),
    port: (bytes[5] << 8) | bytes[6],
    secret: bytes.slice(7, 15),
    fingerprint: bytes.slice(15, 23),
    invite: bytes[0] === INVITE_MAGIC,
  };
}

// Typed fallback when sound does not work: the same 25 bytes as 40 letters
// and digits (Crockford base32), in groups of five.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function beaconToCode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,5}/g).join('-');
}

export function codeToBeacon(text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >> (bits - 8)) & 255); bits -= 8; }
  }
  return out.length === BEACON_BYTES ? Uint8Array.from(out) : null;
}

export const toHex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = hex => Uint8Array.from(String(hex).match(/../g) || [], h => parseInt(h, 16));
