// Protocol v3 (Noise) in the service: pairing, sessions, older devices, upgrades, downgrades.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startDevice, api, pair, waitFor } from './helpers.mjs';
import { Daemon } from '../src/daemon.js';
import { Handshake } from '../src/noise.js';
import { sessionPrologue, b64u } from '../src/crypto.js';

const lan = async (d, route, body) => {
  const r = await fetch(`http://127.0.0.1:${d.port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const send = (from, text) => api(from, 'POST', '/api/send', { text });
const inbox = async d => (await api(d, 'GET', '/api/inbox')).body.messages.map(m => m.text);
const recordOf = (d, other) => d.store.peers().find(p => p.id === other.meId);
const restart = async (d, opts = {}) => {
  const home = d.homeDir, port = d.port;
  await d.stop();
  const n = await new Daemon({ home, name: d.me.name, port, uiPort: 0, host: '127.0.0.1', lanHost: '127.0.0.1', log: () => {}, ...opts }).start();
  n.homeDir = home;
  return n;
};

test('v3: two current devices pair with Noise XX and talk over Noise KK', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    const ra = recordOf(A, B), rb = recordOf(B, A);
    assert.equal(ra.proto, 3); assert.equal(rb.proto, 3);
    assert.equal(ra.noiseKey, b64u(B.noise.publicRaw), 'A keeps B’s Noise key');
    assert.equal(rb.noiseKey, b64u(A.noise.publicRaw), 'B keeps A’s Noise key');
    assert.equal((await send(A, 'hello over noise')).status, 200);
    assert.equal((await send(B, 'and back')).status, 200);
    assert.deepEqual(await inbox(B), ['hello over noise']);
    assert.deepEqual(await inbox(A), ['and back']);
    assert.equal(A.outSessions.get(B.meId).pattern, 'KKpsk0');
    assert.equal(B.outSessions.get(A.meId).pattern, 'KKpsk0');
    const peers = (await api(A, 'GET', '/api/peers')).body.peers;
    assert.equal(peers[0].protocol, 3);
    // the Noise static key survives a restart and stays the same
    const keyBefore = b64u(A.noise.publicRaw);
    const A2 = await restart(A);
    try { assert.equal(b64u(A2.noise.publicRaw), keyBefore); assert.equal((await send(A2, 'after restart')).status, 200); }
    finally { await A2.stop(); }
  } finally { await A.stop().catch(() => {}); await B.stop(); }
});

for (const [label, aProto, bProto] of [['v3 listener, v2 announcer', 2, 3], ['v2 listener, v3 announcer', 3, 2]]) {
  test(`older devices: ${label} pair with v2 and keep talking`, async () => {
    const A = await startDevice('a', undefined, { maxProtocol: aProto }), B = await startDevice('b', undefined, { maxProtocol: bProto });
    try {
      await pair(A, B); // A announces, B listens
      assert.equal(recordOf(A, B).proto, undefined); assert.equal(recordOf(A, B).noiseKey, undefined);
      assert.equal(recordOf(B, A).proto, undefined);
      assert.equal((await send(A, 'one')).status, 200);
      assert.equal((await send(B, 'two')).status, 200);
      assert.deepEqual(await inbox(B), ['one']);
      assert.deepEqual(await inbox(A), ['two']);
      const v3side = aProto === 3 ? A : B;
      assert.equal(v3side.outSessions.values().next().value.v, undefined, 'the v3 device fell back to a v2 session');
      assert.equal(recordOf(v3side, aProto === 3 ? B : A).proto, undefined, 'falling back does not mark the peer');
    } finally { await A.stop(); await B.stop(); }
  });
}

test('upgrade: devices paired with v2 move to Noise (NNpsk0) without pairing again, and never go back', async () => {
  let A = await startDevice('a', undefined, { maxProtocol: 2 }), B = await startDevice('b', undefined, { maxProtocol: 2 });
  try {
    await pair(A, B);
    assert.equal((await send(A, 'on v2')).status, 200);
    A = await restart(A); B = await restart(B);
    assert.equal((await send(A, 'on v3')).status, 200);
    assert.equal(A.outSessions.get(B.meId).v, 3);
    assert.equal(A.outSessions.get(B.meId).pattern, 'NNpsk0');
    assert.equal(recordOf(A, B).proto, 3); assert.equal(recordOf(B, A).proto, 3);
    assert.deepEqual(await inbox(B), ['on v2', 'on v3']);

    // B now refuses a v2 session from A, and A no longer falls back to v2 for B.
    await assert.rejects(A.openSession2(recordOf(A, B)), e => e.status === 403 && /DOWNGRADE_REFUSED/.test(e.message));
    // Even if B came back as an older version, A would not use v2 with it.
    B = await restart(B, { maxProtocol: 2 });
    A.outSessions.clear();
    const r = await send(A, 'should not go out over v2');
    assert.notEqual(r.status, 200);
  } finally { await A.stop(); await B.stop(); }
});

test('v3 sessions: a device paired with v3 cannot be asked for NN, and handshakes cannot be replayed or changed', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = (url, opts) => { if (String(url).endsWith('/noise')) seen.push(JSON.parse(opts.body)); return real(url, opts); };
  try {
    await pair(A, B);
    assert.equal((await send(A, 'first')).status, 200);
    const captured = seen[0];
    assert.equal(captured.pattern, 'KKpsk0');

    const replay = await lan(B, '/noise', captured);
    assert.equal(replay.status, 409); assert.equal(replay.body.error, 'SESSION_REPLAYED');

    const changed = Buffer.from(captured.m1, 'base64url'); changed[changed.length - 1] ^= 1;
    assert.equal((await lan(B, '/noise', { ...captured, m1: b64u(changed) })).body.error, 'BAD_SESSION_PROOF');

    // NN with the right pairing key: refused, because B holds A's static key.
    const hs = new Handshake({ pattern: 'NNpsk0', initiator: true, prologue: sessionPrologue('NNpsk0', A.meId, B.meId), psk: A.pairKeyOf(recordOf(A, B)) });
    const nn = await lan(B, '/noise', { v: 3, from: A.meId, to: B.meId, pattern: 'NNpsk0', m1: b64u(hs.write(Buffer.from(JSON.stringify({ ts: Date.now() })))) });
    assert.equal(nn.status, 403); assert.equal(nn.body.error, 'DOWNGRADE_REFUSED');

    // A v2 session request is refused too.
    await assert.rejects(A.openSession2(recordOf(A, B)), e => e.status === 403);
  } finally { globalThis.fetch = real; await A.stop(); await B.stop(); }
});

test('v3 sessions: a device in the middle that hides /noise cannot force v2', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  let v2Tries = 0;
  const middle = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', async () => {
      if (req.url === '/noise') { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"Not found"}'); }
      if (req.url === '/session') v2Tries++;
      const r = await fetch(`http://127.0.0.1:${B.port}${req.url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text());
    });
  });
  await new Promise(r => middle.listen(0, '127.0.0.1', r));
  try {
    await pair(A, B);
    const peers = A.store.peers(); peers[0].address = `127.0.0.1:${middle.address().port}`; peers[0].alt = []; A.store.savePeers(peers);
    A.outSessions.clear();
    const r = await send(A, 'through the middle');
    assert.notEqual(r.status, 200);
    assert.equal(v2Tries, 0, 'A never tried a v2 session with a device paired with v3');
    assert.deepEqual(await inbox(B), []);
  } finally { await new Promise(r => middle.close(r)); await A.stop(); await B.stop(); }
});

test('v3 pairing: a changed message 2 or a wrong signature fails the pairing on both sides', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const r = await real(url, opts);
    if (!String(url).endsWith('/pair/hello')) return r;
    const j = await r.json();
    const m2 = Buffer.from(j.m2, 'base64url'); m2[40] ^= 1;
    return new Response(JSON.stringify({ ...j, m2: b64u(m2) }), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { ui } = await import('./helpers.mjs');
    const p = (await ui(A, 'POST', '/ui/announce')).body.pairing;
    await ui(B, 'POST', '/ui/heard', { code: p.beaconCode });
    await waitFor(async () => (await ui(B, 'GET', '/ui/state')).body.pairing?.state === 'failed');
    assert.notEqual((await ui(A, 'GET', '/ui/state')).body.pairing?.state, 'comparing');
    assert.equal(A.store.peers().length + B.store.peers().length, 0);
  } finally { globalThis.fetch = real; await A.stop(); await B.stop(); }
});
