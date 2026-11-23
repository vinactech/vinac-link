// 0.14 step 3: keys grouped per project, the repo manifest, and key requests answered from a room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';
import { pickSecret, readManifest } from '../src/projects.js';

const tmpDir = name => fs.mkdtempSync(path.join(os.tmpdir(), `vinac-${name}-`));

test('pickSecret: the project\'s own key for the environment, else no-project; never another project\'s', () => {
  const items = [
    { name: 'SUPABASE_URL', id: 'a' },
    { name: 'SUPABASE_URL', id: 'b', project: 'P1', env: 'dev' },
    { name: 'SUPABASE_URL', id: 'c', project: 'P1', env: 'prod' },
    { name: 'RESEND', id: 'd', project: 'P2', env: 'dev' },
  ];
  assert.equal(pickSecret(items, 'SUPABASE_URL', { project: { id: 'P1' }, env: 'prod' }).id, 'c');
  assert.equal(pickSecret(items, 'SUPABASE_URL', { project: { id: 'P1' }, env: 'dev' }).id, 'b');
  assert.equal(pickSecret(items, 'SUPABASE_URL', { project: { id: 'P3' } }).id, 'a');
  assert.equal(pickSecret(items, 'SUPABASE_URL', {}).id, 'a');
  assert.equal(pickSecret(items, 'RESEND', { project: { id: 'P1' } }), null, 'another project\'s key is never used');
  assert.equal(pickSecret(items, 'RESEND', {}), null);
});

test('manifest: vinac.keys.json found from a subfolder; names only', () => {
  const root = tmpDir('manifest');
  fs.writeFileSync(path.join(root, 'vinac.keys.json'), JSON.stringify({ dev: ['SUPABASE_URL', 'bad name!'], prod: ['SUPABASE_URL', 'RESEND_API_KEY'] }));
  fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
  const m = readManifest(path.join(root, 'src', 'lib'));
  assert.deepEqual(m.dev, ['SUPABASE_URL']);
  assert.deepEqual(m.prod, ['SUPABASE_URL', 'RESEND_API_KEY']);
});

test('projects: agents see their project\'s key names; runs use the project\'s key; prod asks every time', async () => {
  const A = await startDevice('Proj A');
  const web = tmpDir('web'), other = tmpDir('other');
  try {
    fs.writeFileSync(path.join(web, 'vinac.keys.json'), JSON.stringify({ dev: ['SUPABASE_URL'], prod: ['SUPABASE_URL'] }));
    const p = (await ui(A, 'POST', '/ui/projects', { name: 'Website', folders: [web] })).body.project;
    const q = (await ui(A, 'POST', '/ui/projects', { name: 'Client', folders: [other] })).body.project;
    assert.equal((await api(A, 'POST', '/ui/projects', { name: 'X' })).status >= 400, true, 'agents cannot make projects');
    const add = async (name, value, project, env) => {
      const r = await ui(A, 'POST', '/ui/secrets/add', { name, value, project, env });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.added.id;
    };
    await add('SUPABASE_URL', 'https://web-dev', p.id, 'dev');
    await add('SUPABASE_URL', 'https://web-prod', p.id, 'prod');
    await add('CLIENT_TOKEN', 'client-secret-value', q.id, 'dev');

    const inWeb = (await api(A, 'GET', `/api/secrets?cwd=${encodeURIComponent(web)}`)).body;
    assert.equal(inWeb.project, 'Website');
    assert.deepEqual(inWeb.secrets.map(s => s.name).sort(), ['SUPABASE_URL', 'SUPABASE_URL']);
    assert.doesNotMatch(JSON.stringify(inWeb), /CLIENT_TOKEN|web-dev|client-secret/);

    const check = (await api(A, 'GET', `/api/keys/check?cwd=${encodeURIComponent(path.join(web))}&env=dev`)).body;
    assert.deepEqual([check.project, check.missing, check.have], ['Website', [], ['SUPABASE_URL']]);
    const checkOther = (await api(A, 'GET', `/api/keys/check?cwd=${encodeURIComponent(other)}&env=dev`)).body;
    assert.equal(checkOther.manifest, null);

    // A run in the Website folder with dev gets the dev value (the person approves it).
    const ask = (await api(A, 'POST', '/api/secret-use', { names: ['SUPABASE_URL'], command: ['node', '-v'], cwd: web, env: 'dev' })).body;
    assert.equal(ask.status, 'pending');
    assert.equal((await ui(A, 'POST', '/ui/secret-use/decide', { id: ask.id, approve: true })).status, 200);
    assert.equal((await api(A, 'GET', `/api/secret-use?id=${ask.id}`)).body.values.SUPABASE_URL, 'https://web-dev');
    // In the other project's folder, Website's key doesn't exist.
    assert.equal((await api(A, 'POST', '/api/secret-use', { names: ['SUPABASE_URL'], command: ['node', '-v'], cwd: other })).status, 404);
    // prod: even an "allow for 8 hours" grant does not skip the person.
    const p1 = (await api(A, 'POST', '/api/secret-use', { names: ['SUPABASE_URL'], command: ['node', '-v'], cwd: web, env: 'prod' })).body;
    assert.equal((await ui(A, 'POST', '/ui/secret-use/decide', { id: p1.id, approve: true, allowHours: 8 })).status, 400, 'no standing grant for prod');
    assert.equal((await ui(A, 'POST', '/ui/secret-use/decide', { id: p1.id, approve: true })).status, 200);
    assert.equal((await api(A, 'GET', `/api/secret-use?id=${p1.id}`)).body.values.SUPABASE_URL, 'https://web-prod');
    const p2 = (await api(A, 'POST', '/api/secret-use', { names: ['SUPABASE_URL'], command: ['node', '-v'], cwd: web, env: 'prod' })).body;
    assert.equal(p2.status, 'pending', 'prod keys ask every time');
    const d2 = (await api(A, 'POST', '/api/secret-use', { names: ['SUPABASE_URL'], command: ['node', '-v'], cwd: web, env: 'dev' })).body;
    assert.equal(d2.status, 'pending', 'no grant was made for dev');
  } finally { await A.stop(); }
});

