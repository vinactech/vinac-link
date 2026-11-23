// 0.14 step 2: cards in rooms and one-to-one conversations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';
import { checkCard, checkUpdate, cardStates } from '../src/cards.js';
import { LOGOS_VERSION, isIntent, catalog } from '../src/logos.js';

test('catalog: card intents appended at the end; version bumped', () => {
  assert.equal(LOGOS_VERSION, '0.6.0');
  const names = catalog().map(x => x.intent ?? x[0] ?? x.name);
  assert.ok(isIntent('agent.card.post') && isIntent('agent.card.update'));
  assert.equal(names.indexOf('agent.room.post'), 160, 'older ids never move');
});

test('card checks: types, decisions need 2-4 options, key requests carry a NAME only, links are http(s)', () => {
  assert.equal(checkCard({ type: 'task', title: '  Fix\nlogin  ' }, { newId: true }).title, 'Fix login');
  assert.throws(() => checkCard({ type: 'decision', title: 'Ship?', options: ['yes'] }, { newId: true }), /2 to 4/);
  assert.throws(() => checkCard({ type: 'key', name: 'sk-live 123' }, { newId: true }), /NAME/);
  assert.equal(checkCard({ type: 'key', name: 'RESEND_API_KEY', project: 'Website', env: 'dev' }, { newId: true }).title, 'Needs RESEND_API_KEY');
  assert.throws(() => checkCard({ type: 'link', title: 'x', url: 'javascript:alert(1)' }, { newId: true }), /http/);
  assert.throws(() => checkCard({ type: 'poll', title: 'x' }, { newId: true }));
  assert.throws(() => checkUpdate({ card: 'AAAAAAAAAAAA', action: 'delete' }));
});

test('card state: first claim wins; only a person answers a decision', () => {
  const card = { id: 'TTTTTTTTTTTT', type: 'task', title: 'T' };
  const dec = { id: 'DDDDDDDDDDDD', type: 'decision', title: 'D', options: ['a', 'b'] };
  const m = (id, dir, peer, at, args, by = 'agent') => ({ id, dir, peer: { id: peer, name: peer }, sentAt: at, args, by });
  const s = cardStates([
    m('1', 'out', 'me', '2026-01-01T00:00:00Z', { card }),
    m('2', 'out', 'me', '2026-01-01T00:00:00Z', { card: dec }),
    m('4', 'in', 'Mac', '2026-01-01T00:00:02Z', { cardUpdate: { card: card.id, action: 'claim' } }),
    m('3', 'in', 'Box', '2026-01-01T00:00:01Z', { cardUpdate: { card: card.id, action: 'claim' } }),
    m('5', 'in', 'Mac', '2026-01-01T00:00:03Z', { cardUpdate: { card: dec.id, action: 'answer', option: 'a' } }, 'agent'),
  ]);
  assert.equal(s.get(card.id).claimedBy, 'Box', 'earliest claim wins, whatever order they arrived in');
  assert.equal(s.get(dec.id).state, 'open', 'an agent\'s answer does not count');
});

test('cards in a room: task posted by an agent, claimed on another device, done; decision answered by a person only', async () => {
  const A = await startDevice('Card A'), B = await startDevice('Card B');
  try {
    await pair(A, B);
    assert.equal((await ui(A, 'POST', '/ui/rooms', { name: 'Launch', members: ['Card B'] })).status, 200);
    const r = await api(A, 'POST', '/api/send', { room: 'Launch', card: { type: 'task', title: 'Run the tests' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cardsB = async () => (await api(B, 'GET', '/api/cards?room=Launch')).body.cards;
    const task = (await waitFor(async () => (await cardsB()).find(c => c.type === 'task')));
    assert.equal(task.state, 'open');
    assert.equal(task.from, 'Card A');
    assert.equal((await api(B, 'POST', '/api/send', { room: 'Launch', cardUpdate: { card: task.id, action: 'claim' } })).status, 200);
    await waitFor(async () => (await api(A, 'GET', '/api/cards?room=Launch')).body.cards.find(c => c.id === task.id)?.claimedBy === 'Card B');
    assert.equal((await api(B, 'POST', '/api/send', { room: 'Launch', cardUpdate: { card: task.id, action: 'done' } })).status, 200);
    await waitFor(async () => (await api(A, 'GET', '/api/cards?room=Launch&open=1')).body.cards.length === 0);

    // A decision: agents may post it, but only the page (a person) answers it.
    const d = await api(A, 'POST', '/api/send', { room: 'Launch', card: { type: 'decision', title: 'Deploy today?', options: ['Yes', 'No'] } });
    assert.equal(d.status, 200);
    const dec = await waitFor(async () => (await cardsB()).find(c => c.type === 'decision'));
    const agentAnswer = await api(B, 'POST', '/api/send', { room: 'Launch', cardUpdate: { card: dec.id, action: 'answer', option: 'Yes' } });
    assert.equal(agentAnswer.status, 403);
    assert.equal((await ui(B, 'POST', '/ui/card', { room: 'Launch', cardUpdate: { card: dec.id, action: 'answer', option: 'Yes' } })).status, 200);
    const answered = await waitFor(async () => (await api(A, 'GET', '/api/cards?room=Launch')).body.cards.find(c => c.id === dec.id && c.state === 'answered'));
    assert.equal(answered.answer, 'Yes');

    // The room view on the page carries the cards too.
    const rooms = (await ui(A, 'GET', '/ui/state')).body.rooms;
    const view = (await ui(A, 'GET', `/ui/rooms/messages?id=${rooms[0].id}`)).body;
    assert.ok(view.cards.length >= 2 && view.messages.some(m => m.args?.card));
  } finally { await A.stop(); await B.stop(); }
});

test('cards one-to-one: a key request names the key only; values can never ride on a card', async () => {
  const A = await startDevice('Card C'), B = await startDevice('Card D');
  try {
    await pair(A, B);
    const r = await api(A, 'POST', '/api/send', { to: 'Card D', card: { type: 'key', name: 'SUPABASE_URL', project: 'Website', env: 'dev', value: 'sk_live_SHOULD_NOT_TRAVEL' } });
    assert.equal(r.status, 200);
    const got = await waitFor(async () => (await api(B, 'GET', '/api/cards?peer=Card C')).body.cards[0]);
    assert.equal(got.name, 'SUPABASE_URL');
    assert.equal(got.project, 'Website');
    assert.doesNotMatch(JSON.stringify((await api(B, 'GET', '/api/inbox?all=1')).body), /SHOULD_NOT_TRAVEL/);
    // A card on an unrelated intent is refused by the receiver's checks (sent as plain args here).
    const bad = await api(A, 'POST', '/api/send', { to: 'Card D', intent: 'agent.question.ask', args: { question: 'q', card: { type: 'task', title: 'x' } } });
    assert.equal(bad.status, 502);
  } finally { await A.stop(); await B.stop(); }
});
