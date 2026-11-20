// Sound frame for sending a secret (an API key, a token) to one paired device.
// Shared by the page and the daemon. Only the daemon seals and opens it; the
// page just plays and hears the bytes.
//
//   0       magic 0xC5 (secret frame format 1)
//   1-4     sender fingerprint, first 4 bytes (lets the receiver find the pairing)
//   5-8     recipient fingerprint, first 4 bytes
//   9-20    AES-GCM nonce
//   21..    ciphertext + 16-byte tag, sealed with a key derived from the pairing
//           key (only the two paired devices hold it). Inside: name, id, time, value.
//   last 2  CRC-16/CCITT of everything before (catches garbled audio early)
//
// Anyone in the room can record the sound; without the pairing key it is noise.
import { crc16 } from './beacon.js';

export const SECRET_MAGIC = 0xc5;
export const SECRET_HEADER = 21;
export const SECRET_MIN_BYTES = SECRET_HEADER + 16 + 1 + 1 + 8 + 4 + 1 + 2; // shortest name and value
export const SECRET_MAX_NAME = 40;
export const SECRET_MAX_VALUE = 200; // bytes of UTF-8
export const SECRET_MAX_BYTES = SECRET_HEADER + 16 + 1 + SECRET_MAX_NAME + 8 + 4 + SECRET_MAX_VALUE + 2;
export const SECRET_FEC = 64; // "strong": the setting that went 5/5 PC -> Mac over the air
export const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

/** Quick check the page uses while listening: right magic, size and CRC. */
export function secretFrameLooksValid(bytes) {
  if (!bytes || bytes.length < SECRET_MIN_BYTES || bytes.length > SECRET_MAX_BYTES || bytes[0] !== SECRET_MAGIC) return false;
  const n = bytes.length;
  return crc16(bytes.subarray(0, n - 2)) === ((bytes[n - 2] << 8) | bytes[n - 1]);
}

export function withCrc(bytes) {
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes);
  const c = crc16(bytes);
  out[bytes.length] = c >> 8; out[bytes.length + 1] = c & 255;
  return out;
}
