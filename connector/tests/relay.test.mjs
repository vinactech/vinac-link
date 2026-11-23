// Relay (0.13 step 2), against the local Supabase stand-in (Realtime included): when a paired device
// can't be reached directly, the same sealed frames go through the account's private channel. Only for
// devices paired in person AND linked to the same account; off until the person turns it on (page
// only); the stand-in never sees a message's words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
const { startDevice, pair, ui, api, state, waitFor } = await import('./helpers.mjs');

test.after(() => mock.close());

async function signIn(d, email) {
  assert.equal((await ui(d, 'POST', '/ui/account/start', { email })).status, 200);
  const r = await ui(d, 'POST', '/ui/account/verify', { code: mock.codes.get(email) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

/** Breaks the direct route between two paired devices (as if they were on different networks). */
function cutDirect(from, to) {
  const list = from.store.peers();
  const rec = list.find(p => p.id === to.meId);
  rec.address = '127.0.0.1:9'; rec.alt = [];
  from.store.savePeers(list);
  from.outSessions.clear();
}

test('relay: a paired device on the same account is reached through the relay when the direct link fails', { timeout: 60_000 }, async () => {
  const A = await startDevice('relay-a'), B = await startDevice('relay-b');
  try {
    await pair(A, B);
    await signIn(A, 'relay@example.com'); await signIn(B, 'relay@example.com');

    // Off by default; can't be turned on before the computer is linked; agents can't turn it on.
    assert.equal((await ui(A, 'GET', '/ui/account')).body.account.relay, false);
    assert.equal((await ui(A, 'POST', '/ui/account/relay', { on: true })).status, 409);
    assert.notEqual((await api(A, 'POST', '/ui/account/relay', { on: true })).status, 200);
    assert.equal(mock.relayClients(), 0, 'nothing joins the relay before the person turns it on');

    for (const d of [A, B]) {
      assert.equal((await ui(d, 'POST', '/ui/account/link', {})).status, 200);
      const r = await ui(d, 'POST', '/ui/account/relay', { on: true });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.account.relay, true);
    }
    await waitFor(async () => (await ui(A, 'GET', '/ui/account')).body.account.relayStatus.state === 'connected' && (await ui(B, 'GET', '/ui/account')).body.account.relayStatus.state === 'connected');
    assert.equal(mock.joinsRefused.length, 0);

    // Directly first: nothing crosses the relay while the direct link works.
    const direct = await ui(A, 'POST', '/ui/send', { to: 'relay-b', text: 'hello directly' });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.equal(direct.body.sent.via, undefined);
    assert.equal(mock.relayed.length, 0);

    // Different networks now: A's message goes through the relay, sealed.
    cutDirect(A, B); cutDirect(B, A);
    const words = 'the purple elephant sings at noon';
    const sent = await ui(A, 'POST', '/ui/send', { to: 'relay-b', text: words });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.sent.delivered, true); assert.equal(sent.body.sent.via, 'relay');
    const got = B.store.messages().find(m => m.dir === 'in' && m.text === words);
    assert.ok(got, 'B received it'); assert.equal(got.via, 'relay');
    assert.ok(mock.relayed.length > 0);
    const wire = JSON.stringify(mock.relayed);
    assert.ok(!wire.includes('purple elephant'), 'the relay never sees the words');
    assert.ok(mock.relayed.every(f => ['req', 'res'].includes(f.event)));
    assert.ok(!mock.relayed.some(f => String(f.payload?.route || '').startsWith('/pair')), 'pairing never goes through the relay');

    // And back: B answers through the relay too; requests keep their firewall.
    const back = await ui(B, 'POST', '/ui/send', { to: 'relay-a', text: 'got it' });
    assert.equal(back.body.sent.via, 'relay');
    const req = await api(B, 'POST', '/api/send', { to: 'relay-a', intent: 'crm.contact.read', args: { query: 'x' } });
    assert.equal(req.status, 200, JSON.stringify(req.body));
    const fw = A.store.messages().find(m => m.dir === 'in' && m.intent === 'crm.contact.read');
    assert.ok(fw?.firewall, 'the firewall decided it, as on the network');

    // Too big for the relay: a clear answer, not a silent drop.
    await assert.rejects(A.relay.request(B.meId, '/msg', { from: A.meId, ct: 'a'.repeat(300_000) }), e => e.status === 413 && /Too big for the relay/.test(e.message));

    // The Activity log says it went through the relay.
    const log = (await ui(A, 'GET', '/ui/audit?category=account')).body.entries.map(e => e.type);
    assert.ok(log.includes('account.relay_on'));

    // B unlinked from the account: A no longer uses the relay for it (the message waits instead).
    assert.equal((await ui(B, 'POST', '/ui/account/unlink', {})).status, 200);
    assert.equal((await ui(B, 'GET', '/ui/account')).body.account.relay, false, 'unlinking turns the relay off');
    A.relayFps = null;
    const waits = await ui(A, 'POST', '/ui/send', { to: 'relay-b', text: 'are you there?' });
    assert.equal(waits.status, 200); assert.equal(waits.body.sent.queued, true);
  } finally { await A.stop(); await B.stop(); }
});

test('relay: a device on another account is never reached through it', { timeout: 60_000 }, async () => {
  const A = await startDevice('relay-c'), B = await startDevice('relay-d');
  try {
    await pair(A, B);
    await signIn(A, 'one@example.com'); await signIn(B, 'two@example.com');
    for (const d of [A, B]) { await ui(d, 'POST', '/ui/account/link', {}); await ui(d, 'POST', '/ui/account/relay', { on: true }); }
    await waitFor(async () => (await ui(A, 'GET', '/ui/account')).body.account.relayStatus.state === 'connected');
    cutDirect(A, B);
    const before = mock.relayed.length;
    const r = await ui(A, 'POST', '/ui/send', { to: 'relay-d', text: 'not for the relay' });
    assert.equal(r.status, 200); assert.equal(r.body.sent.queued, true);
    assert.equal(mock.relayed.length, before, 'nothing was sent on the relay for a device on another account');
  } finally { await A.stop(); await B.stop(); }
});
