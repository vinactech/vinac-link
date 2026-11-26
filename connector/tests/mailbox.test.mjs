// 0.16 step 4: the mailbox, against a local stand-in for Supabase. A teammate's computer that isn't
// connected gets the message later, sealed with the pairing key: the service never sees the words, the
// receiver puts it through its firewall like any message, and the item is deleted once collected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
process.env.VINAC_MAILBOX_MS = '3600000'; // the test collects by hand
const { startDevice, pair, ui, waitFor } = await import('./helpers.mjs');

test.after(() => mock.close());

async function account(d, email) {
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

test('mailbox: a teammate\'s computer that is off gets the message later, sealed, through its firewall', { timeout: 90_000 }, async () => {
  const A = await startDevice('Ana PC'), B = await startDevice('Ben Mac');
  try {
    await pair(A, B);
    await account(A, 'ana@mb.example'); await account(B, 'ben@mb.example');
    const team = mock.addTeam('Mail team', ['ana@mb.example', 'ben@mb.example']);
    for (const d of [A, B]) { d.teamRelay = null; await d.teamFingerprints(true); }
    await waitFor(() => A.relay?.teamJoins.has(`realtime:relay-team:${team.id}`));
    cutDirect(A, B); cutDirect(B, A);

    // Ben's computer leaves the relay (as if it were off); Ana sends a message and a request.
    B.relay.stop();
    const words = 'the orange cat naps on the server';
    const sent = await ui(A, 'POST', '/ui/send', { to: 'Ben Mac', text: words });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.sent.via, 'mailbox'); assert.equal(sent.body.sent.queued, true);
    assert.equal(mock.mailbox.length, 1);
    const item = mock.mailbox[0];
    assert.equal(item.to_device, B.meId); assert.equal(item.from_device, A.meId); assert.equal(item.team_id, team.id);
    assert.ok(!JSON.stringify(mock.mailbox).includes('orange cat'), 'the service never sees the words');

    // Ben's computer comes back and collects its mail: handled like a live message, then deleted.
    B.relay.start(); await waitFor(() => B.relay.ready());
    assert.equal(await B.checkMailbox(), 1);
    const got = B.store.messages().find(m => m.dir === 'in' && m.text === words);
    assert.ok(got); assert.equal(got.via, 'mailbox');
    assert.equal(mock.mailbox.length, 0, 'collected items are deleted');
    assert.equal(await B.checkMailbox(), 0);

    // The same item again (replayed by the service) is refused.
    mock.mailbox.push({ ...item, id: 'replayed-1' });
    assert.equal(await B.checkMailbox(), 0);
    assert.equal(B.store.messages().filter(m => m.text === words).length, 1, 'no duplicate');

    // Team projects: the person adds the teammate's computer to an existing project room (page only).
    const w = (await ui(A, 'POST', '/ui/projects/workspace', { name: 'Shop' })).body;
    assert.equal(w.room.members.length, 0);
    const { api } = await import('./helpers.mjs');
    assert.notEqual((await api(A, 'POST', '/ui/rooms/members', { id: w.room.id, add: [B.meId] })).status, 200, 'agents can\'t add members');
    assert.equal((await ui(A, 'POST', '/ui/rooms/members', { id: w.room.id, add: [B.meId] })).status, 200);
    assert.deepEqual((await ui(A, 'GET', `/ui/project?id=${w.project.id}`)).body.room.members, ['Ben Mac']);

    // An item changed by the service doesn't open.
    const bad = { ...item, id: 'tampered-1', sealed: item.sealed.slice(0, -4) + (item.sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    mock.mailbox.push(bad);
    assert.equal(await B.checkMailbox(), 0);
  } finally { await A.stop(); await B.stop(); }
});
