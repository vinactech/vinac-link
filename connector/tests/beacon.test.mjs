import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encodeBeacon, decodeBeacon, beaconToCode, codeToBeacon, BEACON_BYTES, BEACON_TONES, BEACON_BPS, BEACON_FEC } from '../web/beacon.js';
import { framedFskSymbolsV2, synthesizeFsk, decodeFskFrameV2 } from '../../lab/js/modem.js';

const sample = () => ({ ip: '192.168.1.42', port: 47800, secret: randomBytes(8), fingerprint: randomBytes(8) });

test('beacon round-trips and is 25 bytes', () => {
  const s = sample(), b = encodeBeacon(s), d = decodeBeacon(b);
  assert.equal(b.length, BEACON_BYTES);
  assert.ok(d.ok);
  assert.equal(d.ip, s.ip); assert.equal(d.port, s.port);
  assert.deepEqual(Buffer.from(d.secret), s.secret); assert.deepEqual(Buffer.from(d.fingerprint), s.fingerprint);
});

test('a damaged beacon is refused', () => {
  const b = encodeBeacon(sample()); b[10] ^= 1;
  assert.equal(decodeBeacon(b).reason, 'BEACON_CRC');
  assert.equal(decodeBeacon(b.subarray(0, 20)).reason, 'BEACON_LENGTH');
});

test('typed code round-trips and forgives case, dashes and look-alike letters', () => {
  const b = encodeBeacon(sample()), code = beaconToCode(b);
  assert.equal(code.replace(/-/g, '').length, 40);
  assert.deepEqual(codeToBeacon(code), b);
  assert.deepEqual(codeToBeacon(code.toLowerCase().replace(/-/g, ' ')), b);
  assert.equal(codeToBeacon('ABC'), null);
});

test('the page scripts parse (a syntax error would leave the page stuck on "Loading…")', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  for (const f of ['../web/app.js', '../web/beacon.js', '../web/secret-frame.js']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(f, import.meta.url))], { stdio: 'pipe' });
  }
});

// Through the modem: synthesize the sound, add echo and noise, decode it back.
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function room(clean, sr, noise) {
  const lead = Math.floor(rnd() * sr * 0.5), d = Math.round(sr * 0.007);
  const out = new Float32Array(lead + clean.length + sr);
  for (let i = 0; i < clean.length; i++) { out[lead + i] += clean[i]; if (lead + i + d < out.length) out[lead + i + d] += clean[i] * 0.4; }
  for (let i = 0; i < out.length; i++) out[i] += gauss() * noise;
  return out;
}

test('beacon survives the sound path (synthesized room) and takes under 6 s', () => {
  const sr = 48000;
  for (const noise of [0.002, 0.04]) {
    const b = encodeBeacon(sample());
    const symbols = framedFskSymbolsV2(b, BEACON_FEC);
    const seconds = symbols.length / (BEACON_BPS / 2);
    assert.ok(seconds < 6, `airtime ${seconds}s`);
    const pcm = room(synthesizeFsk(symbols, { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, amplitude: 0.3 }), sr, noise);
    const r = decodeFskFrameV2(pcm, { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: BEACON_BYTES, maxLength: BEACON_BYTES, accept: x => decodeBeacon(x).ok });
    assert.ok(r?.ok && !r.fecFailed, `noise ${noise}: ${JSON.stringify(r?.reason)}`);
    assert.deepEqual(Buffer.from(r.frameBytes), Buffer.from(b));
  }
});
