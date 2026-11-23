// 0.11: agent identities and standing key grants (runs the service starts itself).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startDevice, ui, api, state, tempHome } from './helpers.mjs';
import { insideFolder, commandMatches } from '../src/grants.js';

const as = (d, token) => (method, p, body) => ui(d, method, p, body, { token: null, auth: `Bearer ${token}` });
const VALUE = 'sk_test_grant_value_0123456789';

async function streamRun(d, token, id) {
  const r = await fetch(`http://127.0.0.1:${d.uiPort}/api/secret-run`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  const text = await r.text();
  return { status: r.status, text, lines: r.ok ? text.trim().split('\n').map(l => JSON.parse(l)) : [] };
}

test('folders and commands: a grant covers its folder and subfolders, and only its command (or, with prefix, more arguments)', () => {
  const root = path.resolve(tempHome('grant-paths'));
  assert.ok(insideFolder(root, root));
  assert.ok(insideFolder(root, path.join(root, 'sub', 'deeper')));
  assert.ok(!insideFolder(root, path.dirname(root)));
  assert.ok(!insideFolder(root, `${root}-other`), 'a sibling with the same start is not inside');
  assert.ok(!insideFolder(root, 'relative/path'));
  assert.ok(commandMatches({ command: 'npm test', prefix: false }, 'npm test'));
  assert.ok(!commandMatches({ command: 'npm test', prefix: false }, 'npm test -- --watch'));
  assert.ok(commandMatches({ command: 'npm run', prefix: true }, 'npm run build'));
  assert.ok(!commandMatches({ command: 'npm run', prefix: true }, 'npm runx'));
});

test('agent identities: only the page makes them; a token is shown once and works until the agent is removed', async () => {
  const A = await startDevice('agents-a');
  try {
    assert.notEqual((await api(A, 'POST', '/ui/agents/add', { name: 'Sneaky' })).status, 200, 'agents cannot add identities');
    const r = await ui(A, 'POST', '/ui/agents/add', { name: 'Codex on the Mac' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { token } = r.body.newAgent;
    assert.match(token, /^agt_/);
    assert.equal((await ui(A, 'POST', '/ui/agents/add', { name: 'codex on the mac' })).status, 409, 'names are unique');
    const s = await state(A);
    assert.equal(s.agents.length, 1);
    assert.ok(!JSON.stringify(s.agents).includes(token) && !('hash' in s.agents[0]), 'the page never shows the token again');
    assert.ok(!fs.readFileSync(path.join(A.homeDir, 'agents.json'), 'utf8').includes(token), 'only a hash is stored');
    const codex = as(A, token);
    assert.equal((await codex('GET', '/api/status')).status, 200);
    assert.equal((await as(A, 'agt_not-a-real-token')('GET', '/api/status')).status, 401);
    assert.equal((await codex('POST', '/ui/agents/remove', { id: s.agents[0].id })).status, 401, 'an agent cannot remove identities');
    await ui(A, 'POST', '/ui/agents/remove', { id: s.agents[0].id });
    assert.equal((await codex('GET', '/api/status')).status, 401, 'removed: the token stops working');
  } finally { await A.stop(); }
});

test('agent fingerprints across devices: a named agent\'s messages say who sent them on the other device too', { timeout: 30_000 }, async () => {
  const { pair } = await import('./helpers.mjs');
  const A = await startDevice('fp-a'), B = await startDevice('fp-b');
  try {
    await pair(A, B);
    const r = await ui(A, 'POST', '/ui/agents/add', { name: 'Codex on the PC' });
    const { token } = r.body.newAgent;
    const fp = (await state(A)).agents[0].fingerprint;
    assert.match(fp, /^AGT-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    const bPeer = (await state(A)).peers[0].id, aAtB = (await state(B)).peers[0].id;
    // Sent by the named agent, then by the default token (no identity), then by the person.
    assert.equal((await as(A, token)('POST', '/api/send', { to: bPeer, text: 'Which branch has the auth refactor?' })).status, 200);
    assert.equal((await api(A, 'POST', '/api/send', { to: bPeer, text: 'From the default agent token' })).status, 200);
    assert.equal((await ui(A, 'POST', '/ui/send', { to: bPeer, text: 'From the person' })).status, 200);
    const got = (await ui(B, 'GET', `/ui/messages?peer=${aAtB}`)).body.messages;
    const named = got.find(m => m.text.startsWith('Which branch'));
    assert.deepEqual(named.agent, { name: 'Codex on the PC', fp }, 'the receiving page sees the agent\'s name and fingerprint');
    assert.ok(!got.find(m => m.text.startsWith('From the default')).agent, 'no identity, no agent name');
    assert.ok(!got.find(m => m.text === 'From the person').agent);
    // The sender's own history and both audit logs name the agent.
    assert.equal((await ui(A, 'GET', `/ui/messages?peer=${bPeer}`)).body.messages.find(m => m.text.startsWith('Which branch')).agent.fp, fp);
    const inB = (await ui(B, 'GET', '/ui/audit?agent=Codex%20on%20the%20PC')).body.entries.filter(e => e.type === 'msg.in');
    assert.equal(inB.length, 1);
    assert.equal(inB[0].fields.agentFp, fp); assert.equal(inB[0].fields.remoteAgent, true);
    assert.match(inB[0].who.name, /› agent Codex on the PC$/);
    // The receiving agent's inbox shows it too (as the other device says).
    const inbox = (await api(B, 'GET', '/api/inbox?all=1')).body;
    assert.equal((inbox.messages || []).find(m => m.text.startsWith('Which branch'))?.agent?.fp, fp);
  } finally { await A.stop(); await B.stop(); }
});

test('standing grants: approve once and allow; then the service runs exactly that command for that agent in that folder, and the values never reach the agent', { timeout: 60_000 }, async () => {
  const A = await startDevice('grants-a');
  try {
    await ui(A, 'POST', '/ui/secrets/add', { name: 'DEMO_KEY', value: VALUE });
    const codexToken = (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent.token;
    const otherToken = (await ui(A, 'POST', '/ui/agents/add', { name: 'Other agent' })).body.newAgent.token;
    const codex = as(A, codexToken), other = as(A, otherToken);
    const work = path.resolve(tempHome('grant-work'));
    fs.mkdirSync(path.join(work, 'sub'));
    fs.writeFileSync(path.join(work, 'print.js'), 'console.log("key is " + process.env.DEMO_KEY); console.error("on stderr: " + process.env.DEMO_KEY); process.exit(3);\n');
    const command = [process.execPath, 'print.js'];
    const ask = body => codex('POST', '/api/secret-use', { names: ['DEMO_KEY'], command, cwd: work, ...body });

    // First time: the person approves this run and allows it for 8 hours.
    const first = await ask({});
    assert.equal(first.body.status, 'pending');
    const page = (await state(A)).secretUses[0];
    assert.equal(page.agent, 'Codex');
    assert.equal(page.canAllow, true);
    assert.equal((await ui(A, 'POST', '/ui/secret-use/decide', { id: first.body.id, approve: true, allowHours: 5 })).status, 400, 'only 1, 8, 24 or 168 hours');
    assert.equal((await codex('POST', '/ui/secret-use/decide', { id: first.body.id, approve: true, allowHours: 8 })).status, 401, 'an agent cannot make a grant');
    const decided = await ui(A, 'POST', '/ui/secret-use/decide', { id: first.body.id, approve: true, allowHours: 8 });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.grant.agentName, 'Codex');
    assert.equal((await codex('GET', `/api/secret-use?id=${first.body.id}`)).body.values.DEMO_KEY, VALUE, 'that one approved run works as before');
    const grants = (await state(A)).grants;
    assert.equal(grants.length, 1);
    assert.equal(grants[0].cwd, work);

    // Next time: granted, and the service starts it. Output comes back with the value hidden.
    const again = await ask({});
    assert.equal(again.body.status, 'granted');
    assert.ok(!JSON.stringify(again.body).includes(VALUE));
    assert.equal((await codex('GET', `/api/secret-use?id=${again.body.id}`)).body.values, undefined, 'a granted run never hands out values');
    assert.equal((await streamRun(A, otherToken, again.body.id)).status, 403, 'another agent cannot start it');
    const run = await streamRun(A, codexToken, again.body.id);
    assert.equal(run.status, 200, run.text);
    assert.ok(!run.text.includes(VALUE), 'the value never appears in the response');
    assert.match(run.lines.filter(l => l.out).map(l => l.out).join(''), /key is \[hidden: DEMO_KEY\]/);
    assert.match(run.lines.filter(l => l.err).map(l => l.err).join(''), /on stderr: \[hidden: DEMO_KEY\]/);
    assert.equal(run.lines.at(-1).exit, 3, 'the exit code comes back');
    assert.equal((await streamRun(A, codexToken, again.body.id)).status, 404, 'one run per answer');
    assert.equal((await state(A)).grants[0].uses, 1);

    // A subfolder is covered; anything else asks the person again.
    assert.equal((await ask({ cwd: path.join(work, 'sub') })).body.status, 'granted');
    assert.equal((await ask({ cwd: path.dirname(work) })).body.status, 'pending', 'a parent folder is not covered');
    assert.equal((await ask({ command: [...command, '--extra'] })).body.status, 'pending', 'an exact grant takes no extra arguments');
    assert.equal((await other('POST', '/api/secret-use', { names: ['DEMO_KEY'], command, cwd: work })).body.status, 'pending', 'another agent is not covered');
    assert.equal((await api(A, 'POST', '/api/secret-use', { names: ['DEMO_KEY'], command, cwd: work })).body.status, 'pending', 'nor the default agent token');

    // Agents see what they are allowed to run (never values).
    const secrets = (await codex('GET', '/api/secrets')).body;
    assert.equal(secrets.agent, 'Codex');
    assert.deepEqual(secrets.allowedRuns.map(r => r.folder), [work]);
    assert.deepEqual((await other('GET', '/api/secrets')).body.allowedRuns, []);

    // Audited with the agent's name; revoking ends it; removing the agent removes its grants.
    const log = A.audit.tail(30);
    assert.ok(log.some(e => e.type === 'grant.created' && e.agent === 'Codex'));
    assert.ok(log.some(e => e.type === 'secret.used' && e.via === 'grant' && e.agent === 'Codex'));
    assert.ok(!JSON.stringify(log).includes(VALUE));
    assert.equal((await codex('POST', '/ui/grants/revoke', { id: grants[0].id })).status, 401, 'an agent cannot revoke (or touch) grants');
    await ui(A, 'POST', '/ui/grants/revoke', { id: grants[0].id });
    assert.equal((await ask({})).body.status, 'pending', 'revoked');
  } finally { await A.stop(); }
});

test('standing grants: a locked vault blocks them, and removing an agent removes its grants', { timeout: 30_000 }, async () => {
  const A = await startDevice('grants-b');
  try {
    await ui(A, 'POST', '/ui/secrets/add', { name: 'DEMO_KEY', value: VALUE });
    const r = await ui(A, 'POST', '/ui/agents/add', { name: 'Builder' });
    const builder = as(A, r.body.newAgent.token);
    const work = path.resolve(tempHome('grant-work-b'));
    const ask = () => builder('POST', '/api/secret-use', { names: ['DEMO_KEY'], command: ['npm', 'test'], cwd: work });
    const first = await ask();
    await ui(A, 'POST', '/ui/secret-use/decide', { id: first.body.id, approve: true, allowHours: 1 });
    assert.equal((await ask()).body.status, 'granted');
    assert.equal((await ui(A, 'POST', '/ui/vault/setup', { passphrase: 'correct horse battery' })).status, 200);
    await ui(A, 'POST', '/ui/vault/lock', {});
    assert.equal((await ask()).body.status, 'pending', 'locked vault: the person decides again');
    await ui(A, 'POST', '/ui/vault/unlock', { passphrase: 'correct horse battery' });
    assert.equal((await ask()).body.status, 'granted');
    await ui(A, 'POST', '/ui/agents/remove', { id: r.body.newAgent.id });
    assert.equal((await state(A)).grants.length, 0);
  } finally { await A.stop(); }
});
