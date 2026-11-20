// Cryptography for device identity and pairing (Node's built-in crypto only).
//   identity:   Ed25519 key pair per device, kept by the OS key store
//   pairing:    X25519 key exchange, both sides' nonces, the beacon secret and
//               both identities hashed into one transcript; each device signs it
//   check:      6 digits from the transcript, compared by a person on each side
import crypto from 'node:crypto';

const b = x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x));
// Each part is prefixed with its length: 2 bytes, or for parts of 65535 bytes and
// more (only shared files reach that) 0xFFFF followed by 4 bytes. Parts below
// 65535 bytes encode exactly as before, so older devices compute the same values.
const lenPrefixed = parts => Buffer.concat(parts.flatMap(p => {
  const v = b(p);
  if (v.length < 0xffff) { const l = Buffer.alloc(2); l.writeUInt16BE(v.length); return [l, v]; }
  const l = Buffer.alloc(6); l.writeUInt16BE(0xffff); l.writeUInt32BE(v.length, 2); return [l, v];
}));

export const sha256 = (...parts) => crypto.createHash('sha256').update(lenPrefixed(parts)).digest();
export const randomBytes = n => crypto.randomBytes(n);
export const b64u = buf => Buffer.from(buf).toString('base64url');
export const fromB64u = s => Buffer.from(String(s), 'base64url');

/** First 8 bytes of SHA-256 over the raw public key (same as the beacon field). */
export function fingerprint(publicRaw) {
  return crypto.createHash('sha256').update(Buffer.from(publicRaw)).digest().subarray(0, 8);
}
export const formatFingerprint = fp => Buffer.from(fp).toString('hex').toUpperCase().match(/.{4}/g).join('-');

function rawPublic(keyObject) { return Buffer.from(keyObject.export({ format: 'jwk' }).x, 'base64url'); }

export function newIdentity() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicRaw: rawPublic(publicKey) };
}
export const exportPrivate = key => key.export({ format: 'der', type: 'pkcs8' });
export const importPrivate = der => crypto.createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
export function publicFromPrivate(privateKey) { return rawPublic(crypto.createPublicKey(privateKey)); }

const edPublic = raw => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(raw) }, format: 'jwk' });
const xPublic = raw => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(raw) }, format: 'jwk' });

export const sign = (privateKey, data) => crypto.sign(null, Buffer.from(data), privateKey);
export function verify(publicRaw, data, signature) {
  try { return crypto.verify(null, Buffer.from(data), edPublic(publicRaw), Buffer.from(signature)); } catch { return false; }
}

export function newEphemeral() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  return { privateKey, publicRaw: rawPublic(publicKey) };
}
export function sharedSecret(ephemeralPrivate, peerPublicRaw) {
  return crypto.diffieHellman({ privateKey: ephemeralPrivate, publicKey: xPublic(peerPublicRaw) });
}

// ---- pairing transcript --------------------------------------------------

export const PAIR_LABEL = 'AgentLink pairing v2';
export const PROTOCOL_VERSION = 2;

/** Rendezvous id: lets the announcer match a network request to its beacon without the secret crossing the network. */
export const rendezvousId = secret => sha256(PAIR_LABEL, 'rendezvous', secret).subarray(0, 12);
export const commitment = nonce => sha256(PAIR_LABEL, 'commit', nonce);

/**
 * Everything both sides rely on is in the transcript both sign: keys, nonces,
 * the beacon secret, and the metadata each side will store (version, roles,
 * names, ports). Changing any of it on the way breaks the signatures.
 */
export function canonicalMeta({ aName, bName, aPort, bPort }) {
  return JSON.stringify({ v: PROTOCOL_VERSION, roles: ['announce', 'listen'], aName, bName, aPort, bPort });
}

export function transcript({ secret, idA, idB, eA, eB, nA, nB, meta }) {
  return sha256(PAIR_LABEL, secret, idA, idB, eA, eB, nA, nB, meta);
}

/**
 * Six digits shown by one side (`role`) and typed by the person into the
 * other side. Each device shows its own code and never reveals the code it
 * expects, so software on one device cannot confirm by reading its own screen.
 */
