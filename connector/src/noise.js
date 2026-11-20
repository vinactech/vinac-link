// Noise Protocol Framework (revision 34), suite 25519 / ChaChaPoly / SHA256, on node:crypto only.
// Patterns: NN, KK, XX, with psk modifiers (NNpsk0, KKpsk0, XXpsk3, ...).
// Checked against the cacophony test vectors (tests/fixtures/noise-vectors.json).
//
// Used by VINAC Link protocol v3: XX for pairing, KKpsk0 / NNpsk0 for sessions.
import crypto from 'node:crypto';

const DHLEN = 32, HASHLEN = 32, TAGLEN = 16, MAX_MESSAGE = 65535;
const MAX_NONCE = 2n ** 64n - 1n; // reserved by the spec
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

export class NoiseError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const sha256 = data => crypto.createHash('sha256').update(data).digest();
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// ---- DH: X25519 ---------------------------------------------------------------

export function keyPairFromPrivate(privateRaw) {
  const d = Buffer.from(privateRaw);
  if (d.length !== DHLEN) throw new NoiseError('BAD_KEY');
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, d]), format: 'der', type: 'pkcs8' });
  const publicRaw = Buffer.from(crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-DHLEN));
  return { privateRaw: d, publicRaw, privateKey };
}

export function generateKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync('x25519');
  return keyPairFromPrivate(privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-DHLEN));
}

function dh(keyPair, publicRaw) {
  const pub = Buffer.from(publicRaw);
  if (pub.length !== DHLEN) throw new NoiseError('BAD_KEY');
  let out;
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, pub]), format: 'der', type: 'spki' });
    out = crypto.diffieHellman({ privateKey: keyPair.privateKey, publicKey });
  } catch { throw new NoiseError('BAD_KEY'); }
  if (out.every(x => x === 0)) throw new NoiseError('BAD_KEY'); // low-order point
  return out;
}

// ---- Cipher: ChaCha20-Poly1305 ---------------------------------------------

function nonceBytes(n) { const b = Buffer.alloc(12); b.writeBigUInt64LE(n, 4); return b; }

