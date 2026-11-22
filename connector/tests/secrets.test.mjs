import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, ui, api, state, waitFor, pair } from './helpers.mjs';
import { framedFskSymbolsV2, synthesizeFsk, decodeFskFrameV2 } from '../../lab/js/modem.js';
import { BEACON_TONES, BEACON_BPS, fromHex, toHex, crc16 } from '../web/beacon.js';
import { SECRET_FEC, SECRET_MIN_BYTES, SECRET_MAX_BYTES, secretFrameLooksValid } from '../web/secret-frame.js';

const TOKEN = 'sk-test-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH'; // fake, 51 chars
const receive = d => ui(d, 'POST', '/ui/secret/receive', { on: true });
const secretsOf = async d => (await state(d)).secrets;

// Synthesized room: delay, one echo, noise (same model as the beacon test).
let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function throughRoom(bytes, noise) {
  const sr = 48000;
  const clean = synthesizeFsk(framedFskSymbolsV2(bytes, SECRET_FEC), { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, amplitude: 0.3 });
  const lead = Math.floor(rnd() * sr * 0.5), d = Math.round(sr * 0.007);
  const out = new Float32Array(lead + clean.length + sr);
  for (let i = 0; i < clean.length; i++) { out[lead + i] += clean[i]; if (lead + i + d < out.length) out[lead + i + d] += clean[i] * 0.4; }
  for (let i = 0; i < out.length; i++) out[i] += gauss() * noise;
  const r = decodeFskFrameV2(out, { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: SECRET_MIN_BYTES, maxLength: SECRET_MAX_BYTES, accept: secretFrameLooksValid });
  assert.ok(r?.ok && !r.fecFailed, `noise ${noise}: ${JSON.stringify(r?.reason)}`);
  return r.frameBytes;
}

test('a secret travels by (synthesized) sound, lands in the key store, and agent tools see only its name', async () => {
  const A = await startDevice('pc'), B = await startDevice('mac');
  try {
    await pair(A, B);
    const sealed = await ui(A, 'POST', '/ui/secret/seal', { to: 'mac', name: 'OPENAI_API_KEY', value: TOKEN });
    assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
    const frame = fromHex(sealed.body.hex);
    assert.ok(sealed.body.seconds < 20, `airtime ${sealed.body.seconds}s`);
    assert.equal(Buffer.from(frame).indexOf(TOKEN.slice(0, 12)), -1, 'a recording shows neither value…');
    assert.equal(Buffer.from(frame).indexOf('OPENAI'), -1, '…nor name');
    for (const noise of [0.002, 0.04]) assert.deepEqual(Buffer.from(throughRoom(frame, noise)), Buffer.from(frame));

    await receive(B);
    const heard = await ui(B, 'POST', '/ui/secret/heard', { hex: toHex(throughRoom(frame, 0.02)) });
    assert.equal(heard.status, 200, JSON.stringify(heard.body));
    assert.equal(heard.body.name, 'OPENAI_API_KEY');

    const listed = await api(B, 'GET', '/api/secrets');
    assert.deepEqual(listed.body.secrets.map(s => [s.name, s.via, s.pending]), [['OPENAI_API_KEY', 'sound', false]]);
    const inbox = await api(B, 'GET', '/api/inbox');
    for (const r of [listed, inbox, await api(B, 'GET', '/api/status'), await ui(B, 'GET', '/ui/state')]) assert.ok(!JSON.stringify(r.body).includes(TOKEN));
    assert.equal((await api(B, 'POST', '/api/secrets/reveal', { id: heard.body.id })).status, 404, 'agent API has no reveal');
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: heard.body.id })).body.value, TOKEN);

    // The sender learns it arrived through an authenticated acknowledgement.
    await waitFor(async () => (await ui(A, 'GET', `/ui/secret/status?id=${sealed.body.id}`)).body.acked);
    const notes = (await ui(A, 'GET', `/ui/messages?peer=${B.meId}`)).body.messages;
    assert.match(notes.at(-1).text, /delivered to mac by sound/);
  } finally { await A.stop(); await B.stop(); }
});

