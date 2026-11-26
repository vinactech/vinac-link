// The page's QR encoder, read back by the independent decoder in qr-decode.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { qrEncode } from '../web/qr.js';
import { decode } from './qr-decode.mjs';

test('QR: every size from version 1 to 20 reads back to the same text', () => {
  const seen = new Set();
  for (const n of [1, 10, 14, 30, 60, 100, 150, 200, 213, 230, 260, 300, 330, 360, 400, 410, 450, 500, 560, 620, 666]) {
    const text = `https://vinac.tech/app/#k=${'AbcXyz-_09'.repeat(70)}`.slice(0, n);
    const q = qrEncode(text);
    seen.add(q.version);
    try { assert.equal(decode(q), text); } catch (e) { throw new Error(`length ${n} version ${q.version}: ${e.message}`); }
  }
  assert.ok(seen.has(1) && seen.has(10) && seen.has(15) && seen.has(20), [...seen].join(','));
  assert.throws(() => qrEncode('x'.repeat(667)), /Too long/);
  assert.equal(decode(qrEncode('ClÃ© ðŸ”‘ ok')), 'ClÃ© ðŸ”‘ ok');
});
