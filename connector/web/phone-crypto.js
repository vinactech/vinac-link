// Phone vault (0.11), the phone's cryptography: WebCrypto only (X25519, HKDF, HMAC, AES-GCM,
// PBKDF2), so it runs in a phone browser and, for tests, in Node. Formats: phone-frame.js.
import {
  decodePairLink, pairInfo, codeFromMac, helloBody, withCrc, secretHeader, secretPlain, b64u, unb64u,
  encodePairLink, parseHello, parseKeyFrame, downHeader, cleanName, PHONE_DOWN, PHONE_SECRET, DOWN_INFO, PHONE_NAME_MAX,
} from './phone-frame.js';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const rnd = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function hmac(keyBytes, data) {
  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}

/**
 * Pairs with the computer in `link` (the QR code's URL or its #p=... part).
 * Returns the 6 digits to compare, the HELLO frame to play, and the record to keep in the vault.
 */
export async function pairWithComputer(link, phoneName) {
  const pair = decodePairLink(link);
  if (!pair) throw new Error('This link is not a VINAC Link phone pairing code.');
  const kp = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const ppub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const cpubKey = await subtle.importKey('raw', pair.cpub, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: cpubKey }, kp.privateKey, 256));
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const okm = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: pair.secret, info: pairInfo(pair.cpub, ppub) }, ikm, 512));
  shared.fill(0);
  const kmac = okm.slice(0, 32), kenc = okm.slice(32, 64);
  okm.fill(0);
  const body = helloBody(ppub, phoneName);
  const tag = (await hmac(kmac, body)).slice(0, 16);
  const code = codeFromMac(await hmac(kmac, te.encode('code')));
  kmac.fill(0);
  const phoneId = new Uint8Array(await subtle.digest('SHA-256', ppub)).slice(0, 8);
  return {
    code, hello: withCrc(cat(body, tag)),
    computer: { name: pair.name, phoneId: b64u(phoneId), key: b64u(kenc), counter: 0, seen: 0, kind: pair.host || 'computer', role: 'guest', pairedAt: new Date().toISOString() },
  };
}

// ---- phone vault 2.0: a phone as the host, and keys in both directions ------------------------

const NAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;
export const HOST_PAIR_MS = 10 * 60_000;

/** "Pair another phone": a one-time key pair and secret. `pending` is kept (sealed) in the vault. */
export async function hostStart(phoneName) {
  const kp = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const cpub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const priv = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
  const secret = rnd(16);
  const link = encodePairLink({ cpub, secret, name: phoneName, host: 'phone' });
  return { link, pending: { link, priv: b64u(priv), cpub: b64u(cpub), secret: b64u(secret), expires: Date.now() + HOST_PAIR_MS } };
}