test('HIGH fix: nothing is usable unless the person accepts it: by sound only while receiving; by Wi-Fi it waits as an offer', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    const hex = (await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'X', value: 'y-sound' })).body.hex;
    const bySound = await ui(B, 'POST', '/ui/secret/heard', { hex });
    assert.equal(bySound.status, 409); assert.match(bySound.body.error, /NOT_RECEIVING/);
    assert.equal((await secretsOf(B)).length, 0);

    // Wi-Fi without Receive: stored as an offer, which nothing can use or reveal.
    const byWifi = await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'X', value: 'y-offer' });
    assert.equal(byWifi.status, 200, JSON.stringify(byWifi.body));
    assert.equal(byWifi.body.offered, true);
    const offer = (await secretsOf(B)).find(s => s.name === 'X');
    assert.equal(offer.offered, true);
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: offer.id })).status, 409);
    assert.equal((await api(B, 'POST', '/api/secret-use', { names: ['X'], command: ['node', 'x.js'] })).status, 404, 'an offer is not usable');
    assert.notEqual((await api(B, 'POST', '/ui/secrets/accept', { id: offer.id })).status, 200, 'the agent cannot accept it');
    // The person accepts it: now it is a normal secret.
    assert.equal((await ui(B, 'POST', '/ui/secrets/accept', { id: offer.id })).status, 200);
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: offer.id })).body.value, 'y-offer');
    // Decline deletes an offer.
    await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'W', value: 'w' });
    const w = (await secretsOf(B)).find(s => s.name === 'W');
    assert.equal((await ui(B, 'POST', '/ui/secrets/decline', { id: w.id })).status, 200);
    assert.equal((await secretsOf(B)).some(s => s.name === 'W'), false);
    // With Receive pressed, a Wi-Fi secret is accepted at once (as before).
    await receive(B);
    const r = await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'Z', value: 'z' });
    assert.equal(r.body.offered, false);
    assert.equal((await secretsOf(B)).find(s => s.name === 'Z').offered, false);
  } finally { await A.stop(); await B.stop(); }
});

test('offers: a device in Auto mode is accepted at once; a device can offer at most 5 at a time; an offer never replaces silently', async () => {
  const A = await startDevice('offer-a'), B = await startDevice('offer-b');
  try {
    await pair(A, B);
    const peerA = B.store.peers()[0].id;
    for (let i = 0; i < 5; i++) assert.equal((await ui(A, 'POST', '/ui/secret/wifi', { to: 'offer-b', name: `K${i}`, value: 'v' })).status, 200);
    const sixth = await ui(A, 'POST', '/ui/secret/wifi', { to: 'offer-b', name: 'K5', value: 'v' });
    assert.notEqual(sixth.status, 200, 'the 6th waiting offer is refused');
    assert.match(sixth.body.error, /waiting to be accepted/);
    // Auto mode for A on B: accepted at once.
    await ui(B, 'POST', '/ui/firewall/mode', { scope: peerA, mode: 'auto' });
    const auto = await ui(A, 'POST', '/ui/secret/wifi', { to: 'offer-b', name: 'AUTO_KEY', value: 'a1' });
    assert.equal(auto.body.offered, false);
    // ...but a new value for a name it already has still waits for approval.
    const again = await ui(A, 'POST', '/ui/secret/wifi', { to: 'offer-b', name: 'AUTO_KEY', value: 'a2' });
    assert.equal(again.body.pending, true);
  } finally { await A.stop(); await B.stop(); }
});

test('requests: a device asks for a secret by name; the person here sends it with one click, and it is accepted there', async () => {
  const A = await startDevice('req-a'), B = await startDevice('req-b');
  try {
    await pair(A, B);
    await ui(A, 'POST', '/ui/secrets/add', { name: 'STRIPE_TEST_KEY', value: 'sk_test_req_1' });
    // B's agent asks A's person for it.
    const ask = await api(B, 'POST', '/api/send', { to: 'req-a', intent: 'person.secret.request', args: { name: 'STRIPE_TEST_KEY', reason: 'the shop build needs it' } });
    assert.equal(ask.status, 200, JSON.stringify(ask.body));
    const reqs = (await state(A)).secretRequests;
    assert.equal(reqs.length, 1);
    assert.deepEqual([reqs[0].name, reqs[0].have, reqs[0].peer.name], ['STRIPE_TEST_KEY', true, 'req-b']);
    assert.match(reqs[0].reason, /shop build/);
    // Agents can't answer it.
    assert.notEqual((await api(A, 'POST', '/ui/secret-requests/answer', { id: reqs[0].id })).status, 200);
    // One click on A: sent, and accepted on B because B asked (no Receive, no Accept).
    const sent = await ui(A, 'POST', '/ui/secret-requests/answer', { id: reqs[0].id });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.answer.offered, false);
    const got = (await secretsOf(B)).find(s => s.name === 'STRIPE_TEST_KEY');
    assert.equal(got.offered, false);
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: got.id })).body.value, 'sk_test_req_1');
    assert.equal((await state(A)).secretRequests.length, 0, 'answered requests leave the list');
    // A request for a name A doesn't have says so; dismiss removes it.
    await api(B, 'POST', '/api/send', { to: 'req-a', intent: 'person.secret.request', args: { name: 'MISSING_KEY' } });
    const r2 = (await state(A)).secretRequests[0];
    assert.equal(r2.have, false);
    assert.equal((await ui(A, 'POST', '/ui/secret-requests/answer', { id: r2.id })).status, 404);
    assert.equal((await ui(A, 'POST', '/ui/secret-requests/answer', { id: r2.id, dismiss: true })).status, 200);
    assert.equal((await state(A)).secretRequests.length, 0);
  } finally { await A.stop(); await B.stop(); }
});

