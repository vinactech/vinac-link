// Phone vault (0.11), the phone's cryptography: WebCrypto only (X25519, HKDF, HMAC, AES-GCM,
// PBKDF2), so it runs in a phone browser and, for tests, in Node. Formats: phone-frame.js.
import {
  decodePairLink, pairInfo, codeFromMac, helloBody, withCrc, secretHeader, secretPlain, b64u, unb64u,
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
    computer: { name: pair.name, phoneId: b64u(phoneId), key: b64u(kenc), counter: 0, pairedAt: new Date().toISOString() },
  };
}

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
