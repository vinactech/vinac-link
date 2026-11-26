// 0.16 step 3: pairing with a teammate's computer over the internet, against a local stand-in for
// Supabase. One person sends a request, the other accepts it, the Noise pairing runs over the team
// channel, both screens show the same 6 digits and both people press Allow. Agents can't do any of it;
// a computer outside the team can't; a key that differs from the team directory stops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
const { startDevice, ui, api, state, waitFor } = await import('./helpers.mjs');

test.after(() => mock.close());

async function account(d, email) {
  assert.equal((await ui(d, 'POST', '/ui/account/start', { email })).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/verify', { code: mock.codes.get(email) })).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/link', {})).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/relay', { on: true })).status, 200);
}
async function joined(d, team) {
  d.teamRelay = null; await d.teamFingerprints(true);
  await waitFor(() => d.relay?.teamJoins.has(`realtime:relay-team:${team.id}`));
}

test('pair with a teammate over the internet: request, accept, 6 digits on both, Allow on both', { timeout: 60_000 }, async () => {
  const A = await startDevice('Ana PC'), B = await startDevice('Ben Mac'), S = await startDevice('Stranger');
  try {
    await account(A, 'ana@t.example'); await account(B, 'ben@t.example'); await account(S, 'sam@t.example');
    const team = mock.addTeam('Shop team', ['ana@t.example', 'ben@t.example']);
    await joined(A, team); await joined(B, team);
    const bFp = (await state(B)).device.fingerprint, aFp = (await state(A)).device.fingerprint;

    // Agents can't start, accept or ignore it; a stranger isn't a teammate.
    assert.notEqual((await api(A, 'POST', '/ui/team/pair', { fingerprint: bFp })).status, 200);
    S.teamRelay = null; await S.teamFingerprints(true);
    assert.equal((await ui(S, 'POST', '/ui/team/pair', { fingerprint: bFp })).status, 404, 'not a teammate\'s computer');

    // Ana sends the request; Ben sees it (Account list and Needs me), nothing starts by itself.
    const r = await ui(A, 'POST', '/ui/team/pair', { fingerprint: bFp });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pairing.state, 'announcing'); assert.equal(r.body.pairing.team.name, 'Ben Mac');
    await waitFor(async () => (await ui(B, 'GET', '/ui/account/team')).body.offers?.length === 1);
    const need = (await state(B)).needsMe.find(n => n.kind === 'pairOffer');
    assert.ok(need); assert.match(need.title, /ana@t\.example wants to pair Ana PC/);
    assert.equal((await state(B)).pairing?.state ?? 'none', 'none', 'nothing starts before Ben accepts');
    assert.notEqual((await api(B, 'POST', '/ui/team/pair/accept', { from: need.from })).status, 200, 'agents can\'t accept');

    // Ben accepts: both reach the 6 digits, the same on both screens; no auto-confirm.
    assert.equal((await ui(B, 'POST', '/ui/team/pair/accept', { from: need.from })).status, 200);
    try { await waitFor(async () => (await state(A)).pairing?.state === 'comparing' && (await state(B)).pairing?.state === 'comparing', 15_000); }
    catch (e) { throw new Error(`not comparing: A=${JSON.stringify((await state(A)).pairing)} B=${JSON.stringify((await state(B)).pairing)} frames=${JSON.stringify(mock.relayed.filter(f => String(f.payload?.route || f.payload?.body?.error || '').length).slice(-6).map(f => [f.event, f.payload?.route, f.payload?.status, f.payload?.body?.error]))}`); }
    const pa = (await state(A)).pairing, pb = (await state(B)).pairing;
    assert.equal(pa.matchCode, pb.matchCode); assert.match(pa.matchCode, /^\d{6}$/);
    assert.equal(pa.confirmedHere, false); assert.equal(pb.confirmedHere, false);
    assert.equal(pa.peer.fingerprint, bFp); assert.equal(pb.peer.fingerprint, aFp);
    assert.equal((await ui(A, 'POST', '/ui/confirm', { match: true })).status, 200);
    assert.equal((await ui(B, 'POST', '/ui/confirm', { match: true })).status, 200);
    await waitFor(async () => (await state(A)).pairing?.state === 'paired' && (await state(B)).pairing?.state === 'paired', 15_000);
    const peerB = A.store.peers().find(p => p.fingerprint === bFp);
    assert.equal(peerB.via, 'team');

    // Everything went over the team channel; pairing frames never on an account channel.
    const pairFrames = mock.relayed.filter(f => String(f.payload?.route || '').startsWith('/pair'));
    assert.ok(pairFrames.length >= 4);
    assert.ok(pairFrames.every(f => f.topic === `realtime:relay-team:${team.id}`));

    // And now they talk through the relay (no network address known for each other).
    const sent = await ui(A, 'POST', '/ui/send', { to: 'Ben Mac', text: 'hello across the internet' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body)); assert.equal(sent.body.sent.via, 'relay');
    assert.ok(B.store.messages().some(m => m.dir === 'in' && m.text === 'hello across the internet'));
  } finally { await A.stop(); await B.stop(); await S.stop(); }
});

test('pair with a teammate: a key that differs from the team directory stops it', { timeout: 60_000 }, async () => {
  const A = await startDevice('Ann PC'), B = await startDevice('Bo Mac');
  try {
    await account(A, 'ann@t.example'); await account(B, 'bo@t.example');
    const team = mock.addTeam('Team two', ['ann@t.example', 'bo@t.example']);
    await joined(A, team); await joined(B, team);
    const bFp = (await state(B)).device.fingerprint;
    assert.equal((await ui(A, 'POST', '/ui/team/pair', { fingerprint: bFp })).status, 200);
    await waitFor(async () => (await ui(B, 'GET', '/ui/account/team')).body.offers?.length === 1);
    // Someone swapped Ann's key in the directory (the service or an attacker): Bo's computer refuses.
    const rowA = mock.devices.find(d => d.name === 'Ann PC'); rowA.public_key = 'B'.repeat(43);
    B.teamRelay = null;
    const from = (await state(B)).needsMe.find(n => n.kind === 'pairOffer').from;
    assert.equal((await ui(B, 'POST', '/ui/team/pair/accept', { from })).status, 200);
    await waitFor(async () => (await state(B)).pairing?.state === 'failed', 15_000);
    assert.match((await state(B)).pairing.message, /doesn't match your team's directory/);
    assert.equal(B.store.peers().length, 0); assert.equal(A.store.peers().length, 0);
  } finally { await A.stop(); await B.stop(); }
});
