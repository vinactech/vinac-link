import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { startDevice, ui, api, state, waitFor, tempHome, pair } from './helpers.mjs';
import { Daemon } from '../src/daemon.js';
import { Store } from '../src/store.js';
import { seal, MSG3_LABEL, b64u } from '../src/crypto.js';

/** Captures what a device sends to /msg, so tests can replay or tamper with it. */
function tap() {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).endsWith('/msg')) sent.push(JSON.parse(opts.body)); return real(url, opts); };
  return { sent, restore: () => { globalThis.fetch = real; } };
}
const post = (d, p, body) => fetch(`http://127.0.0.1:${d.port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));

test('paired devices exchange messages both ways with signed receipts; inbox marks them read', async () => {
  const A = await startDevice('pc'), B = await startDevice('mac');
  try {
    await pair(A, B);
    const peersA = (await api(A, 'GET', '/api/peers')).body.peers;
    assert.equal(peersA[0].canMessage, true);
    const s = await api(A, 'POST', '/api/send', { to: 'mac', text: 'Hello from the PC agent' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.delivered, true);
    const inbox = (await api(B, 'GET', '/api/inbox')).body.messages;
    assert.equal(inbox[0].text, 'Hello from the PC agent');
    assert.match(inbox[0].trust, /untrusted/);
    assert.equal((await api(B, 'GET', '/api/inbox')).body.messages.length, 0, 'read messages are not returned again');
    const r = await api(B, 'POST', '/api/send', { text: 'Hi PC, Mac here', replyTo: inbox[0].id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const back = (await api(A, 'GET', '/api/inbox')).body.messages;
    assert.equal(back[0].replyTo, inbox[0].id);
    const threadA = (await ui(A, 'GET', `/ui/messages?peer=${peersA[0].id}`)).body.messages;
    assert.deepEqual(threadA.map(m => [m.direction, m.by]), [['sent', 'agent'], ['received', 'agent']]);
  } finally { await A.stop(); await B.stop(); }
});

test('inbox waits for a message that arrives later', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    const started = Date.now();
    const waiting = api(B, 'GET', '/api/inbox?wait=5');
    setTimeout(() => api(A, 'POST', '/api/send', { text: 'late' }), 400);
    assert.equal((await waiting).body.messages[0]?.text, 'late');
    assert.ok(Date.now() - started < 4000);
  } finally { await A.stop(); await B.stop(); }
});

test('MEDIUM fix: "delivered" needs a receipt only the real peer can make', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  // A stand-in that passes the session handshake through to B but answers
  // messages itself with a plain "200 OK", like an on-path attacker would.
  const fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', async () => {
      if (req.url === '/session' || req.url === '/noise') {
        const r = await fetch(`http://127.0.0.1:${B.port}${req.url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(await r.text());
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  try {
    await pair(A, B);
    const peers = A.store.peers(); peers[0].address = `127.0.0.1:${fake.address().port}`; A.store.savePeers(peers);
    const r = await api(A, 'POST', '/api/send', { text: 'is anyone there?' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /valid receipt/);
    assert.equal((await api(B, 'GET', '/api/inbox')).body.messages.length, 0);
  } finally { await new Promise(r => fake.close(r)); await A.stop(); await B.stop(); }
});

test('MEDIUM fix: replays are refused by a time-based ledger; malformed ids are rejected, not truncated', async () => {
  const A = await startDevice('a'), B = await startDevice('b'), C = await startDevice('c');
  const t = tap();
  try {
    await pair(A, B);
    await api(A, 'POST', '/api/send', { text: 'original' });
    const env = t.sent[0];
    const replay = await post(B, '/msg', env);
    assert.equal(replay.status, 409); assert.equal(replay.body.error, 'ALREADY_RECEIVED');

    // The ledger is not a fixed-size list: 2000 other ids later, it still remembers.
    for (let i = 0; i < 2000; i++) B.store.rememberOnce(`x|${i}`, Date.now() + 60_000);
    assert.equal((await post(B, '/msg', env)).status, 409);

    // A 40-character id (sealed correctly in A's session) is refused outright.
    const s = A.outSessions.get(B.meId);
    const inner = { id: 'A'.repeat(40), text: 'long id', sentAt: new Date().toISOString(), replyTo: null, by: 'agent' };
    assert.equal(s.v, 3, 'two current devices use a Noise session');
    const { nonce, ct } = seal(s.sendKey, `${MSG3_LABEL}|msg|${A.meId}|${B.meId}|${s.sid}|${A.port}`, JSON.stringify(inner));
    const long = await post(B, '/msg', { v: 3, from: A.meId, to: B.meId, sid: s.sid, port: A.port, nonce: b64u(nonce), ct: b64u(ct) });
    assert.equal(long.status, 400); assert.equal(long.body.error, 'BAD_FIELD');

    const ct2 = Buffer.from(env.ct, 'base64url'); ct2[0] ^= 1;
    assert.equal((await post(B, '/msg', { ...env, ct: ct2.toString('base64url') })).body.error, 'BAD_MESSAGE');
    assert.equal((await post(B, '/msg', { ...env, port: env.port + 1 })).status, 400, 'the sender port is authenticated');
    assert.equal((await post(B, '/msg', { ...env, from: C.meId })).status, 403, 'not paired');
    assert.equal((await post(B, '/msg', { ...env, sid: 'f'.repeat(24) })).body.error, 'NO_SESSION');
    assert.equal((await post(B, '/msg', { ...env, v: 1 })).status, 400);
    assert.equal((await api(B, 'GET', '/api/inbox')).body.messages.length, 1);
  } finally { t.restore(); await A.stop(); await B.stop(); await C.stop(); }
});

