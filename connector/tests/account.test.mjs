// Optional account (0.13 step 1), against a local stand-in for Supabase: sign in with an email code,
// link this computer, refresh, unlink, sign out. Only the page can do any of it; nothing is sent
// before the person acts; what is sent is the computer's name, fingerprint, public key, platform and
// version, never messages, secrets or the audit log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
const { startDevice, ui, api, state, waitFor } = await import('./helpers.mjs');
const { verify } = await import('../src/crypto.js');

test.after(() => mock.close());

test('account: sign in with an email code, link this computer, refresh, unlink, sign out (page only)', { timeout: 30_000 }, async () => {
  const A = await startDevice('acct-a');
  try {
    assert.equal(mock.requests.length, 0, 'nothing is sent to the account service before the person acts');
    assert.equal((await ui(A, 'GET', '/ui/account')).body.account.signedIn, false);
    // Agents can't reach any of it.
    for (const p of ['/ui/account/start', '/ui/account/verify', '/ui/account/link', '/ui/account/signout']) assert.notEqual((await api(A, 'POST', p, { email: 'x@example.com' })).status, 200, p);
    assert.equal((await api(A, 'POST', '/api/account/start', { email: 'x@example.com' })).status, 404, 'no agent API for accounts');

    assert.equal((await ui(A, 'POST', '/ui/account/start', { email: 'not an email' })).status, 400);
    const started = await ui(A, 'POST', '/ui/account/start', { email: 'Person@Example.com' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.account.pendingEmail, 'person@example.com');
    const wrong = await ui(A, 'POST', '/ui/account/verify', { code: '00000000' });
    assert.equal(wrong.status, 400); assert.match(wrong.body.error, /wrong or has expired/);
    // A wrong code consumes nothing in the stand-in; the right one signs in.
    const ok = await ui(A, 'POST', '/ui/account/verify', { code: mock.codes.get('person@example.com') });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.account.signedIn, true); assert.equal(ok.body.account.email, 'person@example.com');
    assert.equal((await ui(A, 'POST', '/ui/account/start', { email: 'other@example.com' })).status, 409, 'sign out first');
    const saved = fs.readFileSync(path.join(A.homeDir, 'account.json'), 'utf8');
    assert.ok(!/acc_|ref_/.test(saved) || JSON.parse(saved).keystore === 'file', 'tokens are kept by the key store, not in plain');
    assert.ok(!/acc_/.test(saved), 'the access token is never written to disk');

    // Link: exactly the computer's public facts.
    const linked = await ui(A, 'POST', '/ui/account/link', {});
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.equal(linked.body.account.linked, true);
    const s = await state(A);
    assert.equal(mock.devices.length, 1);
    const row = mock.devices[0];
    assert.deepEqual(Object.keys(row).filter(k => !['id', 'linked_at'].includes(k)).sort(), ['app_version', 'fingerprint', 'last_seen_at', 'name', 'platform', 'public_key', 'user_id']);
    assert.equal(row.fingerprint, s.device.fingerprint); assert.equal(row.name, 'acct-a');
    assert.match(row.public_key, /^[A-Za-z0-9_-]{43}$/);
    // Linking twice updates the same row.
    await ui(A, 'POST', '/ui/account/link', {});
    assert.equal(mock.devices.length, 1);

    // An expired access token is refreshed on the next call, with no sign-in needed.
    mock.expireAccessTokens(); A.cloud.session = null;
    const list = await ui(A, 'GET', '/ui/account/devices');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.devices.length, 1);

    // Nothing but auth and the devices table was ever called, and no secret, message or log went out.
    assert.ok(mock.requests.every(r => /^\/(auth\/v1\/(otp|verify|token|logout)|rest\/v1\/devices)/.test(r.path)), JSON.stringify(mock.requests.map(r => r.path)));

    const un = await ui(A, 'POST', '/ui/account/unlink', {});
    assert.equal(un.body.account.linked, false); assert.equal(mock.devices.length, 0);
    const out = await ui(A, 'POST', '/ui/account/signout', {});
    assert.equal(out.body.account.signedIn, false);
    assert.ok(!fs.existsSync(path.join(A.homeDir, 'account.json')));
    assert.ok(mock.requests.some(r => r.path.startsWith('/auth/v1/logout')));

    // Every step is in the Activity log, by the person, under Account.
    const log = (await ui(A, 'GET', '/ui/audit?category=account')).body.entries.map(e => e.type);
    for (const t of ['account.signed_in', 'account.linked', 'account.unlinked', 'account.signed_out']) assert.ok(log.includes(t), t);
  } finally { await A.stop(); }
});

