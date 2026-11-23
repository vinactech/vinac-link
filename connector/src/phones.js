// Phone vault (0.11), the computer's side: pairing a phone (QR link out, HELLO back by sound,
// the person presses Allow) and opening the keys a paired phone sends by sound.
// Formats and key derivation: connector/web/phone-frame.js.
import crypto from 'node:crypto';
import { protect, unprotect, forget, detectKeystore } from './keystore.js';
import {
  encodePairLink, pairInfo, codeFromMac, parseHello, parseSecretFrame, cleanName, PHONE_NAME_MAX,
} from '../web/phone-frame.js';

export const PHONE_PAIR_MS = 10 * 60_000;
export const MAX_PHONES = 10;
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const hmac = (key, ...parts) => { const h = crypto.createHmac('sha256', key); for (const p of parts) h.update(typeof p === 'string' ? Buffer.from(p) : p); return h.digest(); };

function rawX25519(publicKey) { return Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'); }
function x25519Public(raw) { return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' }); }

export function deriveKeys(shared, secret, cpub, ppub) {
  const okm = Buffer.from(crypto.hkdfSync('sha256', shared, secret, pairInfo(cpub, ppub), 64));
  return { kmac: okm.subarray(0, 32), kenc: okm.subarray(32, 64) };
}

export class Phones {
  constructor(store) { this.store = store; this.pairing = null; }

  list() { return this.store.phones(); }
  view() { return this.list().map(({ id, name, pairedAt, lastUsedAt }) => ({ id, name, pairedAt, lastUsedAt: lastUsedAt || null })); }
  pairingView() {
    const p = this.pairing;
    if (!p || p.expires < Date.now()) return null;
    return { state: p.candidate ? 'confirm' : 'waiting', link: p.link, phoneName: p.candidate?.name || null, code: p.candidate?.code || null, expiresIn: Math.round((p.expires - Date.now()) / 1000) };
  }

  /** "Pair a phone": a one-time key pair and secret, as a link for the QR code. */
  start(computerName) {
    if (this.list().length >= MAX_PHONES) throw httpError(409, `At most ${MAX_PHONES} phones. Remove one first.`);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const cpub = rawX25519(publicKey), secret = crypto.randomBytes(16);
    this.pairing = { privateKey, cpub, secret, link: encodePairLink({ cpub, secret, name: computerName }), expires: Date.now() + PHONE_PAIR_MS, candidate: null };
    return this.pairingView();
  }

  cancel() { this.pairing = null; }

  /** The phone's HELLO, heard by the page: check its tag and show its name and the 6 digits. */
  hello(bytes) {
    const p = this.pairing;
    if (!p || p.expires < Date.now()) throw httpError(409, 'Press "Pair a phone" first, then play the sound on the phone.');
    const h = parseHello(bytes);
    if (!h) throw httpError(400, 'That did not sound like a complete phone pairing sound. Try again.');
    const shared = crypto.diffieHellman({ privateKey: p.privateKey, publicKey: x25519Public(h.ppub) });
    const { kmac, kenc } = deriveKeys(shared, p.secret, p.cpub, h.ppub);
    const want = hmac(kmac, h.body).subarray(0, 16);
    if (!crypto.timingSafeEqual(want, Buffer.from(h.tag))) throw httpError(403, 'That pairing sound was not for this code (scan the QR code shown here).');
    const name = cleanName(h.name, PHONE_NAME_MAX) || 'Phone';
    p.candidate = { ppub: Buffer.from(h.ppub), name, kenc: Buffer.from(kenc), code: codeFromMac(hmac(kmac, 'code')) };
    return this.pairingView();
  }

  /** The person compared the 6 digits and pressed Allow (or Cancel). */
  confirm(allow) {
    const p = this.pairing;
    if (!p?.candidate || p.expires < Date.now()) throw httpError(409, 'No phone is waiting to be paired.');
    this.pairing = null;
    if (!allow) return null;
    const c = p.candidate;
    const id = crypto.createHash('sha256').update(c.ppub).digest().subarray(0, 8).toString('hex');
    const list = this.list().filter(x => x.id !== id);
    const keyLabel = `agentlink.phone.${id}`;
    const w = protect(detectKeystore(), keyLabel, c.kenc); // fails closed
    c.kenc.fill(0);
    const phone = { id, name: c.name, ppub: c.ppub.toString('base64url'), keystore: w.kind, keyLabel, wrappedKey: w.stored, counter: 0, pairedAt: new Date().toISOString(), lastUsedAt: null };
    this.store.savePhones([...list, phone]);
    return { id, name: phone.name };
  }

  remove(id) {
    const list = this.list();
    const ph = list.find(x => x.id === String(id));
    if (!ph) throw httpError(404, 'No such phone.');
    try { forget(ph.keystore, ph.keyLabel); } catch { /* already gone */ }
    this.store.savePhones(list.filter(x => x !== ph));
    return { id: ph.id, name: ph.name };
  }

  /** A key the phone sent by sound: { phone, name, value (Buffer; zero it after use) }. */
  open(bytes) {
    const f = parseSecretFrame(bytes);
    if (!f) throw httpError(400, 'That did not sound like a complete phone secret. Try again.');
    const id = Buffer.from(f.phoneId).toString('hex');
    const list = this.list();
    const ph = list.find(x => x.id === id);
    if (!ph) throw httpError(403, 'That key came from a phone this computer is not paired with.');
    if (f.counter <= (ph.counter || 0)) throw httpError(409, 'That key was already received (a sound played again).');
    const kenc = unprotect(ph.keystore, ph.keyLabel, ph.wrappedKey);
    let plain;
    try {
      const sealed = Buffer.from(f.sealed);
      const d = crypto.createDecipheriv('aes-256-gcm', kenc, Buffer.from(f.nonce));
      d.setAAD(Buffer.from(f.header));
      d.setAuthTag(sealed.subarray(sealed.length - 16));
      plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
    } catch { throw httpError(403, 'The key did not unlock: it was changed, or sealed for another computer.'); }
    finally { kenc.fill(0); }
    const zero = plain.indexOf(0);
    const name = zero > 0 ? plain.subarray(0, zero).toString('utf8') : '';
    const value = zero > 0 ? plain.subarray(zero + 1) : Buffer.alloc(0);
    if (!NAME_PATTERN.test(name) || !value.length || value.length > 200) { plain.fill(0); throw httpError(400, 'Malformed key from the phone.'); }
    ph.counter = f.counter; ph.lastUsedAt = new Date().toISOString();
    this.store.savePhones(list);
    const out = Buffer.from(value);
    plain.fill(0);
    return { phone: { id: ph.id, name: ph.name }, name, value: out };
  }
}
