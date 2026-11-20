// Reed-Solomon error correction over GF(256) (primitive polynomial 0x11d).
// A block of n data bytes plus nsym parity bytes repairs up to nsym/2 wrong
// bytes, or up to nsym bytes whose positions are known to be doubtful
// ("erasures"), or a mix where 2*errors + erasures <= nsym.
// Polynomials are arrays with the highest-degree coefficient first.

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }

const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
const div = (a, b) => { if (b === 0) throw new Error('GF_DIV_ZERO'); return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; };
const pow = (a, p) => EXP[(((LOG[a] * p) % 255) + 255) % 255];
const inv = a => EXP[255 - LOG[a]];

const polyScale = (p, x) => p.map(c => mul(c, x));
function polyAdd(p, q) {
  const r = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}
function polyMul(p, q) {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j]);
  return r;
}
function polyEval(p, x) { let y = p[0]; for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i]; return y; }

const generators = new Map();
function generator(nsym) {
  if (!generators.has(nsym)) { let g = [1]; for (let i = 0; i < nsym; i++) g = polyMul(g, [1, pow(2, i)]); generators.set(nsym, g); }
  return generators.get(nsym);
}

/** Returns data followed by nsym parity bytes. */
export function rsEncode(data, nsym) {
  if (data.length + nsym > 255) throw new Error('RS_BLOCK_TOO_LONG');
  const gen = generator(nsym), out = new Array(data.length + nsym).fill(0);
  for (let i = 0; i < data.length; i++) out[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const c = out[i];
    if (c !== 0) for (let j = 1; j < gen.length; j++) out[i + j] ^= mul(gen[j], c);
  }
  const res = Uint8Array.from(data.length + nsym === 0 ? [] : out);
  res.set(data, 0);
  return res;
}

function syndromes(msg, nsym) {
  const s = [0];
  for (let i = 0; i < nsym; i++) s.push(polyEval(msg, pow(2, i)));
  return s;
}

function errataLocator(coefPos) {
  let loc = [1];
  for (const i of coefPos) loc = polyMul(loc, polyAdd([1], [pow(2, i), 0]));
  return loc;
}

function errorEvaluator(synd, errLoc, nsym) {
  const prod = polyMul(synd, errLoc);
  return prod.slice(-(nsym + 1));
}

function correctErrata(msg, synd, errPos) {
  const coefPos = errPos.map(p => msg.length - 1 - p);
  const errLoc = errataLocator(coefPos);
  const errEval = errorEvaluator([...synd].reverse(), errLoc, errLoc.length - 1).reverse();
  const X = coefPos.map(i => pow(2, -(255 - i)));
  const E = new Array(msg.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xiInv = inv(X[i]);
    let prime = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) prime = mul(prime, 1 ^ mul(xiInv, X[j]));
    if (prime === 0) throw new Error('RS_FORNEY_FAIL');
    let y = polyEval([...errEval].reverse(), xiInv);
    y = mul(X[i], y);
    E[errPos[i]] = div(y, prime);
  }
  return polyAdd(msg, E);
}

