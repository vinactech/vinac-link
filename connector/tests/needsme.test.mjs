// 0.14 step 7: many rooms (pin, mute, archive, mentions), "Needs me", and the agent digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';
import { newLines } from '../src/hooks.js';

test('rooms: pin, mute and archive are the page\'s; an archived room comes back with a new post; a muted room makes no notification', async () => {
  const A = await startDevice('Many A'), B = await startDevice('Many B');
  const shown = [];
  A.notifier.enabled = true; A.notifier.show = n => shown.push(n); A.notifier.gapMs = 0;
  try {
    await pair(A, B);
    const room = (await ui(A, 'POST', '/ui/rooms', { name: 'Quiet', members: ['Many B'] })).body.room;
    await ui(A, 'POST', '/ui/send', { room: room.id, text: 'hello' });
    await waitFor(async () => (await api(B, 'GET', '/api/peers')).body.rooms.length === 1);
    assert.equal((await api(A, 'POST', '/ui/rooms/prefs', { id: room.id, muted: true })).status >= 400, true);
    assert.equal((await ui(A, 'POST', '/ui/rooms/prefs', { id: room.id, muted: true, pinned: true, archived: true })).status, 200);
    let r = (await ui(A, 'GET', '/ui/state')).body.rooms[0];
    assert.deepEqual([r.muted, r.pinned, r.archived], [true, true, true]);
    await api(B, 'POST', '/api/send', { room: 'Quiet', text: 'a post' });
    r = await waitFor(async () => { const x = (await ui(A, 'GET', '/ui/state')).body.rooms[0]; return x.archived ? null : x; });
    assert.equal(r.muted, true, 'still muted');
    await new Promise(res => setTimeout(res, 200));
    assert.equal(shown.length, 0, 'muted: no desktop notification');
    // A mention gets through even in a muted room.
    await api(B, 'POST', '/api/send', { room: 'Quiet', text: 'please check this @Many A' });
    await waitFor(() => shown.length === 1);
    assert.equal((await ui(A, 'GET', '/ui/state')).body.rooms[0].mentions, 1);
  } finally { await A.stop(); await B.stop(); }
});

test('Needs me: held requests, open decisions, key requests and tasks from other devices, with where they are', async () => {
  const A = await startDevice('Need A'), B = await startDevice('Need B');
  try {
    await pair(A, B);
    const room = (await ui(A, 'POST', '/ui/rooms', { name: 'Proj', members: ['Need B'] })).body.room;
    await ui(A, 'POST', '/ui/send', { room: room.id, text: 'start' });
    await waitFor(async () => (await api(B, 'GET', '/api/peers')).body.rooms.length === 1);
    await api(B, 'POST', '/api/send', { room: 'Proj', card: { type: 'decision', title: 'Ship?', options: ['Yes', 'No'] } });
    await api(B, 'POST', '/api/send', { room: 'Proj', card: { type: 'key', name: 'STRIPE_KEY' } });
    await api(B, 'POST', '/api/send', { room: 'Proj', card: { type: 'task', title: 'Write release notes' } });
    await api(B, 'POST', '/api/send', { to: 'Need A', intent: 'crm.contact.read', args: { name: 'x' } });
    const needs = await waitFor(async () => { const n = (await ui(A, 'GET', '/ui/state')).body.needsMe; return n.length >= 4 ? n : null; });
    const kinds = needs.map(n => n.kind).sort();
    assert.deepEqual(kinds, ['decision', 'key', 'request', 'task']);
    assert.equal(needs.find(n => n.kind === 'decision').room, 'Proj');
    // Answering the decision on the page takes it off the list.
    const d = needs.find(n => n.kind === 'decision');
    assert.equal((await ui(A, 'POST', '/ui/card', { room: d.roomId, cardUpdate: { card: d.card, action: 'answer', option: 'Yes' } })).status, 200);
    assert.equal((await ui(A, 'GET', '/ui/state')).body.needsMe.some(n => n.kind === 'decision'), false);
  } finally { await A.stop(); await B.stop(); }
});

test('agent digest: more than 3 new items become one line per room or device', () => {
  const st = { seen: [], waiting: 0 };
  const unread = [1, 2, 3].map(i => ({ id: `r${i}xxxxxxxxxx`, peer: { name: 'Mac' }, intent: 'agent.room.post', room: 'Launch' })).concat([{ id: 'd1xxxxxxxxxxx', peer: { name: 'Build' }, intent: null }]);
  const lines = newLines({ unread, waitingForPerson: 0 }, st);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /4 new items: 3 from room "Launch", 1 from "Build"/);
});
