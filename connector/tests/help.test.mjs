// 0.14 step 8: explanations from this device's own data (no AI), for the page and for agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';

test('explain: queued message, held and blocked requests, an offline device, a missing key, a card; agents never see held content', async () => {
  const A = await startDevice('Help A'), B = await startDevice('Help B');
  try {
    await pair(A, B);
    // Held and blocked requests, explained on A.
    await api(B, 'POST', '/api/send', { to: 'Help A', intent: 'crm.contact.read', args: { name: 'HELD-ARGS' } });
    await api(B, 'POST', '/api/send', { to: 'Help A', intent: 'system.command.execute', args: { command: 'x' } });
    const held = await waitFor(async () => (await ui(A, 'GET', '/ui/state')).body.needsMe.find(n => n.kind === 'request'));
    const ex = (await ui(A, 'GET', `/ui/explain?topic=request&ref=${held.id}`)).body;
    assert.match(ex.facts.join(' '), /crm\.contact\.read from Help B: pending/);
    assert.equal(ex.steps[0].action, 'openFirewall');
    assert.equal((await api(A, 'GET', `/api/help?topic=request&ref=${held.id}`)).status, 404, 'an agent can\'t look at what it may not see');

    // A key that isn't here.
    const k = (await api(A, 'GET', '/api/help?topic=key&ref=STRIPE_KEY')).body;
    assert.match(k.facts.join(' '), /doesn't have STRIPE_KEY/);
    assert.ok(k.steps.length);

    // A card.
    await ui(A, 'POST', '/ui/rooms', { name: 'R', members: ['Help B'] });
    const c = (await api(A, 'POST', '/api/send', { room: 'R', card: { type: 'task', title: 'T' } })).body;
    const cards = (await api(A, 'GET', '/api/cards?room=R')).body.cards;
    assert.match((await api(A, 'GET', `/api/help?topic=card&ref=${cards[0].id}`)).body.facts[0], /Claim it first/);
    assert.ok(c.sent);

    // B goes away: A's next message waits, and "Why?" says so, with Cancel.
    await B.stop();
    const q = (await api(A, 'POST', '/api/send', { to: 'Help B', text: 'are you there?' })).body;
    assert.equal(q.queued, true);
    const why = (await ui(A, 'GET', `/ui/explain?topic=message&ref=${q.id}`)).body;
    assert.match(why.facts[0], /could not be reached/);
    assert.ok(why.steps.some(s => s.action === 'cancelQueued'));
    const peer = (await ui(A, 'GET', '/ui/explain?topic=peer&ref=Help B')).body;
    assert.match(peer.facts.join(' '), /relay is off/);
    assert.equal((await ui(A, 'GET', '/ui/explain?topic=weather&ref=x')).status, 400);
  } finally { await A.stop(); await B.stop().catch(() => {}); }
});
