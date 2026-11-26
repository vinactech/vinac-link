// An independent QR decoder for tests (reads a code's modules; no image processing) written from the spec: the layout
// (alignment positions, block structure) comes from the standard's formulas, not the encoder's
// tables; format and version bits are matched against every valid word; each block's error
// correction is checked by its syndromes; then the byte-mode text is read back.
// No imports, so it also runs in a browser page (for checking codes a page draws).
const assert = {
  equal(a, b, m) { if (a !== b) throw new Error(`${m || 'QR'}: ${a} !== ${b}`); },
  notEqual(a, b, m) { if (a === b) throw new Error(`${m || 'QR'}: both ${a}`); },
  ok(v, m) { if (!v) throw new Error(m || 'QR check failed'); },
};
/** The modules of a code drawn by qrSvg (an SVG string), for decode(). */
export function fromSvg(svg, quiet) {
  const n = Number(svg.match(/viewBox="0 0 (\d+) /)[1]), size = n - quiet * 2, dark = new Set();
  for (const [, x, y] of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${x - quiet},${y - quiet}`);
  return { size, dark: (x, y) => dark.has(`${x},${y}`) };
}

const EC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];

function alignPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}
function rawCodewords(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return Math.floor(r / 8);
}
const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; };
const gfPow = (x, n) => { let r = 1; for (let i = 0; i < n; i++) r = gfMul(r, x); return r; };
function bch(data, bits, poly) { let r = data << bits; for (let i = 31; i >= bits; i--) if ((r >>> i) & 1) r ^= poly << (i - bits); return (data << bits) | r; }

export function decode(q) {
  const size = q.size, v = (size - 17) / 4;
  assert.ok(Number.isInteger(v) && v >= 1 && v <= 20);
  const m = (x, y) => q.dark(x, y);
  // Function modules, from the spec.
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8);
  mark(6, 0, 1, size); mark(0, 6, size, 1);
  const al = alignPositions(v);
  const corner = (ax, ay) => (ax === 6 && ay === 6) || (ax === 6 && ay === al.at(-1)) || (ax === al.at(-1) && ay === 6);
  for (const ax of al) for (const ay of al) if (!corner(ax, ay)) mark(ax - 2, ay - 2, 5, 5);
  if (v >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }
  // Finder patterns where they belong.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    assert.equal(m(cx + dx, cy + dy), d !== 2, 'finder');
  }
  for (let i = 8; i < size - 8; i++) { assert.equal(m(i, 6), i % 2 === 0, 'timing'); assert.equal(m(6, i), i % 2 === 0, 'timing'); }
  for (const ax of al) for (const ay of al) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === al.at(-1)) || (ax === al.at(-1) && ay === 6)) continue;
    assert.equal(m(ax, ay), true, 'alignment centre'); assert.equal(m(ax + 1, ay), false); assert.equal(m(ax + 2, ay), true);
  }
  assert.equal(m(8, size - 8), true, 'dark module');
  // Format: both copies, matched against all 32 valid words.
  let f1 = 0;
  for (let i = 0; i <= 5; i++) f1 |= m(8, i) << i;
  f1 |= m(8, 7) << 6; f1 |= m(8, 8) << 7; f1 |= m(7, 8) << 8;
  for (let i = 9; i < 15; i++) f1 |= m(14 - i, 8) << i;
  let f2 = 0;
  for (let i = 0; i < 8; i++) f2 |= m(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) f2 |= m(8, size - 15 + i) << i;
  assert.equal(f1, f2, 'the two format copies agree');
  const fmt = [...Array(32).keys()].find(d => (bch(d, 10, 0x537) ^ 0x5412) === f1);
  assert.notEqual(fmt, undefined, 'valid format word');
  assert.equal(fmt >> 3, 0, 'level M');
  const mask = fmt & 7;
  if (v >= 7) {
    let a = 0, b = 0;
    for (let i = 0; i < 18; i++) { a |= m(size - 11 + (i % 3), Math.floor(i / 3)) << i; b |= m(Math.floor(i / 3), size - 11 + (i % 3)) << i; }
    assert.equal(a, bch(v, 12, 0x1f25), 'version word'); assert.equal(b, a);
  }
  // Data, unmasked, in zigzag order.
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x]) bits.push(m(x, y) !== MASKS[mask](x, y));
    }
  }
  const raw = rawCodewords(v);
  const words = [];
  for (let i = 0; i < raw; i++) words.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  // Blocks (Nayuki's split), de-interleaved, each checked by its syndromes.
  const nb = BLOCKS_M[v], ec = EC_PER_BLOCK_M[v], shortLen = Math.floor(raw / nb), nShort = nb - (raw % nb);
  const blocks = Array.from({ length: nb }, (_, i) => ({ d: [], e: [], dl: shortLen - ec + (i < nShort ? 0 : 1) }));
  let k = 0;
  for (let i = 0; i < shortLen - ec + 1; i++) for (const b of blocks) if (i < b.dl) b.d.push(words[k++]);
  for (let i = 0; i < ec; i++) for (const b of blocks) b.e.push(words[k++]);
  for (const b of blocks) {
    const cw = [...b.d, ...b.e];
    for (let s = 0; s < ec; s++) {
      const a = gfPow(2, s);
      let r = 0;
      for (const c of cw) r = gfMul(r, a) ^ c;
      assert.equal(r, 0, `syndrome ${s} of a block`);
    }
  }
  const data = blocks.flatMap(b => b.d);
  const dbits = data.flatMap(w => [...Array(8)].map((_, i) => (w >>> (7 - i)) & 1));
  const take = n => { let r = 0; for (let i = 0; i < n; i++) r = (r << 1) | dbits.shift(); return r; };
  assert.equal(take(4), 4, 'byte mode');
  const len = take(v < 10 ? 8 : 16);
  return new TextDecoder().decode(Uint8Array.from({ length: len }, () => take(8)));
}

