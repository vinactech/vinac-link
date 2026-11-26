// 0.16 step 2: the team relay, against a local stand-in for Supabase (Realtime + REST). Two people on
// one team, each with their own account, their computers paired in person: when the direct link
// fails, sealed frames go through the TEAM channel. Never for computers whose owners share no team,
// never when the key differs from the team directory, never pairing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
const { startDevice, pair, ui, waitFor } = await import('./helpers.mjs');

test.after(() => mock.close());

async function signInLinkRelay(d, email) {
  assert.equal((await ui(d, 'POST', '/ui/account/start', { email })).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/verify', { code: mock.codes.get(email) })).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/link', {})).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/relay', { on: true })).status, 200);
}
function cutDirect(from, to) {
  const list = from.store.peers();
  const rec = list.find(p => p.id === to.meId);
  rec.address = '127.0.0.1:9'; rec.alt = [];
  from.store.savePeers(list);
  from.outSessions.clear();
}

test('team relay: teammates\' paired computers reach each other through their team channel only', { timeout: 60_000 }, async () => {
  const A = await startDevice('Ana PC'), B = await startDevice('Ben Mac'), S = await startDevice('Stranger');
  try {
    await pair(A, B); await pair(A, S);
    // Teams first, so the relay joins the team channel when it starts.
    await signInLinkRelay(A, 'ana@example.com'); await signInLinkRelay(B, 'ben@example.com'); await signInLinkRelay(S, 'stranger@example.com');
    const team = mock.addTeam('Shop team', ['ana@example.com', 'ben@example.com']);
    // The directory is read when the relay starts; ask again now that the team exists.
    for (const d of [A, B, S]) { d.teamRelay = null; await d.teamFingerprints(true); }
    await waitFor(() => A.relay?.teamJoins.has(`realtime:relay-team:${team.id}`) && B.relay?.teamJoins.has(`realtime:relay-team:${team.id}`));
    assert.ok(!S.relay.teamJoins.size, 'a stranger joins no team channel');

    cutDirect(A, B); cutDirect(B, A); cutDirect(A, S); cutDirect(S, A);
    const words = 'meet me at the blue door';
    const before = mock.relayed.length;
    const sent = await ui(A, 'POST', '/ui/send', { to: 'Ben Mac', text: words });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.sent.via, 'relay');
    assert.ok(B.store.messages().some(m => m.dir === 'in' && m.text === words && m.via === 'relay'));
    const frames = mock.relayed.slice(before);
    assert.ok(frames.length && frames.every(f => f.topic === `realtime:relay-team:${team.id}`), 'teammates use the team channel');
    assert.ok(!JSON.stringify(frames).includes('blue door'), 'the relay never sees the words');
    assert.ok(!frames.some(f => String(f.payload?.route || '').startsWith('/pair')), 'pairing never goes through it');

    // Paired in person, but no shared team: nothing goes through the relay to it (it waits on A instead).
    const toS = () => mock.relayed.filter(f => f.payload?.to === S.meId).length;
    const s = await ui(A, 'POST', '/ui/send', { to: 'Stranger', text: 'hi' });
    assert.equal(toS(), 0, 'no frame through the relay to a computer outside the team');
    assert.ok(s.status !== 200 || s.body.sent.queued, JSON.stringify(s.body));

    // A key in the directory that differs from the paired one: refused (and the directory flags it).
    const row = mock.devices.find(d => d.name === 'Ben Mac');
    const real = row.public_key; row.public_key = 'A'.repeat(43);
    A.teamRelay = null; await A.teamFingerprints(true);
    const toB = () => mock.relayed.filter(f => f.payload?.to === B.meId && f.event === 'req').length;
    const n = toB();
    const bad = await ui(A, 'POST', '/ui/send', { to: 'Ben Mac', text: 'should not go' });
    assert.equal(toB(), n, 'no frame through the relay when the key does not match the directory');
    assert.ok(bad.status !== 200 || bad.body.sent.queued, JSON.stringify(bad.body));
    row.public_key = real;
  } finally { await A.stop(); await B.stop(); await S.stop(); }
});
