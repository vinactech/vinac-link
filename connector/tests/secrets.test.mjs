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

test('HIGH fix: nothing is accepted unless the person pressed "Receive a secret"', async () => {
  const A = await startDevice('a'), B = await startDevice('b');
  try {
    await pair(A, B);
    const hex = (await ui(A, 'POST', '/ui/secret/seal', { to: 'b', name: 'X', value: 'y' })).body.hex;
    const bySound = await ui(B, 'POST', '/ui/secret/heard', { hex });
    assert.equal(bySound.status, 409); assert.match(bySound.body.error, /NOT_RECEIVING/);
    const byWifi = await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'X', value: 'y' });
    assert.equal(byWifi.status, 409); assert.match(byWifi.body.error, /press "Receive"/);
    assert.equal((await secretsOf(B)).length, 0);
    await receive(B);
    assert.equal((await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'X', value: 'y' })).status, 200);
    await ui(B, 'POST', '/ui/secret/receive', { on: false });
    assert.equal((await ui(A, 'POST', '/ui/secret/wifi', { to: 'b', name: 'Z', value: 'y' })).status, 409, 'closing the window closes it');
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

    // Send the stored one by Wi-Fi: B must be receiving.
    const peerB = A.store.peers()[0].id;
    assert.equal((await ui(A, 'POST', '/ui/secrets/send', { id: mine.id, to: peerB })).status, 409, 'B is not receiving');
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
