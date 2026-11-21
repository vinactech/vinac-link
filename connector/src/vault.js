// The vault lock (optional): a passphrase the person chooses.
//
// Without it, secret values are protected by the OS key store only (DPAPI, the
// Keychain, the Secret Service), which any program running as the same user can
// ask to unwrap. With it, every value is also sealed to a vault key pair
// (X25519 + HKDF-SHA256 + AES-256-GCM), and the vault's private key is kept
// encrypted with a key derived from the passphrase (scrypt). So:
//   - new secrets (received or added) are sealed with the public key: no
//     passphrase needed, receiving works while the vault is locked;
//   - reading a value (reveal, copy, send on, an approved run) needs the private
//     key, which exists in memory only while the vault is unlocked, and is
//     forgotten after UNLOCK_MS or when the person locks it.
// The passphrase never leaves this device and is never stored. Forgetting it
// loses the values (the secrets can be sent again from another device).
import crypto from 'node:crypto';

export const VAULT_LABEL = 'VINAC vault v1';
export const UNLOCK_MS = 15 * 60_000;
export const MIN_PASSPHRASE = 8;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const b64 = b => Buffer.from(b).toString('base64url');
const unb64 = s => Buffer.from(String(s), 'base64url');
const err = (status, message) => Object.assign(new Error(message), { status });
const rawPublic = k => Buffer.from(k.export({ format: 'jwk' }).x, 'base64url');
const xPublic = raw => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64(raw) }, format: 'jwk' });

function passKey(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(String(passphrase).normalize('NFC'), 'utf8'), salt, 32, SCRYPT);
}
function gcm(key, nonce, aad, data, decrypt = false) {
  if (!decrypt) {
    const c = crypto.createCipheriv('aes-256-gcm', key, nonce); c.setAAD(Buffer.from(aad));
    return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  }
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce); d.setAAD(Buffer.from(aad));
  d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
}

/** Seals bytes to the vault's public key. Anyone with the public key can seal; only the unlocked vault can open. */
export function sealTo(publicRaw, label, bytes) {
  const eph = crypto.generateKeyPairSync('x25519');
  const ePub = rawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: xPublic(publicRaw) });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([ePub, Buffer.from(publicRaw)]), `${VAULT_LABEL} seal`, 32));
  const nonce = crypto.randomBytes(12);
  const ct = gcm(key, nonce, `${VAULT_LABEL}|${label}`, Buffer.from(bytes));
  return Buffer.concat([Buffer.of(1), ePub, nonce, ct]); // version, ephemeral key, nonce, ciphertext+tag
}

export function openWith(privateKey, publicRaw, label, sealed) {
  const s = Buffer.from(sealed);
  if (s[0] !== 1 || s.length < 1 + 32 + 12 + 16) throw err(500, 'This secret is damaged.');
  const ePub = s.subarray(1, 33), nonce = s.subarray(33, 45), ct = s.subarray(45);
  const shared = crypto.diffieHellman({ privateKey, publicKey: xPublic(ePub) });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([ePub, Buffer.from(publicRaw)]), `${VAULT_LABEL} seal`, 32));
  try { return gcm(key, nonce, `${VAULT_LABEL}|${label}`, ct, true); } catch { throw err(500, 'This secret could not be opened with the vault key.'); }
}

export class Vault {
  /** `load()` returns the stored record or null; `save(rec|null)` stores it. */
  constructor({ load, save }) { this.load = load; this.save = save; this.key = null; this.until = 0; this.timer = null; }

  get protected() { return !!this.load(); }
  get unlocked() { return !!this.key && Date.now() < this.until; }
  publicRaw() { const r = this.load(); return r ? unb64(r.pub) : null; }

  view() {
    const on = this.protected;
    return { protected: on, locked: on && !this.unlocked, unlockedUntil: on && this.unlocked ? new Date(this.until).toISOString() : null };
  }

  /** Turns the lock on. Returns the new public key; the caller re-seals existing secrets with it. */
  create(passphrase) {
    if (this.protected) throw err(409, 'The vault already has a passphrase.');
    checkPassphrase(passphrase);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
    const der = privateKey.export({ format: 'der', type: 'pkcs8' });
    const enc = gcm(passKey(passphrase, salt), nonce, `${VAULT_LABEL}|private`, der);
    der.fill(0);
    const pub = rawPublic(publicKey);
    this.save({ v: 1, pub: b64(pub), salt: b64(salt), nonce: b64(nonce), enc: b64(enc), kdf: { name: 'scrypt', ...SCRYPT, maxmem: undefined }, createdAt: new Date().toISOString() });
    this.hold(privateKey);
    return pub;
  }

  unlock(passphrase) {
    const r = this.load();
    if (!r) throw err(409, 'The vault has no passphrase.');
    let der;
    try { der = gcm(passKey(passphrase, unb64(r.salt)), unb64(r.nonce), `${VAULT_LABEL}|private`, unb64(r.enc), true); }
    catch { throw err(403, 'Wrong passphrase.'); }
    const key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    der.fill(0);
    this.hold(key);
  }

  hold(key) {
    this.key = key; this.until = Date.now() + UNLOCK_MS;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.lock(), UNLOCK_MS); this.timer.unref?.();
  }
  lock() { this.key = null; this.until = 0; clearTimeout(this.timer); this.timer = null; }

  /** Turns the lock off again (needs the passphrase); the caller re-wraps the secrets without it first. */
  remove() { this.lock(); this.save(null); }

  privateKey() {
    if (!this.unlocked) { this.lock(); throw err(423, 'VAULT_LOCKED: unlock the vault on this device first.'); }
    return this.key;
  }
}

export function checkPassphrase(p) {
  if (typeof p !== 'string' || [...p].length < MIN_PASSPHRASE) throw err(400, `Choose a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  if (p.length > 200) throw err(400, 'That passphrase is too long.');
}
