import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { startDevice, ui, api, state, waitFor, tempHome, startPair, pair } from './helpers.mjs';
import { Daemon } from '../src/daemon.js';
import { encodeBeacon, decodeBeacon, fromHex, toHex } from '../web/beacon.js';
import { protect, unprotect, detectKeystore } from '../src/keystore.js';
import { Store } from '../src/store.js';

const pairingState = async d => (await state(d)).pairing?.state;

test('the same sound heard twice (two open pages) keeps the pairing in progress', async () => {
  const A = await startDevice('pc2'), B = await startDevice('mac2');
  try {
    const p = await startPair(A, B, { via: 'hex' });
    const codeB = (await state(B)).pairing.showCode;
    // A second page decodes the same repeated sound and reports it again, while codes are on screen.
    assert.equal((await ui(B, 'POST', '/ui/heard', { hex: p.beaconHex })).status, 200);
    assert.equal(await pairingState(B), 'comparing', 'still the same pairing');
    assert.equal((await state(B)).pairing.showCode, codeB, 'the code on screen did not change');
    const codeA = (await state(A)).pairing.showCode;
    assert.equal((await ui(A, 'POST', '/ui/confirm', { code: codeB })).status, 200);
    assert.equal((await ui(B, 'POST', '/ui/confirm', { code: codeA })).status, 200);
    await waitFor(async () => (await pairingState(A)) === 'paired' && (await pairingState(B)) === 'paired', 4000);
  } finally { await A.stop(); await B.stop(); }
});

test('two devices pair by swapping codes; each trusts the other', async () => {
  const A = await startDevice('pc'), B = await startDevice('mac');
  try {
    await startPair(A, B, { via: 'hex' });
    const [sa, sb] = [await state(A), await state(B)];
    assert.match(sa.pairing.showCode, /^\d{6}$/);
    assert.match(sb.pairing.showCode, /^\d{6}$/);
    assert.notEqual(sa.pairing.showCode, sb.pairing.showCode, 'each side shows its own code');
    assert.equal(sa.pairing.peer.fingerprint, sb.device.fingerprint);

    assert.equal((await ui(A, 'POST', '/ui/confirm', { code: sb.pairing.showCode })).status, 200);
    assert.equal(await pairingState(A), 'comparing', 'one side alone does not finish pairing');
    assert.equal((await ui(B, 'POST', '/ui/confirm', { code: sa.pairing.showCode })).status, 200);
    await waitFor(async () => (await pairingState(A)) === 'paired' && (await pairingState(B)) === 'paired', 4000);
    const pa = (await state(A)).peers, pb = (await state(B)).peers;
    assert.equal(pa[0].fingerprint, sb.device.fingerprint);
    assert.equal(pb[0].name, 'pc');
    assert.equal(pa[0].via, 'sound');
  } finally { await A.stop(); await B.stop(); }
});

test('CRITICAL fix: a device never reveals the code it expects, so its own page cannot confirm it', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await startPair(A, B);
    const sa = await state(A), sb = await state(B);
    // Everything an agent on A can read through A's page and API:
    const visibleOnA = JSON.stringify([sa, (await api(A, 'GET', '/api/status')).body]);
    assert.ok(!visibleOnA.includes(sb.pairing.showCode), "A never shows B's code");
    // Typing A's own code into A (what a same-machine agent could do) fails.
    const own = await ui(A, 'POST', '/ui/confirm', { code: sa.pairing.showCode });
    assert.equal(own.status, 400);
    assert.match(own.body.error, /does not match/);
    // The agent API has no confirm at all and never shows codes or the beacon.
    assert.equal((await api(A, 'POST', '/api/confirm', {})).status, 404);
    const s = (await api(A, 'GET', '/api/status')).body;
    assert.equal(s.pairing.showCode, undefined);
    assert.equal(s.pairing.beaconHex, undefined);
  } finally { await A.stop(); await B.stop(); }
});

test('three wrong codes cancel the pairing on both devices', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await startPair(A, B);
    for (const code of ['111111', '222222']) assert.equal((await ui(B, 'POST', '/ui/confirm', { code })).status, 400);
    const third = await ui(B, 'POST', '/ui/confirm', { code: '333333' });
    assert.match(third.body.error, /Too many wrong codes/);
    await waitFor(async () => (await pairingState(A)) === 'cancelled' && (await pairingState(B)) === 'cancelled', 4000);
    assert.equal((await state(A)).peers.length, 0);
  } finally { await A.stop(); await B.stop(); }
});