function aeadEncrypt(k, n, ad, plaintext) {
  const c = crypto.createCipheriv('chacha20-poly1305', k, nonceBytes(n), { authTagLength: TAGLEN });
  c.setAAD(ad, { plaintextLength: plaintext.length });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function aeadDecrypt(k, n, ad, ciphertext) {
  if (ciphertext.length < TAGLEN) throw new NoiseError('BAD_MESSAGE');
  const body = ciphertext.subarray(0, ciphertext.length - TAGLEN);
  try {
    const d = crypto.createDecipheriv('chacha20-poly1305', k, nonceBytes(n), { authTagLength: TAGLEN });
    d.setAAD(ad, { plaintextLength: body.length });
    d.setAuthTag(ciphertext.subarray(ciphertext.length - TAGLEN));
    return Buffer.concat([d.update(body), d.final()]);
  } catch { throw new NoiseError('BAD_MESSAGE'); }
}

export class CipherState {
  constructor(k = null) { this.k = k ? Buffer.from(k) : null; this.n = 0n; }
  get hasKey() { return this.k !== null; }
  encryptWithAd(ad, plaintext) {
    const pt = Buffer.from(plaintext);
    if (!this.k) return pt;
    if (this.n >= MAX_NONCE) throw new NoiseError('NONCE_EXHAUSTED');
    const ct = aeadEncrypt(this.k, this.n, Buffer.from(ad), pt);
    this.n++;
    return ct;
  }
  decryptWithAd(ad, ciphertext) {
    const ct = Buffer.from(ciphertext);
    if (!this.k) return ct;
    if (this.n >= MAX_NONCE) throw new NoiseError('NONCE_EXHAUSTED');
    const pt = aeadDecrypt(this.k, this.n, Buffer.from(ad), ct);
    this.n++; // only after a successful decryption
    return pt;
  }
}

// ---- SymmetricState -------------------------------------------------------------

function hkdf(chainingKey, ikm, outputs) {
  const temp = hmac(chainingKey, ikm);
  const o1 = hmac(temp, Buffer.from([1]));
  const o2 = hmac(temp, Buffer.concat([o1, Buffer.from([2])]));
  if (outputs === 2) return [o1, o2];
  return [o1, o2, hmac(temp, Buffer.concat([o2, Buffer.from([3])]))];
}

class SymmetricState {
  constructor(protocolName) {
    const name = Buffer.from(protocolName, 'ascii');
    this.h = name.length <= HASHLEN ? Buffer.concat([name, Buffer.alloc(HASHLEN - name.length)]) : sha256(name);
    this.ck = this.h;
    this.cs = new CipherState();
  }
  mixKey(ikm) { const [ck, k] = hkdf(this.ck, ikm, 2); this.ck = ck; this.cs = new CipherState(k); }
  mixHash(data) { this.h = sha256(Buffer.concat([this.h, data])); }
  mixKeyAndHash(ikm) {
    const [ck, th, k] = hkdf(this.ck, ikm, 3);
    this.ck = ck; this.mixHash(th); this.cs = new CipherState(k);
  }
  encryptAndHash(plaintext) { const ct = this.cs.encryptWithAd(this.h, plaintext); this.mixHash(ct); return ct; }
  decryptAndHash(ciphertext) { const pt = this.cs.decryptWithAd(this.h, ciphertext); this.mixHash(ciphertext); return pt; }
  split() { const [k1, k2] = hkdf(this.ck, Buffer.alloc(0), 2); return [new CipherState(k1), new CipherState(k2)]; }
}

// ---- HandshakeState -------------------------------------------------------------

const PATTERNS = {
  NN: { pre: [[], []], msgs: [['e'], ['e', 'ee']] },
  KK: { pre: [['s'], ['s']], msgs: [['e', 'es', 'ss'], ['e', 'ee', 'se']] },
  XX: { pre: [[], []], msgs: [['e'], ['e', 'ee', 's', 'es'], ['s', 'se']] },
};

/**
 * One side of a Noise handshake.
 *   new Handshake({ pattern: 'XX', initiator: true, prologue, s, rs, psk, e })
 *   s / e: key pairs from generateKeyPair() or keyPairFromPrivate(); rs / re: 32-byte public keys.
 *   `e` is only given in tests (fixed ephemerals for the test vectors).
 * write(payload) -> message; read(message) -> payload. When `complete`, `send` / `recv` are the
 * transport CipherStates and `hash` is the handshake hash (public: use it to bind, never as a key).
 */
export class Handshake {
  constructor({ pattern, initiator, prologue = Buffer.alloc(0), s = null, e = null, rs = null, re = null, psk = null }) {
    const m = /^(NN|KK|XX)((?:psk\d)*)$/.exec(pattern);
    if (!m) throw new NoiseError('UNKNOWN_PATTERN');
    const base = PATTERNS[m[1]];
    const pskPositions = [...m[2].matchAll(/psk(\d)/g)].map(x => Number(x[1]));
    this.msgs = base.msgs.map(x => [...x]);
    for (const n of pskPositions) {
      if (n > this.msgs.length) throw new NoiseError('UNKNOWN_PATTERN');
      if (n === 0) this.msgs[0].unshift('psk'); else this.msgs[n - 1].push('psk');
    }
    this.pskMode = pskPositions.length > 0;
    if (this.pskMode && !(psk && Buffer.from(psk).length === 32)) throw new NoiseError('PSK_REQUIRED');
    this.psk = psk ? Buffer.from(psk) : null;
    this.initiator = !!initiator;
    this.s = s; this.e = e; this.rs = rs ? Buffer.from(rs) : null; this.re = re ? Buffer.from(re) : null;
    this.protocolName = `Noise_${pattern}_25519_ChaChaPoly_SHA256`;
    this.ss = new SymmetricState(this.protocolName);
    this.ss.mixHash(Buffer.from(prologue));
    const [preI, preR] = base.pre;
    for (const t of preI) this.ss.mixHash(this.initiator ? this.need('s').publicRaw : this.need('rs'));
    for (const t of preR) this.ss.mixHash(this.initiator ? this.need('rs') : this.need('s').publicRaw);
    this.step = 0;
    this.send = null; this.recv = null; this.hash = null;
  }

  need(name) { if (!this[name]) throw new NoiseError(`MISSING_${name.toUpperCase()}`); return this[name]; }
  get complete() { return this.step >= this.msgs.length; }
  get myTurn() { return !this.complete && (this.step % 2 === 0) === this.initiator; }

  dhToken(t) {
    switch (t) {
      case 'ee': return dh(this.need('e'), this.need('re'));
      case 'es': return this.initiator ? dh(this.need('e'), this.need('rs')) : dh(this.need('s'), this.need('re'));
      case 'se': return this.initiator ? dh(this.need('s'), this.need('re')) : dh(this.need('e'), this.need('rs'));
      case 'ss': return dh(this.need('s'), this.need('rs'));
    }
    throw new NoiseError('UNKNOWN_TOKEN');
  }

  write(payload = Buffer.alloc(0)) {
    if (!this.myTurn) throw new NoiseError('NOT_MY_TURN');
    const out = [];
    for (const t of this.msgs[this.step]) {
      if (t === 'e') {
        this.e ??= generateKeyPair();
        out.push(this.e.publicRaw);
        this.ss.mixHash(this.e.publicRaw);
        if (this.pskMode) this.ss.mixKey(this.e.publicRaw);
      } else if (t === 's') out.push(this.ss.encryptAndHash(this.need('s').publicRaw));
      else if (t === 'psk') this.ss.mixKeyAndHash(this.psk);
      else this.ss.mixKey(this.dhToken(t));
    }
    out.push(this.ss.encryptAndHash(Buffer.from(payload)));
    const message = Buffer.concat(out);
    if (message.length > MAX_MESSAGE) throw new NoiseError('MESSAGE_TOO_LONG');
    this.advance();
    return message;
  }

  read(message) {
    if (this.complete || this.myTurn) throw new NoiseError('NOT_MY_TURN');
    const msg = Buffer.from(message);
    if (msg.length > MAX_MESSAGE) throw new NoiseError('MESSAGE_TOO_LONG');
    let off = 0;
    const take = n => {
      if (msg.length - off < n) throw new NoiseError('SHORT_MESSAGE');
      const part = Buffer.from(msg.subarray(off, off + n)); off += n; return part;
    };
    for (const t of this.msgs[this.step]) {
      if (t === 'e') {
        this.re = take(DHLEN);
        this.ss.mixHash(this.re);
        if (this.pskMode) this.ss.mixKey(this.re);
      } else if (t === 's') this.rs = this.ss.decryptAndHash(take(this.ss.cs.hasKey ? DHLEN + TAGLEN : DHLEN));
      else if (t === 'psk') this.ss.mixKeyAndHash(this.psk);
      else this.ss.mixKey(this.dhToken(t));
    }
    const payload = this.ss.decryptAndHash(msg.subarray(off));
    this.advance();
    return payload;
  }

  advance() {
    this.step++;
    if (!this.complete) return;
    const [c1, c2] = this.ss.split();
    this.send = this.initiator ? c1 : c2;
    this.recv = this.initiator ? c2 : c1;
    this.hash = this.ss.h;
    this.chainingKey = this.ss.ck; // kept only for exportKeys(); dropped with the handshake
  }

  /**
   * Extra keys bound to this handshake (receipts, pairing key), derived from the final chaining
   * key with distinct labels, so they never equal the transport keys.
   */
  exportKeys(label, count = 1) {
    if (!this.complete) throw new NoiseError('NOT_COMPLETE');
    const out = [];
    let prev = Buffer.alloc(0);
    for (let i = 1; i <= count; i++) {
      prev = hmac(hmac(this.chainingKey, Buffer.from(`VINAC export ${label}`)), Buffer.concat([prev, Buffer.from([i])]));
      out.push(prev);
    }
    return out;
  }
}