test('key request card in a project room: the person on the device with the key presses Send; it lands in the same project', async () => {
  const A = await startDevice('Key A'), B = await startDevice('Key B');
  try {
    await pair(A, B);
    // Both computers have a "Website" project; B's room is linked to it.
    const pa = (await ui(A, 'POST', '/ui/projects', { name: 'Website', folders: [] })).body.project;
    const pb = (await ui(B, 'POST', '/ui/projects', { name: 'Website', folders: [] })).body.project;
    const id = (await ui(A, 'POST', '/ui/secrets/add', { name: 'RESEND_API_KEY', value: 're_test_value_123' })).body.added.id;
    await ui(A, 'POST', '/ui/secrets/assign', { id, project: pa.id, env: 'dev' });
    const room = (await ui(B, 'POST', '/ui/rooms', { name: 'Site', members: ['Key A'] })).body.room;
    assert.equal((await ui(B, 'POST', '/ui/rooms/project', { id: room.id, project: pb.id })).status, 200);
    // B's person asks in the room (the project is filled in from the room).
    assert.equal((await ui(B, 'POST', '/ui/card', { room: room.id, card: { type: 'key', name: 'RESEND_API_KEY' } })).status, 200);
    const card = await waitFor(async () => (await api(A, 'GET', '/api/cards?room=Site')).body.cards.find(c => c.type === 'key'));
    assert.deepEqual([card.project, card.env], ['Website', 'dev']);
    // An agent can't send keys.
    assert.equal((await api(A, 'POST', '/ui/card/send-key', { card: card.id })).status >= 400, true);
    const r = await ui(A, 'POST', '/ui/card/send-key', { card: card.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const got = await waitFor(async () => (await ui(B, 'GET', '/ui/state')).body.secrets.find(s => s.name === 'RESEND_API_KEY'));
    assert.equal(got.project, 'Website');
    assert.equal(got.offered, false, 'a person asked, so it is accepted');
    await waitFor(async () => (await api(B, 'GET', '/api/cards?room=Site')).body.cards.find(c => c.id === card.id)?.state === 'done');
    assert.doesNotMatch(JSON.stringify((await ui(B, 'GET', `/ui/rooms/messages?id=${room.id}`)).body), /re_test_value_123/, 'the value never goes to the room');
  } finally { await A.stop(); await B.stop(); }
});
