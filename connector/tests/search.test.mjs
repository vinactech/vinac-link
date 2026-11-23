// 0.14 step 6: local search across conversations, rooms, cards, files and key names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';

test('search: words across messages, room posts and cards; filters; agents only see what they may read; key names never values', async () => {
  const A = await startDevice('Search A'), B = await startDevice('Search B');
  try {
    await pair(A, B);
    const room = (await ui(A, 'POST', '/ui/rooms', { name: 'Launch', members: ['Search B'] })).body.room;
    await ui(A, 'POST', '/ui/send', { room: room.id, text: 'Kickoff' }); // B learns the room from its first post
    await waitFor(async () => (await api(B, 'GET', '/api/peers')).body.rooms.length === 1);
    await api(B, 'POST', '/api/send', { to: 'Search A', text: 'The deploy script needs the staging URL' });
    await api(B, 'POST', '/api/send', { room: 'Launch', text: 'Deploy window is Friday afternoon' });
    await api(B, 'POST', '/api/send', { room: 'Launch', card: { type: 'task', title: 'Check deploy logs' } });
    // A request still waiting for the person: the agent can't find it, the page can.
    await api(B, 'POST', '/api/send', { to: 'Search A', intent: 'crm.contact.read', args: { name: 'x' }, text: 'HELD deploy note' });
    await ui(A, 'POST', '/ui/secrets/add', { name: 'DEPLOY_TOKEN', value: 'tok_should_never_show' });
    await waitFor(async () => (await api(A, 'GET', '/api/search?q=deploy')).body.results.length >= 3);

    const agent = (await api(A, 'GET', '/api/search?q=deploy')).body;
    const kinds = agent.results.map(r => r.kind).sort();
    assert.deepEqual(kinds, ['message', 'room', 'secret', 'task']);
    assert.doesNotMatch(JSON.stringify(agent), /HELD deploy note|tok_should_never_show/);
    assert.ok(agent.results.find(r => r.kind === 'task').card.title === 'Check deploy logs');

    const page = (await ui(A, 'GET', '/ui/search?q=deploy')).body;
    assert.ok(page.results.some(r => r.text === 'HELD deploy note'), 'the person can find held items');

    assert.equal((await api(A, 'GET', '/api/search?q=deploy&room=Launch')).body.results.length, 2);
    assert.deepEqual((await api(A, 'GET', '/api/search?q=deploy&kind=task')).body.results.map(r => r.kind), ['task']);
    assert.equal((await api(A, 'GET', '/api/search?q=friday%20deploy')).body.results.length, 1, 'all words must match');
    assert.equal((await api(A, 'GET', '/api/search')).status, 400);
  } finally { await A.stop(); await B.stop(); }
});
