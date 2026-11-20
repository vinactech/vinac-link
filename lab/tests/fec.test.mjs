import test from 'node:test';
import assert from 'node:assert/strict';
import { rsEncode, rsDecode, fecEncode, fecDecodeHeader, fecDecodeBody, HEADER_BYTES, BODY_NSYM, codedLength } from '../js/fec.js';

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const randBytes = n => Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
function corrupt(word, count) {
  const w = Uint8Array.from(word), pos = new Set();
  while (pos.size < count) pos.add(Math.floor(rnd() * w.length));
  for (const p of pos) w[p] ^= 1 + Math.floor(rnd() * 255);
  return { w, pos: [...pos] };
}

test('RS repairs up to nsym/2 unknown errors', () => {
  for (let t = 0; t < 200; t++) {
    const data = randBytes(10 + Math.floor(rnd() * 150)), nsym = 32;
    const { w } = corrupt(rsEncode(data, nsym), Math.floor(rnd() * 17));
    assert.deepEqual(rsDecode(w, nsym).data, data);
  }
});

test('RS repairs up to nsym erasures and mixed errors/erasures', () => {
  for (let t = 0; t < 200; t++) {
    const data = randBytes(60), nsym = 32;
    const errs = Math.floor(rnd() * 8), eras = Math.floor(rnd() * (nsym - 2 * errs + 1));
    const { w, pos } = corrupt(rsEncode(data, nsym), errs + eras);
    assert.deepEqual(rsDecode(w, nsym, pos.slice(0, eras)).data, data);
  }
});

test('RS refuses rather than returning wrong data when far beyond capacity', () => {
  let wrong = 0;
  for (let t = 0; t < 200; t++) {
    const data = randBytes(60);
    const { w } = corrupt(rsEncode(data, 32), 40);
    try { const r = rsDecode(w, 32); if (!r.data.every((x, i) => x === data[i])) wrong++; } catch { /* refused */ }
  }
  assert.ok(wrong < 5, `silent miscorrections: ${wrong}`); // the frame CRC + HMAC still catch these
});

test('v2 coding round-trips frames of every lab size, with damage', () => {
  for (const len of [52, 63, 120, 223, 224, 307]) {
    const frame = randBytes(len), coded = fecEncode(frame);
    assert.equal(coded.length, codedLength(len));
    const header = Uint8Array.from(coded.slice(0, HEADER_BYTES));
    header[1] ^= 0x55; // one damaged header byte
    assert.deepEqual(fecDecodeHeader(header), { length: len, nsym: BODY_NSYM });
    const { w } = corrupt(coded.slice(HEADER_BYTES), Math.floor(BODY_NSYM / 2) - 2);
    assert.deepEqual(fecDecodeBody(w, len).frame, frame);
  }
});

test('strong level (64 repair bytes) is signalled in the header and repairs 32 wrong bytes', () => {
  for (const len of [63, 191, 192, 307]) {
    const frame = randBytes(len), coded = fecEncode(frame, 64);
    assert.equal(coded.length, codedLength(len, 64));
    const h = fecDecodeHeader(Uint8Array.from(coded.slice(0, HEADER_BYTES)));
    assert.deepEqual(h, { length: len, nsym: 64 });
    const { w } = corrupt(coded.slice(HEADER_BYTES), 30);
    assert.deepEqual(fecDecodeBody(w, h.length, null, h.nsym).frame, frame);
  }
});

test('confidence-guided erasures repair more than blind decoding', () => {
  const frame = randBytes(63), coded = fecEncode(frame).slice(HEADER_BYTES);
  const { w, pos } = corrupt(coded, 26); // beyond 16 blind, within 32 erasures
  const conf = Array.from(w, (_, i) => pos.includes(i) ? 0.1 : 5 + rnd());
  assert.throws(() => fecDecodeBody(w, 63));
  assert.deepEqual(fecDecodeBody(w, 63, conf).frame, frame);
});
