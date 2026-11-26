// VINAC Web (0.16): a browser as one of your devices. The computer's side.
//
// Pairing, like the phone vault but over the account's relay instead of sound:
//  - the page makes a one-time X25519 key and secret and shows them as a link (QR code):
//    https://vinac.tech/web/#pair=<b64u JSON {v, d: this device id, n: name, k: cpub, s: secret, a: account}>
//  - the browser (signed in to the SAME account) makes its own X25519 key (private part not
//    extractable), and sends HELLO {ppub, name, tag} through the relay; the tag is an HMAC with a key
//    only someone who saw the link can derive, so a stranger on the account channel can't pair
//  - both screens show the same 6 digits (from the shared secret); the person presses Allow on the
//    computer's page. Only the page can start, allow, cancel or remove a browser.
// After that, every request from the browser is sealed with AES-256-GCM (a key from the pairing), with
// a counter and a timestamp (no replays), and only a short list of actions is allowed (see daemon.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { protect, unprotect, forget, detectKeystore } from './keystore.js';
import { codeFromMac, cleanName } from '../web/phone-frame.js';

export const WEB_PAIR_MS = 10 * 60_000;
export const MAX_WEB = 10;
export const WEB_INFO = 'VINAC web v1';
const httpError = (status, message) => Object.assign(new Error(message), { status });
const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s ?? ''), 'base64url');
const hmac = (key, ...parts) => { const h = crypto.createHmac('sha256', key); for (const p of parts) h.update(typeof p === 'string' ? Buffer.from(p) : p); return h.digest(); };
const rawX25519 = publicKey => Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
const x25519Public = raw => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(raw) }, format: 'jwk' });

/** Keys from the X25519 secret: kmac (pairing tag and code), kenc (sealing requests and answers). */
export function webKeys(shared, secret, cpub, ppub) {
  const info = Buffer.concat([Buffer.from(WEB_INFO), Buffer.from(cpub), Buffer.from(ppub)]);
  const okm = Buffer.from(crypto.hkdfSync('sha256', shared, secret, info, 64));
  return { kmac: okm.subarray(0, 32), kenc: okm.subarray(32, 64) };
}
export const webId = ppub => crypto.createHash('sha256').update(Buffer.from(ppub)).digest().subarray(0, 8).toString('hex');
export const helloTag = (kmac, ppub, name) => hmac(kmac, 'hello', Buffer.from(ppub), Buffer.from(String(name))).subarray(0, 16);
export const reqAad = (from, to) => Buffer.from(`vinac web req|${from}|${to}`);
export const resAad = (from, to, q) => Buffer.from(`vinac web res|${from}|${to}|${q}`);

export function seal(key, plain, aad) {
  const n = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, n);
  c.setAAD(aad);
  return { n: b64u(n), c: b64u(Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])) };
}
export function open(key, box, aad) {
  const n = unb64u(box?.n), raw = unb64u(box?.c);
  if (n.length !== 12 || raw.length < 17) throw httpError(400, 'BAD_FIELD');
  const d = crypto.createDecipheriv('aes-256-gcm', key, n);
  d.setAAD(aad); d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
}

export class WebDevices {
  constructor(store) { this.store = store; this.pairing = null; this.file = store.file('webdevices.json'); }