export function roleCode(t, role) {
  const n = sha256(PAIR_LABEL, 'compare', role, t).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}
export const codesEqual = (a, b) => tagsEqual(Buffer.from(String(a)), Buffer.from(String(b)));

/** Pairing key: from the key exchange, salted with the beacon secret, bound to the transcript. */
export function pairingKey(shared, secret, t) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, secret, Buffer.concat([b(PAIR_LABEL), t]), 32));
}

export function confirmTag(key, role, label = PAIR_LABEL) {
  return crypto.createHmac('sha256', key).update(`${label} confirm ${role}`).digest();
}

// ---- protocol v3 (Noise; see docs/NOISE.md) ------------------------------------
// New labels only: the v2 labels stay as they are so v2 devices keep working.

export const PROTOCOL_V3 = 3;
export const PAIR3_LABEL = 'VINAC pairing v3';
export const SESSION3_LABEL = 'VINAC session v3';
export const MSG3_LABEL = 'VINAC messages v3';

export const pairPrologue = secret => sha256(PAIR3_LABEL, 'prologue', secret);
export function canonicalMeta3({ aName, bName, aPort, bPort }) {
  return JSON.stringify({ v: PROTOCOL_V3, roles: ['announce', 'listen'], aName, bName, aPort, bPort });
}
export const transcript3 = ({ h, idA, idB, nA, nB, meta }) => sha256(PAIR3_LABEL, 'transcript', h, idA, idB, nA, nB, meta);
export function roleCode3(t, role) {
  const n = sha256(PAIR3_LABEL, 'compare', role, t).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}
export const sessionPrologue = (pattern, initiator, responder) => sha256(SESSION3_LABEL, pattern, initiator, responder);
export const tagsEqual = (a, c) => a.length === c.length && crypto.timingSafeEqual(a, c);

// ---- sealing ----------------------------------------------------------------

export const MSG_LABEL = 'AgentLink messages v2';

// ---- sessions: forward secrecy for network traffic ---------------------------
// Each sender opens a short-lived session with fresh X25519 keys on both sides,
// authenticated with a key derived from the pairing key. Session keys live only
// in memory and expire, so a pairing key stolen later cannot decrypt recorded
// network traffic.

const SESSION_LABEL = 'AgentLink session v1';
const hkdf = (ikm, salt, info, len = 32) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from(salt), Buffer.from(info), len));

/** Key that proves knowledge of the pairing key in handshakes, receipts and notices. */
export const authKey = pairKey => hkdf(pairKey, Buffer.alloc(0), `${SESSION_LABEL} auth`);
export const mac = (key, ...parts) => crypto.createHmac('sha256', key).update(sha256(...parts)).digest();

export function sessionKeys({ shared, pairKey, initiator, responder, eI, eR }) {
  const info = Buffer.concat([Buffer.from(SESSION_LABEL), sha256(initiator, responder, eI, eR)]);
  const okm = hkdf(shared, pairKey, info, 96);
  return { i2r: okm.subarray(0, 32), r2i: okm.subarray(32, 64), receipt: okm.subarray(64, 96), sid: sha256(SESSION_LABEL, 'sid', eI, eR).subarray(0, 12).toString('hex') };
}

/** Delivery receipt: proves the receiver (holder of the session) got exactly this payload. */
export const receiptTag = (key, kind, id, payload) => mac(key, SESSION_LABEL, 'receipt', kind, id, sha256(payload));
export const receiptTag3 = (key, kind, id, payload) => mac(key, SESSION3_LABEL, 'receipt', kind, id, sha256(payload));

export const SECRET_LABEL = 'AgentLink secrets v1';

/** Separate key for secrets, so a message key and a secret key never coincide. */
export function secretKey(pairKey) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(pairKey), Buffer.alloc(0), SECRET_LABEL, 32));
}

export function seal(key, aad, plaintext, nonce = crypto.randomBytes(12)) {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final(), c.getAuthTag()]);
  return { nonce, ct };
}

export function open(key, aad, nonce, ct) {
  try {
    const n = Buffer.from(nonce), body = Buffer.from(ct);
    if (n.length !== 12 || body.length < 16) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, n);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  } catch { return null; }
}