test('account: "last seen" while linked, and a signed monthly summary shared with a team (counts only, page only)', { timeout: 30_000 }, async () => {
  const A = await startDevice('acct-team');
  try {
    await ui(A, 'POST', '/ui/account/start', { email: 'team@example.com' });
    await ui(A, 'POST', '/ui/account/verify', { code: mock.codes.get('team@example.com') });
    await ui(A, 'POST', '/ui/account/link', {});
    await waitFor(() => mock.requests.some(r => r.method === 'PATCH' && r.path.startsWith('/rest/v1/devices')));
    const touch = mock.requests.find(r => r.method === 'PATCH');
    assert.deepEqual(Object.keys(touch.body).sort(), ['app_version', 'last_seen_at', 'name'], 'last seen sends only that');

    // Something to count, with words that must never leave this computer.
    await ui(A, 'POST', '/ui/agents/add', { name: 'Builder' });
    const team = mock.addTeam('Ops', ['team@example.com']);
    const other = mock.addTeam('Not mine', ['person@example.com']);
    const teams = (await ui(A, 'GET', '/ui/account/teams')).body.teams;
    assert.deepEqual(teams, [{ id: team.id, name: 'Ops', role: 'owner' }]);
    const period = new Date().toISOString().slice(0, 7);
    assert.notEqual((await api(A, 'POST', '/ui/account/share', { team: team.id, period })).status, 200, 'agents can\'t share');
    assert.equal((await ui(A, 'POST', '/ui/account/share', { team: other.id, period })).status, 404);
    assert.equal((await ui(A, 'POST', '/ui/account/share', { team: team.id, period: 'May' })).status, 400);
    const shared = await ui(A, 'POST', '/ui/account/share', { team: team.id, period });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.equal(mock.reports.length, 1);
    const row = mock.reports[0];
    const s = await state(A);
    assert.equal(row.fingerprint, s.device.fingerprint); assert.equal(row.period, period);
    const p = JSON.parse(row.payload);
    assert.equal(p.label, 'VINAC Link team summary v1'); assert.equal(p.team, team.id);
    assert.ok(p.summary.total > 0); assert.equal(p.summary.agents, 1, 'the agent is counted');
    assert.doesNotMatch(row.payload, /Builder|team@example\.com/, 'counts only: no names of agents, no emails');
    // Signed by this computer's identity key (the one linked to the account).
    const pub = Buffer.from(mock.devices[0].public_key, 'base64url');
    assert.ok(verify(pub, row.payload, Buffer.from(row.signature, 'base64url')));
    assert.ok(!verify(pub, row.payload.replace('"total":', '"total":1'), Buffer.from(row.signature, 'base64url')));
    // Again for the same month replaces it.
    await ui(A, 'POST', '/ui/account/share', { team: team.id, period });
    assert.equal(mock.reports.length, 1);
    const log = (await ui(A, 'GET', '/ui/audit?category=account')).body.entries.map(e => e.type);
    assert.ok(log.includes('account.summary_shared'));
    await ui(A, 'POST', '/ui/account/signout', {});
  } finally { await A.stop(); }
});

test('account: while sign-ups are closed, a new email gets a clear answer', async () => {
  const A = await startDevice('acct-b');
  mock.state.signups = false;
  try {
    const r = await ui(A, 'POST', '/ui/account/start', { email: 'new@example.com' });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /aren't open for sign-up yet/);
  } finally { mock.state.signups = true; await A.stop(); }
});
