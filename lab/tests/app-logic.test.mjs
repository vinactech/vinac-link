import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, newSession, pairingLink, readPairing } from '../js/session.js';
import { pickTones } from '../js/calibrate.js';
import { airtimeSeconds } from '../js/sender.js';

test('pairing link round-trips session, speed, correction and tones', () => {
  const session = newSession(), tones = [16500, 17400, 18300, 19500];
  const link = pairingLink('https://example.test/lab/index.html', { session, speed: SPEEDS.steady, fec: 64, tones });
  const p = readPairing(new URL(link).hash);
  assert.equal(p.session.id, session.id);
  assert.deepEqual(p.session.key, session.key);
  assert.equal(p.speed.bps, 50);
  assert.equal(p.fec, 64);
  assert.deepEqual(p.tones, tones);
  assert.equal(p.role, 'receive');
});

test('older lab links still pair; junk does not', () => {
  const p = readPairing('#sid=abc&key=' + 'A'.repeat(43) + '&role=receiver&tones=17400,18000,18600,19200');
  assert.equal(p.session.id, 'abc');
  assert.equal(p.role, 'receive');
  assert.equal(readPairing('#hello=1'), null);
  assert.equal(readPairing('#s=x&k=short'), null);
});

test('tone picker avoids weak spots and keeps 600 Hz spacing', () => {
  const rows = [];
  for (let f = 15000; f <= 19800; f += 300) rows.push({ f, db: [17700, 18000, 18600].includes(f) ? -85 : -55 });
  const t = pickTones(rows);
  assert.equal(t.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(t[i] - t[i - 1] >= 600);
  assert.ok(t.every(f => ![17700, 18000, 18600].includes(f)));
});

test('airtime grows with slower speed and stronger correction', () => {
  const fast = airtimeSeconds('Hello', { bps: 100, fec: 32 });
  assert.ok(airtimeSeconds('Hello', { bps: 50, fec: 32 }) > fast * 1.9);
  assert.ok(airtimeSeconds('Hello', { bps: 100, fec: 64 }) > fast);
});
