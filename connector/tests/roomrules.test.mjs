// 0.14 step 5: room rules for agents (pause, card types, rate, back-and-forth), page only, stricter only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';

test('room rules: pause, card types, posts per minute and agent posts in a row; only the page sets them', async () => {
  const A = await startDevice('Rules A'), B = await startDevice('Rules B');
  try {
    await pair(A, B);
    const room = (await ui(A, 'POST', '/ui/rooms', { name: 'Ops', members: ['Rules B'] })).body.room;
    assert.equal((await api(A, 'POST', '/ui/rooms/policy', { id: room.id, paused: true })).status >= 400, true, 'agents cannot change room rules');

    // Card types.
    assert.equal((await ui(A, 'POST', '/ui/rooms/policy', { id: room.id, agentCards: ['status'] })).status, 200);
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', card: { type: 'task', title: 'x' } })).status, 403);
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', card: { type: 'status', title: 'ok', level: 'ok' } })).status, 200);
    assert.equal((await ui(A, 'POST', '/ui/card', { room: room.id, card: { type: 'task', title: 'people may' } })).status, 200, 'rules are for agents only');

    // Agent posts in a row: after the limit, a person must post.
    assert.equal((await ui(A, 'POST', '/ui/rooms/policy', { id: room.id, maxAgentRun: 3, agentCards: ['task', 'status'] })).status, 200);
    await ui(A, 'POST', '/ui/send', { room: room.id, text: 'person here' });
    for (let i = 0; i < 3; i++) assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', text: `agent ${i}` })).status, 200);
    const stop = await api(A, 'POST', '/api/send', { room: 'Ops', text: 'one more' });
    assert.equal(stop.status, 429);
    assert.match(stop.body.error, /a person needs to post/);
    await ui(A, 'POST', '/ui/send', { room: room.id, text: 'go on' });
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', text: 'again' })).status, 200);

    // Rate per minute.
    assert.equal((await ui(A, 'POST', '/ui/rooms/policy', { id: room.id, postsPerMinute: 1, maxAgentRun: 50 })).status, 200);
    A.roomAgentPosts?.clear();
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', text: 'r1' })).status, 200);
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', text: 'r2' })).status, 429);

    // Pause on B: B's agents can't post, and A's agent posts don't reach B's agent (the person still sees them).
    const roomB = (await ui(B, 'GET', '/ui/state')).body.rooms.find(r => r.name === 'Ops');
    assert.equal((await ui(B, 'POST', '/ui/rooms/policy', { id: roomB.id, paused: true })).status, 200);
    assert.equal((await api(B, 'POST', '/api/send', { room: 'Ops', text: 'b agent' })).status, 403);
    await api(B, 'GET', '/api/inbox');                          // read what's there so far
    A.roomAgentPosts?.clear();
    assert.equal((await ui(A, 'POST', '/ui/rooms/policy', { id: room.id, postsPerMinute: 10 })).status, 200);
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Ops', text: 'AGENT-WHILE-PAUSED' })).status, 200);
    await new Promise(r => setTimeout(r, 300));
    assert.doesNotMatch(JSON.stringify((await api(B, 'GET', '/api/inbox')).body), /AGENT-WHILE-PAUSED/);
    const seen = (await ui(B, 'GET', `/ui/rooms/messages?id=${roomB.id}`)).body.messages;
    assert.ok(seen.some(m => m.text === 'AGENT-WHILE-PAUSED'), 'the person still sees it in the room');
    assert.equal((await api(B, 'GET', '/api/peers')).body.rooms[0].agentsPaused, true);
  } finally { await A.stop(); await B.stop(); }
});
