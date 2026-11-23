// Shared project rooms (0.13 step 4): a named group thread across paired devices, carried over the
// existing direct links (intent agent.room.post, through each member's firewall). Only the person
// creates a room; agents post in rooms that exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, ui, api, state, waitFor } from './helpers.mjs';

test('rooms: the person makes a room; posts reach every member, group together, and keep their firewall', { timeout: 90_000 }, async () => {
  const A = await startDevice('room-a'), B = await startDevice('room-b'), C = await startDevice('room-c');
  try {
    await pair(A, B); await pair(A, C); await pair(B, C);

    // Agents can't make rooms; a room needs a name and paired members.
    assert.notEqual((await api(A, 'POST', '/ui/rooms', { name: 'Launch', members: ['room-b'] })).status, 200);
    assert.equal((await ui(A, 'POST', '/ui/rooms', { name: ' ', members: ['room-b'] })).status, 400);
    assert.equal((await ui(A, 'POST', '/ui/rooms', { name: 'Launch', members: ['nobody'] })).status, 404);
    const made = await ui(A, 'POST', '/ui/rooms', { name: 'Launch', members: ['room-b', 'room-c'] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const room = made.body.room;
    assert.equal((await ui(A, 'POST', '/ui/rooms', { name: 'launch', members: ['room-b'] })).status, 409, 'names are unique');

    // An agent on A posts: one sealed message to each member.
    const post = await api(A, 'POST', '/api/send', { room: 'Launch', text: 'Build 42 is green, ready to ship?' });
    assert.equal(post.status, 200, JSON.stringify(post.body));
    assert.equal(post.body.sent, true); assert.equal(post.body.results.length, 2);
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Launch', text: 'x', intent: 'agent.question.ask', args: { question: 'q' } })).status, 400, 'a room post is plain text');
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Nope', text: 'x' })).status, 404);

    // B and C now know the room (made by A), with all three members.
    for (const [d, others] of [[B, ['room-a', 'room-c']], [C, ['room-a', 'room-b']]]) {
      const rooms = (await state(d)).rooms;
      assert.equal(rooms.length, 1); assert.equal(rooms[0].id, room.id); assert.equal(rooms[0].name, 'Launch');
      assert.deepEqual(rooms[0].members.map(m => m.name).sort(), others);
      const msgs = (await ui(d, 'GET', `/ui/rooms/messages?id=${room.id}`)).body.messages;
      assert.equal(msgs.length, 1); assert.equal(msgs[0].text, 'Build 42 is green, ready to ship?');
      // The agent there sees it in its inbox, with the room named.
      const inbox = (await api(d, 'GET', '/api/inbox')).body.messages;
      assert.equal(inbox[0].intent, 'agent.room.post'); assert.equal(inbox[0].args.name, 'Launch');
      // ...and the agent can list the room.
      assert.deepEqual((await api(d, 'GET', '/api/peers')).body.rooms.map(r => r.name), ['Launch']);
    }

    // B answers in the room: it reaches A and C. On A, the room shows both posts, A's own once.
    const back = await api(B, 'POST', '/api/send', { room: room.id, text: 'Yes from B' });
    assert.equal(back.body.results.filter(r => r.sent).length, 2);
    const onA = (await ui(A, 'GET', `/ui/rooms/messages?id=${room.id}`)).body.messages;
    assert.deepEqual(onA.map(m => m.text), ['Build 42 is green, ready to ship?', 'Yes from B']);
    assert.deepEqual(onA[0].to.sort(), ['room-b', 'room-c'], 'one post, sent to both');
    // Room posts stay out of the one-to-one conversations.
    assert.equal((await ui(A, 'GET', `/ui/messages?peer=${B.meId}`)).body.messages.filter(m => m.intent === 'agent.room.post').length, 0);

    // C blocks room posts from everyone: the firewall applies, and nothing reaches C's agent.
    assert.equal((await ui(C, 'POST', '/ui/firewall/rule', { scope: '*', intent: 'agent.room.post', decision: 'block' })).status, 200);
    await api(A, 'POST', '/api/send', { room: 'Launch', text: 'blocked at C' });
    const cInbox = (await api(C, 'GET', '/api/inbox?all=1')).body.messages;
    assert.ok(!cInbox.some(m => m.text === 'blocked at C'), 'blocked posts never reach the agent');

    // The person leaves the room on B: it's gone there, and the Activity log has it all.
    assert.equal((await ui(B, 'POST', '/ui/rooms/leave', { id: room.id })).status, 200);
    assert.equal((await state(B)).rooms.length, 0);
    const logA = (await ui(A, 'GET', '/ui/audit?category=rooms')).body.entries.map(e => e.type);
    assert.ok(logA.includes('room.created'));
    const logB = (await ui(B, 'GET', '/ui/audit?category=rooms')).body.entries.map(e => e.type);
    assert.ok(logB.includes('room.joined') && logB.includes('room.left'));
  } finally { await A.stop(); await B.stop(); await C.stop(); }
});