test('HIGH fix: a peer cannot silently replace a secret; other peers get their own copy', async () => {
  const A = await startDevice('a'), B = await startDevice('b'), C = await startDevice('c');
  try {
    await pair(A, B); await pair(C, B);
    await receive(B);
    assert.equal((await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'DB_PASSWORD', value: 'first' })).status, 200);
    const second = await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'DB_PASSWORD', value: 'second' });
    assert.equal(second.body.pending, true);
    let s = await secretsOf(B);
    const live = s.find(x => !x.pending), staged = s.find(x => x.pending);
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: live.id })).body.value, 'first', 'unchanged until approved');
    // A different paired device using the same name does not touch A's secret.
    assert.equal((await ui(C, 'POST', '/ui/secret/wifi', { to: 'b', name: 'DB_PASSWORD', value: 'from-c' })).status, 200);
    s = await secretsOf(B);
    assert.equal(s.filter(x => x.from.name === 'c').length, 1);
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: live.id })).body.value, 'first');
    // The person approves: the staged value replaces the old one.
    await ui(B, 'POST', '/ui/secrets/approve', { id: staged.id });
    s = (await secretsOf(B)).filter(x => x.from.name === 'a');
    assert.deepEqual(s.map(x => [x.id, x.pending]), [[staged.id, false]]);
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: staged.id })).body.value, 'second');
    await ui(B, 'POST', '/ui/secrets/delete', { id: staged.id });
    assert.equal((await secretsOf(B)).filter(x => x.from.name === 'a').length, 0);
  } finally { await A.stop(); await B.stop(); await C.stop(); }
});

test('replayed, tampered, garbled, stale and wrong-device secrets are refused', async () => {
  const A = await startDevice('a'), B = await startDevice('b'), C = await startDevice('c');
  try {
    await pair(A, B); await pair(A, C);
    await receive(B); await receive(C);
    const hex = (await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'GITHUB_TOKEN', value: 'ghp_fake_123' })).body.hex;
    assert.equal((await ui(B, 'POST', '/ui/secret/heard', { hex })).body.duplicate, false);
    assert.equal((await ui(B, 'POST', '/ui/secret/heard', { hex })).body.duplicate, true, 'a replay is recognised and not stored twice');
    for (let i = 0; i < 400; i++) B.store.rememberOnce(`x|${i}`, Date.now() + 60_000);
    assert.equal((await ui(B, 'POST', '/ui/secret/heard', { hex })).body.duplicate, true, 'still recognised after many other ids');
    assert.equal((await secretsOf(B)).length, 1);

    const wrong = await ui(C, 'POST', '/ui/secret/heard', { hex });
    assert.equal(wrong.status, 403); assert.match(wrong.body.error, /different device/);

    const f = fromHex((await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'X', value: 'y' })).body.hex);
    f[30] ^= 1; const c = crc16(f.subarray(0, f.length - 2)); f[f.length - 2] = c >> 8; f[f.length - 1] = c & 255;
    const tampered = await ui(B, 'POST', '/ui/secret/heard', { hex: toHex(f) });
    assert.equal(tampered.status, 403); assert.match(tampered.body.error, /did not unlock/);

    const g = fromHex(hex); g[25] ^= 1;
    assert.equal((await ui(B, 'POST', '/ui/secret/heard', { hex: toHex(g) })).status, 400);

    const realNow = Date.now;
    Date.now = () => realNow() - 20 * 60_000;
    let oldHex;
    try { oldHex = (await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'OLD', value: 'z' })).body.hex; } finally { Date.now = realNow; }
    const stale = await ui(B, 'POST', '/ui/secret/heard', { hex: oldHex });
    assert.equal(stale.status, 400); assert.match(stale.body.error, /too old/);
  } finally { await A.stop(); await B.stop(); await C.stop(); }
});

test('input limits, and only the person can send: the agent API cannot seal a secret', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    assert.equal((await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'has space', value: 'x' })).status, 400);
    assert.equal((await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'OK', value: '' })).status, 400);
    assert.equal((await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'OK', value: 'x'.repeat(201) })).status, 413);
    const max = await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'N'.repeat(40), value: 'x'.repeat(200) });
    assert.equal(max.status, 200);
    assert.ok(max.body.bytes <= SECRET_MAX_BYTES);
    assert.ok(max.body.seconds < 40, `the longest secret (${max.body.seconds} s) fits the 45 s listening buffer`);
    assert.equal((await api(A, 'POST', '/api/secret/seal', { to: 'b', name: 'X', value: 'y' })).status, 404);
  } finally { await A.stop(); await B.stop(); }
});