for (const v of [3, 2]) {
  test(`names and ports are signed: changing them on the way breaks pairing (protocol v${v})`, async () => {
    const A = await startDevice('a', undefined, { maxProtocol: v }), B = await startDevice('b', undefined, { maxProtocol: v });
    const real = globalThis.fetch;
    globalThis.fetch = (url, opts) => {
      if (String(url).endsWith('/pair/hello')) {
        const b = JSON.parse(opts.body);
        if (b.v === 3) {
          // message 1 of Noise XX: 32-byte ephemeral key, then the (unencrypted) payload
          const m1 = Buffer.from(b.m1, 'base64url');
          const payload = JSON.parse(m1.subarray(32).toString('utf8'));
          payload.name = 'Trusted Laptop';
          b.m1 = Buffer.concat([m1.subarray(0, 32), Buffer.from(JSON.stringify(payload))]).toString('base64url');
        } else b.name = 'Trusted Laptop';
        opts = { ...opts, body: JSON.stringify(b) };
      }
      return real(url, opts);
    };
    try {
      const p = (await ui(A, 'POST', '/ui/announce')).body.pairing;
      await ui(B, 'POST', '/ui/heard', { code: p.beaconCode });
      await waitFor(async () => (await pairingState(B)) === 'failed' || (await pairingState(B)) === 'comparing');
      assert.equal(await pairingState(B), 'failed');
      assert.notEqual(await pairingState(A), 'comparing');
    } finally { globalThis.fetch = real; await A.stop(); await B.stop(); }
  });
}

test('an older protocol version is refused explicitly', async () => {
  const A = await startDevice('a');
  try {
    const p = (await ui(A, 'POST', '/ui/announce')).body.pairing;
    const rid = (await import('../src/crypto.js')).rendezvousId(Buffer.from(decodeBeacon(fromHex(p.beaconHex)).secret)).toString('hex');
    const r = await fetch(`http://127.0.0.1:${A.port}/pair/hello`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, rid }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /UNSUPPORTED_VERSION/);
  } finally { await A.stop(); }
});

test('a beacon naming a different key is refused before any codes appear', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    const p = (await ui(A, 'POST', '/ui/announce')).body.pairing;
    const real = decodeBeacon(fromHex(p.beaconHex));
    const forged = encodeBeacon({ ip: real.ip, port: real.port, secret: real.secret, fingerprint: randomBytes(8) });
    await ui(B, 'POST', '/ui/heard', { hex: toHex(forged) });
    await waitFor(async () => (await pairingState(B)) === 'failed');
    assert.match((await state(B)).pairing.message, /not the one that played/);
  } finally { await A.stop(); await B.stop(); }
});

test('without the beacon secret, the announcing device does not answer', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    const p = (await ui(A, 'POST', '/ui/announce')).body.pairing;
    const real = decodeBeacon(fromHex(p.beaconHex));
    const guessed = encodeBeacon({ ip: real.ip, port: real.port, secret: randomBytes(8), fingerprint: real.fingerprint });
    await ui(B, 'POST', '/ui/heard', { hex: toHex(guessed) });
    await waitFor(async () => (await pairingState(B)) === 'failed');
    assert.equal(await pairingState(A), 'announcing');
  } finally { await A.stop(); await B.stop(); }
});

test('cancel on one device cancels the other', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await startPair(A, B);
    await ui(B, 'POST', '/ui/cancel');
    await waitFor(async () => (await pairingState(A)) === 'cancelled');
    await startPair(A, B);
    await ui(A, 'POST', '/ui/cancel');
    await waitFor(async () => (await pairingState(B)) === 'cancelled', 4000);
    assert.equal((await state(A)).peers.length, 0);
  } finally { await A.stop(); await B.stop(); }
});