/** The guest phone's HELLO: check its tag; returns the 6 digits and the record to keep after Allow. */
export async function hostHello(pending, helloBytes) {
  if (!pending || pending.expires < Date.now()) throw new Error('Start "Pair another phone" again: the code expired.');
  const h = parseHello(helloBytes);
  if (!h) throw new Error('That was not a phone pairing code.');
  const cpub = unb64u(pending.cpub);
  const priv = await subtle.importKey('pkcs8', unb64u(pending.priv), { name: 'X25519' }, false, ['deriveBits']);
  const ppubKey = await subtle.importKey('raw', h.ppub, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: ppubKey }, priv, 256));
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const okm = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: unb64u(pending.secret), info: pairInfo(cpub, h.ppub) }, ikm, 512));
  shared.fill(0);
  const kmac = await subtle.importKey('raw', okm.slice(0, 32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const kenc = okm.slice(32, 64);
  okm.fill(0);
  const full = new Uint8Array(await subtle.sign('HMAC', kmac, h.body));
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= full[i] ^ h.tag[i];
  if (diff) throw new Error('That pairing code was not made for this phone\'s code.');
  const code = codeFromMac(new Uint8Array(await subtle.sign('HMAC', kmac, te.encode('code'))));
  const phoneId = new Uint8Array(await subtle.digest('SHA-256', h.ppub)).slice(0, 8);
  const name = cleanName(h.name, PHONE_NAME_MAX) || 'Phone';
  return { code, name, record: { name, phoneId: b64u(phoneId), key: b64u(kenc), counter: 0, seen: 0, kind: 'phone', role: 'host', pairedAt: new Date().toISOString() } };
}

async function downKey(kenc) { return (await hmac(kenc, te.encode(DOWN_INFO))); }

/**
 * A key sealed for one paired device, in the direction this phone has with it: as the guest a
 * SECRET (0xC7), as the host a KEY DOWN (0xC8). Save `record.counter = counter` after.
 */
export async function sealKey(record, name, value) {
  if (record.role !== 'host') return sealForComputer(record, name, value);
  if (!NAME_RE.test(name)) throw new Error('Names use letters, digits, _ . - (up to 40).');
  const v = te.encode(value);
  if (!v.length || v.length > 200) throw new Error('A value can be 1 to 200 bytes.');
  const counter = (record.counter || 0) + 1;
  const header = downHeader(unb64u(record.phoneId), counter, rnd(12));
  const key = await subtle.importKey('raw', await downKey(unb64u(record.key)), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: header.slice(13, 25), additionalData: header }, key, secretPlain(name, value)));
  return { frame: withCrc(cat(header, sealed)), counter };
}

/**
 * A key frame for this phone, from one of its paired devices: { record, name, value, counter }.
 * Only the direction toward this phone opens, and only a counter higher than the last one seen
 * (save `record.seen = counter` once the person keeps it).
 */
export async function openKey(records, bytes) {
  const f = parseKeyFrame(bytes);
  if (!f) throw new Error('That is not a complete key.');
  const id = b64u(f.phoneId);
  const record = records.find(r => r.phoneId === id && (f.type === PHONE_DOWN ? r.role !== 'host' : r.role === 'host'));
  if (!record) throw new Error('That key was not sent to this phone by a device it is paired with.');
  if (f.counter <= (record.seen || 0)) throw new Error('That key was already received here (the same code or sound again).');
  const raw = f.type === PHONE_DOWN ? await downKey(unb64u(record.key)) : unb64u(record.key);
  const key = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  let plain;
  try { plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: f.nonce, additionalData: f.header }, key, f.sealed)); }
  catch { throw new Error('The key did not unlock: it was changed, or sealed for another device.'); }
  const zero = plain.indexOf(0);
  const name = zero > 0 ? new TextDecoder().decode(plain.subarray(0, zero)) : '';
  const value = zero > 0 ? new TextDecoder().decode(plain.subarray(zero + 1)) : '';
  plain.fill(0);
  if (!NAME_RE.test(name) || !value) throw new Error('That key is malformed.');
  return { record, name, value, counter: f.counter };
}
export { PHONE_SECRET, PHONE_DOWN };

/** A SECRET frame sealed for one paired computer; `computer.counter` must be increased and saved after. */
export async function sealForComputer(computer, name, value) {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) throw new Error('Names use letters, digits, _ . - (up to 40).');
  const v = te.encode(value);
  if (!v.length || v.length > 200) throw new Error('A value can be 1 to 200 bytes by sound.');
  const counter = (computer.counter || 0) + 1;
  const header = secretHeader(unb64u(computer.phoneId), counter, rnd(12));
  const key = await subtle.importKey('raw', unb64u(computer.key), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: header.slice(13, 25), additionalData: header }, key, secretPlain(name, value)));
  return { frame: withCrc(cat(header, sealed)), counter };
}

// ---- the vault on the phone: everything encrypted with a key from the passphrase -------

export const PBKDF2_ITERATIONS = 600_000;

export async function vaultKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealVault(key, data) {
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(data))));
  return { iv: b64u(iv), ct: b64u(ct) };
}

export async function openVault(key, box) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(box.iv) }, key, unb64u(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export const newSalt = () => b64u(rnd(16));
export { unb64u };