function errorLocator(synd, nsym, eraseCount) {
  let errLoc = [1], oldLoc = [1];
  const shift = synd.length - nsym;
  for (let i = 0; i < nsym - eraseCount; i++) {
    const K = i + shift;
    let delta = synd[K];
    for (let j = 1; j < errLoc.length; j++) delta ^= mul(errLoc[errLoc.length - 1 - j], synd[K - j]);
    oldLoc = [...oldLoc, 0];
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, inv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if ((errs - eraseCount) * 2 + eraseCount > nsym) throw new Error('RS_TOO_MANY_ERRORS');
  return errLoc;
}

function findErrors(errLoc, n) {
  const errs = errLoc.length - 1, pos = [];
  for (let i = 0; i < n; i++) if (polyEval(errLoc, pow(2, i)) === 0) pos.push(n - 1 - i);
  if (pos.length !== errs) throw new Error('RS_LOCATE_FAIL');
  return pos;
}

function forneySyndromes(synd, erasePos, n) {
  const f = synd.slice(1);
  for (const p of erasePos) {
    const x = pow(2, n - 1 - p);
    for (let j = 0; j < f.length - 1; j++) f[j] = mul(f[j], x) ^ f[j + 1];
  }
  return f;
}

/**
 * Repairs one codeword (data + nsym parity). erasePos lists byte positions
 * known to be doubtful. Returns {data, corrected} or throws if beyond repair.
 */
export function rsDecode(codeword, nsym, erasePos = []) {
  if (codeword.length > 255) throw new Error('RS_BLOCK_TOO_LONG');
  if (erasePos.length > nsym) throw new Error('RS_TOO_MANY_ERASURES');
  let msg = Array.from(codeword);
  for (const e of erasePos) msg[e] = 0;
  let synd = syndromes(msg, nsym);
  if (Math.max(...synd) === 0) return { data: Uint8Array.from(msg.slice(0, -nsym)), corrected: 0 };
  const fsynd = forneySyndromes(synd, erasePos, msg.length);
  const errLoc = errorLocator(fsynd, nsym, erasePos.length);
  const errPos = findErrors([...errLoc].reverse(), msg.length);
  const all = [...erasePos, ...errPos];
  msg = correctErrata(msg, synd, all);
  synd = syndromes(msg, nsym);
  if (Math.max(...synd) !== 0) throw new Error('RS_UNCORRECTABLE');
  let corrected = 0;
  for (let i = 0; i < msg.length; i++) if (msg[i] !== codeword[i]) corrected++;
  return { data: Uint8Array.from(msg.slice(0, -nsym)), corrected };
}

// ---- v2 frame coding: header block + interleaved body blocks ---------------

export const HEADER_NSYM = 6;          // 2-byte length, repairs 3 wrong bytes
export const HEADER_BYTES = 2 + HEADER_NSYM;
// Repair strength per body block. The level travels in the top 2 bits of the
// protected header, so the receiver needs no setting. Level 0 = 32 bytes
// (repairs 16 wrong bytes), level 1 = 64 bytes (repairs 32).
export const BODY_NSYM = 32;
export const NSYM_LEVELS = Object.freeze([32, 64]);

function blockSizes(length, nsym = BODY_NSYM) {
  const nb = Math.max(1, Math.ceil(length / (255 - nsym)));
  const base = Math.floor(length / nb), extra = length % nb;
  return Array.from({ length: nb }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Total coded bytes (header + body) for a frame of `length` bytes. */
export function codedLength(length, nsym = BODY_NSYM) {
  const sizes = blockSizes(length, nsym);
  return HEADER_BYTES + length + sizes.length * nsym;
}

/** Encodes frame bytes: [header codeword][body codewords, byte-interleaved]. */
export function fecEncode(frame, nsym = BODY_NSYM) {
  const level = NSYM_LEVELS.indexOf(nsym);
  if (level < 0) throw new Error('FEC_BAD_STRENGTH');
  if (frame.length > 0x3fff) throw new Error('FEC_FRAME_TOO_LONG');
  const header = rsEncode(Uint8Array.of((level << 6) | (frame.length >> 8), frame.length & 255), HEADER_NSYM);
  const sizes = blockSizes(frame.length, nsym), words = [];
  let o = 0;
  for (const s of sizes) { words.push(rsEncode(frame.slice(o, o + s), nsym)); o += s; }
  const body = [];
  const longest = Math.max(...words.map(w => w.length));
  for (let k = 0; k < longest; k++) for (const w of words) if (k < w.length) body.push(w[k]);
  return Uint8Array.from([...header, ...body]);
}

/** Decodes the frame length and repair strength from a header codeword. */
export function fecDecodeHeader(headerBytes, erasePos = []) {
  const { data } = rsDecode(headerBytes, HEADER_NSYM, erasePos);
  const level = data[0] >> 6, length = ((data[0] & 0x3f) << 8) | data[1];
  if (length < 1 || length > 1024 || level >= NSYM_LEVELS.length) throw new Error('FEC_BAD_HEADER');
  return { length, nsym: NSYM_LEVELS[level] };
}

/** Uncorrected frame bytes (data positions only), used to report a failure. */
export function fecRawFrame(body, length, nsym = BODY_NSYM) {
  const sizes = blockSizes(length, nsym), words = sizes.map(s => ({ bytes: [], size: s + nsym, data: s }));
  const longest = Math.max(...words.map(w => w.size));
  let p = 0;
  for (let k = 0; k < longest; k++) for (const w of words) if (k < w.size) w.bytes.push(body[p++] ?? 0);
  return Uint8Array.from(words.flatMap(w => w.bytes.slice(0, w.data)));
}

/**
 * Decodes the interleaved body for a frame of `length` bytes.
 * `confidence` (optional, one number per body byte, higher = surer) lets the
 * decoder retry with the least certain bytes marked as erasures.
 */
export function fecDecodeBody(body, length, confidence = null, nsym = BODY_NSYM) {
  const sizes = blockSizes(length, nsym), nb = sizes.length;
  const words = sizes.map(s => ({ bytes: [], idx: [], size: s + nsym }));
  const longest = Math.max(...words.map(w => w.size));
  let p = 0;
  for (let k = 0; k < longest; k++) for (const w of words) if (k < w.size) { w.bytes.push(body[p]); w.idx.push(p); p++; }
  const out = [];
  let corrected = 0;
  for (const w of words) {
    const attempts = [[]];
    if (confidence) {
      const order = w.idx.map((g, i) => ({ i, c: confidence[g] })).sort((a, b) => a.c - b.c).map(x => x.i);
      for (let e = 4; e <= nsym; e += 4) attempts.push(order.slice(0, e));
    }
    let ok = null;
    for (const er of attempts) { try { ok = rsDecode(w.bytes, nsym, er); break; } catch { /* try more erasures */ } }
    if (!ok) throw new Error('FEC_UNCORRECTABLE');
    corrected += ok.corrected;
    out.push(...ok.data);
  }
  return { frame: Uint8Array.from(out), corrected, blocks: nb };
}
