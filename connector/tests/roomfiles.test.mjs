// 0.14 step 4: files in rooms (posted once, fetched on request) and link cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';

const upload = async (d, query, bytes, { asAgent = false } = {}) => {
  const qs = new URLSearchParams(query).toString();
  const headers = asAgent ? { authorization: `Bearer ${d.apiToken}` } : { 'x-ui-token': d.uiToken };
  const r = await fetch(`http://127.0.0.1:${d.uiPort}${asAgent ? '/api/send-file' : '/ui/send-file'}?${qs}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: bytes });
  return { status: r.status, body: await r.json() };
};

test('room file: posted once as a card; a member presses Get, gets it straight from the poster, without a second approval', async () => {
  const A = await startDevice('File A'), B = await startDevice('File B'), C = await startDevice('File C');
  try {
    await pair(A, B); await pair(A, C);
    const room = (await ui(A, 'POST', '/ui/rooms', { name: 'Docs', members: ['File B'] })).body.room;
    const bytes = Buffer.from('# Launch plan\nShip on Friday.\n'.repeat(50));
    const r = await upload(A, { room: room.id, name: 'plan.md' }, bytes);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // B sees the card, not the file.
    const card = await waitFor(async () => (await api(B, 'GET', '/api/cards?room=Docs')).body.cards.find(c => c.type === 'file'));
    assert.deepEqual([card.name, card.size, card.localFile], ['plan.md', bytes.length, undefined]);
    assert.equal((await api(B, 'GET', '/api/files')).body.files.length, 0, 'nothing was sent yet');
    // B's person presses Get: A sends it to B only; B's firewall does not hold it.
    assert.equal((await ui(B, 'POST', '/ui/card/fetch', { card: card.id })).status, 200);
    const got = await waitFor(async () => (await api(B, 'GET', `/api/cards?room=Docs`)).body.cards.find(c => c.id === card.id && c.localFile));
    const f = (await api(B, 'GET', `/api/file?id=${got.localFile}`)).body;
    assert.match(f.text, /Ship on Friday/);
    // The poster's page can download its own copy too.
    const own = (await api(A, 'GET', '/api/cards?room=Docs')).body.cards.find(c => c.id === card.id);
    assert.ok(own.localFile);
    // A device outside the room can't get it (C is paired with A but not in Docs).
    await api(C, 'POST', '/api/send', { to: 'File A', cardUpdate: { card: card.id, action: 'want' } }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    assert.equal((await api(C, 'GET', '/api/files')).body.files.length, 0);
  } finally { await A.stop(); await B.stop(); await C.stop(); }
});

test('link cards: only http(s); shown as a card', async () => {
  const A = await startDevice('Link A'), B = await startDevice('Link B');
  try {
    await pair(A, B);
    await ui(A, 'POST', '/ui/rooms', { name: 'Refs', members: ['Link B'] });
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Refs', card: { type: 'link', title: 'Design', url: 'https://drive.google.com/x' } })).status, 200);
    assert.equal((await api(A, 'POST', '/api/send', { room: 'Refs', card: { type: 'link', title: 'Bad', url: 'file:///etc/passwd' } })).status, 400);
    const c = await waitFor(async () => (await api(B, 'GET', '/api/cards?room=Refs')).body.cards[0]);
    assert.equal(c.url, 'https://drive.google.com/x');
  } finally { await A.stop(); await B.stop(); }
});