test('the page: other host names, other origins and a missing token are refused; never framed', async () => {
  const A = await startDevice('a');
  try {
    const raw = headers => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: A.uiPort, path: '/ui/state', headers: { 'x-ui-token': A.uiToken, ...headers } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
    });
    assert.equal(await raw({ host: 'evil.example' }), 403);
    assert.equal(await raw({ origin: 'http://evil.example' }), 403);
    assert.equal(await raw({ 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await raw({}), 200);
    assert.equal((await ui(A, 'GET', '/ui/state', null, { token: 'wrong' })).status, 401);
    const page = await fetch(`http://127.0.0.1:${A.uiPort}/`);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal((await fetch(`http://127.0.0.1:${A.uiPort}/lab/js/../../package.json`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${A.uiPort}/web/%E0%A4%A`)).status, 404);
  } finally { await A.stop(); }
});

test('pairing endpoints are rate limited per address', async () => {
  const A = await startDevice('a');
  try {
    const codes = [];
    for (let i = 0; i < 35; i++) {
      const r = await fetch(`http://127.0.0.1:${A.port}/pair/hello`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"v":2}' });
      codes.push(r.status);
    }
    assert.ok(codes.includes(429), `got ${[...new Set(codes)]}`);
  } finally { await A.stop(); }
});

test('identity survives a restart; unpair removes trust on both devices', async () => {
  const home = tempHome('restart');
  let A = await startDevice('a', home);
  const B = await startDevice('b');
  try {
    const fp = A.me.fpText;
    await pair(A, B);
    await A.stop();
    A = await new Daemon({ home, port: 0, host: '127.0.0.1', lanHost: '127.0.0.1', log: () => {} }).start();
    assert.equal(A.me.fpText, fp);
    // A's port changed, so B must learn it; A proves itself when it next talks to B.
    await api(A, 'POST', '/api/send', { text: 'back' });
    await waitFor(async () => (await state(B)).peers[0].address === `127.0.0.1:${A.port}`);
    const r = await ui(A, 'POST', '/ui/unpair', { id: (await state(A)).peers[0].id });
    assert.equal(r.body.unpaired.otherDeviceTold, true);
    assert.equal((await state(A)).peers.length, 0);
    assert.equal((await state(B)).peers.length, 0, 'the other device removed it too');
  } finally { await A.stop(); await B.stop(); }
});

test('HIGH fix: key storage fails closed; no silent plain-file fallback', () => {
  const saved = process.env.VINAC_KEYSTORE;
  try {
    process.env.VINAC_KEYSTORE = 'bogus';
    assert.throws(() => detectKeystore(), /must be dpapi, keychain, secret-service or file/);
    assert.throws(() => new Store(tempHome('bogus')).identity('x'), /must be dpapi, keychain, secret-service or file/);
    assert.throws(() => protect('nope', 'label', Buffer.from('x')), /Unknown key store/);
  } finally { process.env.VINAC_KEYSTORE = saved; }
});

test('a damaged peers.json stops VINAC Link instead of silently forgetting pairings', async () => {
  const home = tempHome('corrupt');
  const s = new Store(home);
  (await import('node:fs')).writeFileSync(s.file('peers.json'), '{not json');
  assert.throws(() => s.peers(), /damaged/);
});

test('Windows DPAPI wraps and unwraps the key', { skip: process.platform !== 'win32' }, () => {
  const secret = randomBytes(48);
  const w = protect('dpapi', 'test', secret);
  assert.ok(w.stored && !w.stored.includes(secret.toString('base64')));
  assert.deepEqual(unprotect('dpapi', 'test', w.stored), secret);
});

test('pairing by code: "Show a code here" announces quietly (no sound on the page) and pairs by typed code', async () => {
  const A = await startDevice('quiet-a'), B = await startDevice('quiet-b');
  try {
    const p = (await ui(A, 'POST', '/ui/announce', { quiet: true })).body.pairing;
    assert.equal(p.quiet, true, 'the page plays nothing for a quiet announce');
    assert.ok(p.beaconCode, 'the code is shown to the person');
    assert.equal((await ui(B, 'POST', '/ui/heard', { code: p.beaconCode })).status, 200);
    await waitFor(async () => (await state(A)).pairing?.state === 'comparing' && (await state(B)).pairing?.state === 'comparing');
    const [a, b] = [(await state(A)).pairing.showCode, (await state(B)).pairing.showCode];
    await ui(A, 'POST', '/ui/confirm', { code: b }); await ui(B, 'POST', '/ui/confirm', { code: a });
    await waitFor(async () => (await state(A)).pairing?.state === 'paired' && (await state(B)).pairing?.state === 'paired', 4000);
    assert.equal((await state(A)).peers[0].via, 'code');
    assert.equal((await ui(A, 'POST', '/ui/announce')).body.pairing.quiet, false, 'a normal announce still plays the sound');
  } finally { await A.stop(); await B.stop(); }
});
