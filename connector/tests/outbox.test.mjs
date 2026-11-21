import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, ui, api, pair, waitFor } from './helpers.mjs';

test('outbox: a message for an unreachable device waits, then goes out by itself when it is back', { timeout: 60_000 }, async () => {
  const A = await startDevice('Out A'), B = await startDevice('Out B');
  try {
    await pair(A, B);
    const list = A.store.peers(); const recB = list[0]; const real = recB.address;
    recB.address = '127.0.0.1:1'; recB.alt = []; A.store.savePeers(list);    // B looks gone

    const r = await api(A, 'POST', '/api/send', { to: 'Out B', intent: 'agent.question.ask', args: { question: 'still there?' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.sent, r.body.queued, r.body.delivered], [false, true, false]);
    assert.match(r.body.note, /sent automatically/);
    const second = await api(A, 'POST', '/api/send', { to: 'Out B', text: 'and this one' });
    assert.equal(second.body.queued, true);
    // Files are not queued: they fail as before.
    const file = await api(A, 'POST', '/api/send', { to: 'Out B', intent: 'document.file.share', args: { name: 'a.txt', base64: Buffer.from('hi').toString('base64') } });
    assert.equal(file.status, 502, JSON.stringify(file.body));

    // Age the first one past the other side's time window: the resend must still be accepted.
    const msgs = A.store.messages();
    msgs.find(m => m.id === r.body.id).outbox.inner.sentAt = new Date(Date.now() - 30 * 60_000).toISOString();
    A.store.saveMessages(msgs);

    // B is back at its address: the next check sends both, in order.
    const l2 = A.store.peers(); l2[0].address = real; A.store.savePeers(l2);
    await ui(A, 'POST', '/ui/ping');
    await waitFor(async () => A.store.messages().every(m => !m.outbox), 8000);
    const got = (await api(B, 'GET', '/api/inbox')).body.messages.map(m => m.text);
    assert.ok(got.some(t => /still there\?/.test(t)), JSON.stringify(got));
    assert.ok(got.includes('and this one'));
    assert.ok(got.findIndex(t => /still there\?/.test(t)) < got.indexOf('and this one'), 'oldest first');
    const sent = A.store.messages().find(m => m.id === r.body.id);
    assert.equal(sent.deliveredLate, true);
  } finally { await A.stop(); await B.stop(); }
});

test('outbox: waiting messages can be cancelled, and give up after 24 hours', { timeout: 60_000 }, async () => {
  const A = await startDevice('Exp A'), B = await startDevice('Exp B');
  try {
    await pair(A, B);
    const list = A.store.peers(); list[0].address = '127.0.0.1:1'; list[0].alt = []; A.store.savePeers(list);
    const one = (await api(A, 'POST', '/api/send', { to: 'Exp B', text: 'cancel me' })).body;
    const two = (await api(A, 'POST', '/api/send', { to: 'Exp B', text: 'too old' })).body;
    assert.equal((await ui(A, 'POST', '/ui/outbox/cancel', { id: one.id })).status, 200);
    assert.equal((await ui(A, 'POST', '/ui/outbox/cancel', { id: one.id })).status, 404);
    assert.equal((await api(A, 'POST', '/ui/outbox/cancel', { id: two.id })).status !== 200, true, 'the agent API cannot cancel');
    const msgs = A.store.messages();
    msgs.find(m => m.id === two.id).outbox.queuedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    A.store.saveMessages(msgs);
    A.expireOutbox();
    const after = A.store.messages();
    assert.match(after.find(m => m.id === one.id).undelivered, /Cancelled/);
    assert.match(after.find(m => m.id === two.id).undelivered, /24 hours/);
    assert.ok(after.every(m => !m.outbox));
  } finally { await A.stop(); await B.stop(); }
});