  list() { try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(d.devices) ? d.devices : []; } catch { return []; } }
  save(list) { this.store.writeJson('webdevices.json', { v: 1, devices: list }); }
  view() { return this.list().map(({ id, name, pairedAt, lastUsedAt }) => ({ id, name, pairedAt, lastUsedAt: lastUsedAt || null })); }
  get(id) { return this.list().find(x => x.id === String(id)) || null; }

  pairingView() {
    const p = this.pairing;
    if (!p || p.expires < Date.now()) return null;
    return { state: p.candidate ? 'confirm' : 'waiting', link: p.link, browserName: p.candidate?.name || null, code: p.candidate?.code || null, expiresIn: Math.round((p.expires - Date.now()) / 1000) };
  }

  /** "Add a browser" on the page: a one-time key pair and secret, as a link (QR code). */
  start({ deviceId, name, account, base = 'https://vinac.tech/web/' }) {
    if (this.list().length >= MAX_WEB) throw httpError(409, `At most ${MAX_WEB} browsers. Remove one first.`);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const cpub = rawX25519(publicKey), secret = crypto.randomBytes(16);
    const payload = b64u(Buffer.from(JSON.stringify({ v: 1, d: deviceId, n: String(name).slice(0, 60), k: b64u(cpub), s: b64u(secret), a: account })));
    this.pairing = { privateKey, cpub, secret, link: `${base}#pair=${payload}`, expires: Date.now() + WEB_PAIR_MS, candidate: null, outcome: new Map() };
    return this.pairingView();
  }

  cancel() { if (this.pairing?.candidate) this.pairing.outcome?.set(this.pairing.candidate.id, 'refused'); this.pairing = null; }

  /** HELLO from the browser (through the relay): check the tag, keep it for the person to compare. */
  hello({ from, ppub, name, tag }) {
    const p = this.pairing;
    if (!p || p.expires < Date.now()) throw httpError(409, 'NO_PAIRING');
    // One browser per link: while one waits to be compared, another holder of the link is refused.
    if (p.candidate && p.candidate.id !== from) throw httpError(409, 'LINK_IN_USE');
    const pub = unb64u(ppub);
    if (pub.length !== 32 || webId(pub) !== from) throw httpError(400, 'BAD_FIELD');
    const shared = crypto.diffieHellman({ privateKey: p.privateKey, publicKey: x25519Public(pub) });
    const { kmac, kenc } = webKeys(shared, p.secret, p.cpub, pub);
    const n = cleanName(String(name ?? ''), 40) || 'Browser';
    if (!crypto.timingSafeEqual(helloTag(kmac, pub, n), (() => { const t = unb64u(tag); return t.length === 16 ? t : Buffer.alloc(16); })())) throw httpError(403, 'NOT_THIS_LINK');
    p.candidate = { id: from, ppub: pub, name: n, kenc: Buffer.from(kenc), code: codeFromMac(hmac(kmac, 'code')) };
    return { ok: true };
  }

  /** The browser asks whether the person allowed it yet. */
  check(from) {
    if (this.get(from)) return { state: 'paired' };
    const p = this.pairing;
    if (p?.candidate?.id === from && p.expires > Date.now()) return { state: 'waiting' };
    if (p?.outcome?.get(from) === 'refused' || this.refused?.has(from)) return { state: 'refused' };
    return { state: 'none' };
  }

  /** The person compared the 6 digits and pressed Allow (or Cancel). */
  confirm(allow) {
    const p = this.pairing;
    if (!p?.candidate || p.expires < Date.now()) throw httpError(409, 'No browser is waiting to be added.');
    this.pairing = null;
    const c = p.candidate;
    if (!allow) { (this.refused ??= new Set()).add(c.id); c.kenc.fill(0); return null; }
    const keyLabel = `agentlink.web.${c.id}`;
    const w = protect(detectKeystore(), keyLabel, c.kenc);
    c.kenc.fill(0);
    const dev = { id: c.id, name: c.name, ppub: b64u(c.ppub), keystore: w.kind, keyLabel, wrappedKey: w.stored, counter: 0, pairedAt: new Date().toISOString(), lastUsedAt: null };
    this.save([...this.list().filter(x => x.id !== c.id), dev]);
    return { id: dev.id, name: dev.name };
  }

  remove(id) {
    const list = this.list();
    const d = list.find(x => x.id === String(id));
    if (!d) throw httpError(404, 'No such browser.');
    try { forget(d.keystore, d.keyLabel); } catch { /* already gone */ }
    this.save(list.filter(x => x !== d));
    return { id: d.id, name: d.name };
  }

  /** A sealed request: { device, req: {t, q, op, args}, reply(obj) -> sealed answer }. */
  openCall({ from, n, c }, meId) {
    const list = this.list();
    const d = list.find(x => x.id === String(from));
    if (!d) throw httpError(403, 'NOT_PAIRED');
    const key = unprotect(d.keystore, d.keyLabel, d.wrappedKey);
    let req;
    try { req = JSON.parse(open(key, { n, c }, reqAad(d.id, meId)).toString('utf8')); }
    catch { key.fill(0); throw httpError(403, 'BAD_SEAL'); }
    if (!req || !Number.isInteger(req.q) || req.q <= (d.counter || 0) || !Number.isFinite(req.t) || Math.abs(Date.now() - req.t) > 5 * 60_000 || typeof req.op !== 'string') { key.fill(0); throw httpError(409, 'REPLAY_OR_STALE'); }
    d.counter = req.q; d.lastUsedAt = new Date().toISOString();
    this.save(list);
    const reply = obj => { const out = seal(key, Buffer.from(JSON.stringify(obj)), resAad(meId, d.id, req.q)); key.fill(0); return out; };
    return { device: { id: d.id, name: d.name }, req, reply };
  }
}