test('MEDIUM fix: a relayed packet cannot move a peer; only a device that proves itself can', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    const before = (await state(B)).peers[0].address;
    // A packet from A arriving "from" another port (relay): B checks that address and finds no VINAC Link there.
    B.noticeAddress(B.store.peers()[0], { socket: { remoteAddress: '127.0.0.1' } }, 1);
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await state(B)).peers[0].address, before);
  } finally { await A.stop(); await B.stop(); }
});

test('MEDIUM fix: sessions use fresh keys, expire, and recover when the other device restarts', async () => {
  const home = tempHome('b-restart');
  const A = await startDevice('a');
  let B = await startDevice('b', home);
  try {
    await pair(A, B);
    await api(A, 'POST', '/api/send', { text: 'one' });
    const first = A.outSessions.get(B.meId).sid;
    await B.stop();
    B = await new Daemon({ home, port: 0, host: '127.0.0.1', lanHost: '127.0.0.1', log: () => {} }).start();
    // B has a new port and no sessions in memory. B talks first, A verifies B's new address,
    // then A's old session is refused and A opens a new one by itself.
    assert.equal((await api(B, 'POST', '/api/send', { text: 'I am back' })).status, 200);
    await waitFor(async () => (await state(A)).peers[0].address === `127.0.0.1:${B.port}`);
    assert.equal((await api(A, 'POST', '/api/send', { text: 'two' })).status, 200);
    assert.notEqual(A.outSessions.get(B.meId).sid, first, 'a new session with new keys');
    assert.deepEqual((await api(B, 'GET', '/api/inbox')).body.messages.map(m => m.text), ['one', 'two']);
  } finally { await A.stop(); await B.stop(); }
});

test('MEDIUM fix: message history is encrypted at rest; old plain history is moved in', async () => {
  const home = tempHome('history');
  fs.writeFileSync(`${home}/messages.json`, JSON.stringify([{ id: 'x'.repeat(16), dir: 'in', peer: { id: '0'.repeat(16), name: 'old' }, text: 'legacy plain text', sentAt: new Date().toISOString() }]));
  const A = await startDevice('a', home), B = await startDevice('b');
  try {
    assert.equal(A.store.messages()[0].text, 'legacy plain text');
    assert.ok(!fs.existsSync(`${home}/messages.json`), 'plain file removed');
    await pair(A, B);
    await api(A, 'POST', '/api/send', { text: 'TOP-SECRET-PLAN' });
    const disk = fs.readFileSync(`${home}/messages.enc`);
    assert.equal(disk.indexOf('TOP-SECRET-PLAN'), -1);
    assert.equal(disk.indexOf('legacy plain text'), -1);
    assert.equal(new Store(home).messages().at(-1).text, 'TOP-SECRET-PLAN');
  } finally { await A.stop(); await B.stop(); }
});

test('the person can send from the page; empty, oversized and unknown recipients are refused', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    const sent = await ui(A, 'POST', '/ui/send', { to: 'b', text: 'typed by a person' });
    assert.equal(sent.status, 200);
    assert.equal((await api(B, 'GET', '/api/inbox')).body.messages[0].by, 'person');
    assert.equal((await api(A, 'POST', '/api/send', { text: '   ' })).status, 400);
    assert.equal((await api(A, 'POST', '/api/send', { text: 'x'.repeat(8001) })).status, 413);
    assert.equal((await api(A, 'POST', '/api/send', { to: 'nobody', text: 'x' })).status, 404);
    assert.equal((await api(A, 'POST', '/api/send', { text: 'x', replyTo: 'not-an-id' })).status, 400);
    await ui(A, 'POST', '/ui/ping');
    await waitFor(async () => (await state(A)).peers[0].online === true);
    await B.stop();
    await ui(A, 'POST', '/ui/ping');
    await waitFor(async () => (await state(A)).peers[0].online === false);
    const waits = await api(A, 'POST', '/api/send', { text: 'anyone?' });
    assert.equal(waits.status, 200);
    assert.deepEqual([waits.body.sent, waits.body.queued], [false, true], 'an offline device: the message waits in the outbox');
  } finally { await A.stop(); await B.stop(); }
});