test('vault: the person adds a secret here, sends a stored one by Wi-Fi or sound, and agents can neither add nor send', async () => {
  const A = await startDevice('vault-a'), B = await startDevice('vault-b');
  try {
    await pair(A, B);
    const added = await ui(A, 'POST', '/ui/secrets/add', { name: 'STRIPE_TEST_KEY', value: 'sk_test_fake_vault_1' });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.added.replaced, false);
    assert.ok(!JSON.stringify(added.body).includes('sk_test_fake_vault_1'), 'the page state never carries the value');
    let mine = (await secretsOf(A)).find(s => s.name === 'STRIPE_TEST_KEY');
    assert.equal(mine.own, true); assert.equal(mine.via, 'added'); assert.equal(mine.lastUsedAt, null);
    assert.equal((await ui(A, 'POST', '/ui/secrets/reveal', { id: mine.id })).body.value, 'sk_test_fake_vault_1');

    // Same name again replaces the person's own copy; bad input is refused.
    const again = await ui(A, 'POST', '/ui/secrets/add', { name: 'STRIPE_TEST_KEY', value: 'sk_test_fake_vault_2' });
    assert.equal(again.body.added.replaced, true);
    assert.equal((await secretsOf(A)).filter(s => s.name === 'STRIPE_TEST_KEY').length, 1);
    mine = (await secretsOf(A)).find(s => s.name === 'STRIPE_TEST_KEY');
    assert.equal((await ui(A, 'POST', '/ui/secrets/add', { name: 'has space', value: 'x' })).status, 400);
    assert.equal((await ui(A, 'POST', '/ui/secrets/add', { name: 'EMPTY', value: '' })).status, 400);
    assert.equal((await ui(A, 'POST', '/ui/secrets/add', { name: 'BIG', value: 'x'.repeat(201) })).status, 413);

    // Agents: no add, no send of stored secrets, names only.
    assert.equal((await api(A, 'POST', '/ui/secrets/add', { name: 'AGENT_KEY', value: 'x' })).status, 401);
    assert.notEqual((await api(A, 'POST', '/api/secrets/add', { name: 'AGENT_KEY', value: 'x' })).status, 200);
    assert.notEqual((await api(A, 'POST', '/ui/secrets/send', { id: mine.id, to: B.meId })).status, 200);
    assert.ok(!JSON.stringify((await api(A, 'GET', '/api/secrets')).body).includes('sk_test_fake'));

    // Send the stored one by Wi-Fi (B is receiving, so it is accepted at once).
    const peerB = A.store.peers()[0].id;
    await receive(B);
    const sent = await ui(A, 'POST', '/ui/secrets/send', { id: mine.id, to: peerB });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const got = (await secretsOf(B)).find(s => s.name === 'STRIPE_TEST_KEY');
    assert.equal(got.own, false); assert.equal(got.via, 'wifi');
    assert.equal((await ui(B, 'POST', '/ui/secrets/reveal', { id: got.id })).body.value, 'sk_test_fake_vault_2');

    // Seal it for sound: the frame carries neither name nor value, and B can open it.
    const sealed = await ui(A, 'POST', '/ui/secrets/seal', { id: mine.id, to: peerB });
    assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
    assert.equal(sealed.body.name, 'STRIPE_TEST_KEY');
    const frame = Buffer.from(fromHex(sealed.body.hex));
    assert.equal(frame.indexOf('sk_test_fake'), -1); assert.equal(frame.indexOf('STRIPE'), -1);
    assert.equal((await ui(A, 'POST', '/ui/secrets/seal', { id: 'nope', to: peerB })).status, 404);

    // A program run with the secret marks it used.
    const ask = await api(A, 'POST', '/api/secret-use', { names: ['STRIPE_TEST_KEY'], command: ['node', 'app.js'] });
    const waiting = api(A, 'GET', `/api/secret-use?id=${ask.body.id}&wait=10`);
    await ui(A, 'POST', '/ui/secret-use/decide', { id: ask.body.id, approve: true });
    assert.equal((await waiting).body.values.STRIPE_TEST_KEY, 'sk_test_fake_vault_2');
    assert.ok((await secretsOf(A)).find(s => s.name === 'STRIPE_TEST_KEY').lastUsedAt);
  } finally { await A.stop(); await B.stop(); }
});
