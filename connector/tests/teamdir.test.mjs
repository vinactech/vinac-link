// 0.16 step 1: the team directory, against a local stand-in for Supabase. Teammates' linked
// computers, which of them this computer is paired with, and a loud flag when a paired computer's key
// differs from the one in the directory. Read only; agents can't reach it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
const { startDevice, pair, ui, api, state } = await import('./helpers.mjs');

test.after(() => mock.close());

async function signIn(d, email) {
  assert.equal((await ui(d, 'POST', '/ui/account/start', { email })).status, 200);
  const r = await ui(d, 'POST', '/ui/account/verify', { code: mock.codes.get(email) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await ui(d, 'POST', '/ui/account/link', {})).status, 200);
}

test('team directory: teammates\' computers, paired or not, key mismatch flagged, page only', { timeout: 30_000 }, async () => {
  const A = await startDevice('Ana PC'), B = await startDevice('Ben Mac'), C = await startDevice('Cy Laptop');
  try {
    await signIn(A, 'ana@example.com'); await signIn(B, 'ben@example.com'); await signIn(C, 'cy@example.com');
    mock.addTeam('Shop team', ['ana@example.com', 'ben@example.com']);
    mock.addTeam('Elsewhere', ['cy@example.com']);
    await pair(A, B);

    assert.notEqual((await api(A, 'GET', '/ui/account/team')).status, 200, 'agents can\'t read the directory');
    const r = await ui(A, 'GET', '/ui/account/team');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.teams.length, 1, 'only teams Ana is in');
    const [t] = r.body.teams;
    assert.equal(t.name, 'Shop team');
    const ana = t.members.find(m => m.email === 'ana@example.com'), ben = t.members.find(m => m.email === 'ben@example.com');
    assert.equal(ana.you, true); assert.equal(ben.you, false);
    assert.equal(ana.devices[0].thisDevice, true);
    assert.equal(ben.devices[0].name, 'Ben Mac');
    assert.equal(ben.devices[0].paired, true);
    assert.equal(ben.devices[0].fingerprint, (await state(B)).device.fingerprint);
    assert.equal(ben.devices[0].keyMismatch, undefined);
    assert.doesNotMatch(JSON.stringify(r.body), /cy@example|Cy Laptop/, 'nothing from teams Ana isn\'t in');

    // A computer whose directory key differs from the one this computer paired with is flagged.
    const row = mock.devices.find(d => d.name === 'Ben Mac');
    const real = row.public_key; row.public_key = 'A'.repeat(43);
    assert.equal((await ui(A, 'GET', '/ui/account/team')).body.teams[0].members.find(m => m.email === 'ben@example.com').devices[0].keyMismatch, true);
    row.public_key = real;

    // Cy isn't paired: listed as not paired from Cy's own (one-person) team view.
    const rc = (await ui(C, 'GET', '/ui/account/team')).body.teams[0];
    assert.deepEqual(rc.members.map(m => m.email), ['cy@example.com']);
  } finally { await A.stop(); await B.stop(); await C.stop(); }
});
