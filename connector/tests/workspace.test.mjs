// 0.15: project workspaces for agents on one computer (Codex and Claude Code on one Mac), and
// connecting Codex. All on 127.0.0.1 with temporary homes; the real ~/.codex and ~/.claude are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';
import { connectCodex, disconnectCodex, codexStatus } from '../src/connect.js';
import { checkCard } from '../src/cards.js';

const tmpDir = name => fs.mkdtempSync(path.join(os.tmpdir(), `vinac-${name}-`));
const as = (d, token) => (method, p, body) => ui(d, method, p, body, { token: null, auth: `Bearer ${token}` });

test('two agents on one computer work in a project room: posts, claims, per-agent read, no echo', async () => {
  const A = await startDevice('Mac Mini');
  const folder = tmpDir('proj');
  try {
    const claude = (await ui(A, 'POST', '/ui/agents/add', { name: 'Claude Code' })).body.newAgent;
    const codex = (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent;
    const C = as(A, claude.token), X = as(A, codex.token);
    const w = await ui(A, 'POST', '/ui/projects/workspace', { name: 'Shop', folder, agents: [claude.id, codex.id] });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.room.local, true);
    assert.equal(w.body.project.agents.length, 2);
    const room = w.body.room.id;

    // Claude posts a review task; Codex sees it (once), Claude doesn't get its own post back.
    const post = await C('POST', '/api/send', { room, card: { type: 'task', title: 'Review the checkout', review: true, branch: 'feat/checkout', path: 'src/checkout' } });
    assert.equal(post.status, 200, JSON.stringify(post.body));
    assert.match(post.body.note, /agents on this computer/);
    const ev = (await A_events(A, codex.id)).unread;
    assert.equal(ev.length, 1); assert.equal(ev[0].local, true); assert.equal(ev[0].peer.name, 'Claude Code');
    assert.equal((await A_events(A, claude.id)).unread.length, 0, 'no echo of its own post');
    const inX = (await X('GET', '/api/inbox')).body.messages;
    assert.equal(inX.length, 1);
    assert.match(inX[0].text, /^Review: Review the checkout \(branch feat\/checkout\) \[src\/checkout\]/);
    assert.match(inX[0].trust, /another agent on this computer/);
    assert.equal((await X('GET', '/api/inbox')).body.messages.length, 0, 'read for Codex now');
    assert.equal((await C('GET', '/api/inbox')).body.messages.length, 0);

    // Codex claims it; the board says who.
    const card = (await X('GET', `/api/cards?room=${room}`)).body.cards[0];
    assert.equal(card.review, true); assert.equal(card.branch, 'feat/checkout');
    assert.equal((await X('POST', '/api/send', { room, cardUpdate: { card: card.id, action: 'claim' } })).status, 200);
    const view = (await ui(A, 'GET', `/ui/project?id=${w.body.project.id}`)).body;
    assert.equal(view.board.claimed.length, 1);
    assert.equal(view.board.claimed[0].claimedBy, 'me › Codex');
    assert.equal(view.board.open.length, 0);
    assert.equal((await C('GET', '/api/inbox')).body.messages.length, 1, 'Claude hears about the claim');

    // The person posts: both agents see it.
    await ui(A, 'POST', '/ui/card', { room, text: 'Ship it after the review, please.' });
    assert.match((await C('GET', '/api/inbox')).body.messages[0].trust, /the person on this computer/);
    assert.equal((await X('GET', '/api/inbox')).body.messages.length, 1);

    // A decision an agent here posts reaches the person's Needs me; their tasks between them don't.
    await X('POST', '/api/send', { room, card: { type: 'decision', title: 'Stripe or Paddle?', options: ['Stripe', 'Paddle'] } });
    const needs = (await ui(A, 'GET', '/ui/state')).body.needsMe;
    assert.deepEqual(needs.map(n => [n.kind, n.title]), [['decision', 'Stripe or Paddle?']]);
    await ui(A, 'POST', '/ui/card', { room, cardUpdate: { card: needs[0].card, action: 'answer', option: 'Stripe' } });
    assert.equal((await ui(A, 'GET', '/ui/state')).body.needsMe.length, 0);
    await C('GET', '/api/inbox'); await X('GET', '/api/inbox');

    // The room's messages show each post once.
    const msgs = (await ui(A, 'GET', `/ui/rooms/messages?id=${room}`)).body.messages;
    assert.equal(msgs.length, 5, 'task, claim, decision, answer, person post: once each');

    // An agent that isn't in the project can't post in its room (the default token, here).
    const def = await api(A, 'POST', '/api/send', { room, text: 'hello' });
    assert.equal(def.status, 403); assert.match(def.body.error, /Only the agents of the project Shop/);
    assert.equal((await api(A, 'POST', '/ui/projects/workspace', { name: 'X', folder })).status >= 400, true, 'agents cannot make workspaces');
  } finally { await A.stop(); }
});

async function A_events(A, id) { return (await ui(A, 'GET', `/api/events?as=${id}`, undefined, { token: null, auth: `Bearer ${A.apiToken}` })).body; }

test('project grant: one click lets the project\'s agents run a command with its dev keys (never prod)', async () => {
  const A = await startDevice('Grant A');
  const folder = tmpDir('grant');
  try {
    const claude = (await ui(A, 'POST', '/ui/agents/add', { name: 'Claude Code' })).body.newAgent;
    const codex = (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent;
    const w = (await ui(A, 'POST', '/ui/projects/workspace', { name: 'Shop', folder, agents: [claude.id, codex.id] })).body;
    const none = await ui(A, 'POST', '/ui/projects/grant', { id: w.project.id, command: 'npm test', hours: 8 });
    assert.equal(none.status, 400); assert.match(none.body.error, /no dev keys yet/);
    for (const [name, env] of [['STRIPE_KEY', 'dev'], ['STRIPE_KEY', 'prod'], ['DB_URL', 'dev']]) {
      assert.equal((await ui(A, 'POST', '/ui/secrets/add', { name, value: `test-${name}-${env}`, project: w.project.id, env })).status, 200);
    }
    const g = (await ui(A, 'POST', '/ui/projects/grant', { id: w.project.id, command: 'npm test', hours: 8 })).body;
    assert.equal(g.allowed, 2);
    assert.deepEqual(g.names.sort(), ['DB_URL', 'STRIPE_KEY'], 'dev keys only');
    assert.ok(g.grants.every(x => !x.names.includes('prod')));
    assert.deepEqual(g.keys.prod, ['STRIPE_KEY'], 'the prod key exists but is not in the grant (prod asks every time)');
    const view = (await ui(A, 'GET', `/ui/project?id=${w.project.id}`)).body;
    assert.deepEqual(view.grants.map(x => x.agentName).sort(), ['Claude Code', 'Codex']);
    assert.doesNotMatch(JSON.stringify(view), /test-STRIPE|test-DB/, 'no values on the project page');
    assert.equal((await api(A, 'POST', '/ui/projects/grant', { id: w.project.id, command: 'npm test' })).status >= 400, true, 'agents cannot grant');
  } finally { await A.stop(); }
});

test('a project room with another device: the post is kept here once, sent there, and counted once', async () => {
  const A = await startDevice('PC'), B = await startDevice('Mac');
  try {
    await pair(A, B);
    const claude = (await ui(A, 'POST', '/ui/agents/add', { name: 'Claude Code' })).body.newAgent;
    const bId = (await ui(A, 'GET', '/ui/state')).body.peers[0].id;
    const w = (await ui(A, 'POST', '/ui/projects/workspace', { name: 'Site', folder: tmpDir('site'), agents: [claude.id], devices: [bId] })).body;
    const C = as(A, claude.token);
    const r = await C('POST', '/api/send', { room: w.room.id, card: { type: 'task', title: 'Write the about page' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await waitFor(async () => (await api(B, 'GET', '/api/inbox?peek=1')).body.messages.length === 1);
    const card = (await C('GET', `/api/cards?room=${w.room.id}`)).body.cards[0];
    await C('POST', '/api/send', { room: w.room.id, cardUpdate: { card: card.id, action: 'claim' } });
    const msgs = (await ui(A, 'GET', `/ui/rooms/messages?id=${w.room.id}`)).body.messages;
    assert.equal(msgs.length, 2); assert.deepEqual(msgs[0].to, ['Mac']);
    const c2 = (await ui(A, 'GET', `/ui/project?id=${w.project.id}`)).body.board.claimed[0];
    assert.equal(c2.claimedBy, 'me › Claude Code');
    await waitFor(async () => (await api(B, 'GET', '/api/cards')).body.cards[0]?.state === 'claimed');
  } finally { await A.stop(); await B.stop(); }
});

test('project brief and folders: the page reads folders, agents get the brief, agents cannot browse', async () => {
  const A = await startDevice('Brief');
  const folder = tmpDir('brief');
  try {
    fs.mkdirSync(path.join(folder, '.git')); fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(folder, 'vinac.keys.json'), '{"dev":[]}');
    fs.mkdirSync(path.join(folder, 'src')); fs.mkdirSync(path.join(folder, '.hidden'));
    const facts = (await ui(A, 'GET', `/ui/folders/facts?path=${encodeURIComponent(folder)}`)).body;
    assert.deepEqual([facts.exists, facts.git, facts.branch, facts.manifest], [true, true, 'main', true]);
    const list = (await ui(A, 'GET', `/ui/folders?path=${encodeURIComponent(folder)}`)).body;
    assert.deepEqual(list.dirs, ['src'], 'hidden folders left out');
    assert.equal(list.parent, path.dirname(folder));
    assert.equal((await api(A, 'GET', `/ui/folders?path=${encodeURIComponent(folder)}`)).status >= 400, true, 'agents cannot browse folders');
    assert.equal((await api(A, 'POST', '/ui/folders/pick', {})).status >= 400, true, 'agents cannot open the folder window');

    const w = (await ui(A, 'POST', '/ui/projects/workspace', { name: 'Brief', folder, about: 'An online shop. Claude writes, Codex reviews.' })).body;
    assert.equal(w.project.about, 'An online shop. Claude writes, Codex reviews.');
    const room = (await api(A, 'GET', '/api/peers')).body.rooms.find(r => r.name === 'Brief');
    assert.equal(room.projectBrief, 'An online shop. Claude writes, Codex reviews.');
    await ui(A, 'POST', '/ui/projects/about', { id: w.project.id, about: '' });
    assert.equal((await api(A, 'GET', '/api/peers')).body.rooms.find(r => r.name === 'Brief').projectBrief, undefined);
    assert.equal((await api(A, 'POST', '/ui/projects/about', { id: w.project.id, about: 'x' })).status >= 400, true, 'agents cannot write the brief');
  } finally { await A.stop(); }
});

test('review fields are optional and dropped on other card types', () => {
  const c = checkCard({ type: 'task', title: 'x', review: true, branch: 'b', path: 'p' }, { newId: true });
  assert.deepEqual([c.review, c.branch, c.path], [true, 'b', 'p']);
  const s = checkCard({ type: 'status', title: 'x', review: true, branch: 'b' }, { newId: true });
  assert.equal(s.review, undefined); assert.equal(s.branch, undefined);
});

test('connect codex: one marked [mcp_servers.vinac] table, others kept, hand-made one replaced, remove', () => {
  const dir = tmpDir('codex');
  const cfg = path.join(dir, 'config.toml');
  fs.writeFileSync(cfg, 'model = "gpt-5"\n\n[mcp_servers.vinac]\ncommand = "node"\nargs = ["/old/vinac.mjs", "mcp"]\n\n[mcp_servers.vinac.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "other"\n');
  const o = { dir, node: '/Applications/VINAC Link.app/node', bin: '/Applications/VINAC Link.app/vinac.mjs' };
  assert.equal(codexStatus(o).mode, 'partial');
  const r = connectCodex({ ...o, agent: { id: 'abcdefabcdef', token: 'agt_test-token' } });
  assert.equal(r.ok, true);
  const t = fs.readFileSync(cfg, 'utf8');
  assert.match(t, /model = "gpt-5"/); assert.match(t, /\[mcp_servers\.other\]\ncommand = "other"/);
  assert.equal((t.match(/\[mcp_servers\.vinac/g) || []).length, 1, 'old table and its env subtable gone');
  assert.match(t, /command = "\/Applications\/VINAC Link.app\/node"/);
  assert.match(t, /env = \{ VINAC_AGENT_TOKEN = "agt_test-token" \}/);
  assert.ok(fs.existsSync(`${cfg}.vinac-backup`));
  assert.equal(codexStatus(o).mode, 'direct'); assert.equal(codexStatus(o).identity, true);
  assert.equal(connectCodex({ ...o, agent: { id: 'abcdefabcdef', token: 'agt_test-token' } }).changed.length, 0, 'idempotent');
  disconnectCodex(o);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.doesNotMatch(after, /vinac/); assert.match(after, /\[mcp_servers\.other\]/);
});

test('Connect on the page gives Codex and Claude Code their own identities (same id when connecting again)', async () => {
  const cdir = tmpDir('pcodex'), ldir = tmpDir('pclaude');
  process.env.VINAC_CODEX_DIR = cdir; process.env.VINAC_CLAUDE_DIR = ldir;
  const A = await startDevice('Ids');
  try {
    assert.equal((await ui(A, 'POST', '/ui/connect/codex', {})).status, 200);
    const t1 = fs.readFileSync(path.join(cdir, 'config.toml'), 'utf8').match(/agt_[A-Za-z0-9_-]+/)[0];
    const agent = (await ui(A, 'GET', '/ui/state')).body.agents.find(a => a.name === 'Codex');
    assert.ok(agent);
    assert.equal((await ui(A, 'GET', '/api/status', undefined, { token: null, auth: `Bearer ${t1}` })).status, 200, 'the written token works');
    await ui(A, 'POST', '/ui/connect/codex', {});
    const t2 = fs.readFileSync(path.join(cdir, 'config.toml'), 'utf8').match(/agt_[A-Za-z0-9_-]+/)[0];
    assert.notEqual(t1, t2);
    assert.equal((await ui(A, 'GET', '/ui/state')).body.agents.filter(a => a.name === 'Codex').length, 1);
    assert.equal((await ui(A, 'GET', '/ui/state')).body.agents.find(a => a.name === 'Codex').id, agent.id);

    await ui(A, 'POST', '/ui/connect/claude', {});
    const claude = (await ui(A, 'GET', '/ui/state')).body.agents.find(a => a.name === 'Claude Code');
    const s = JSON.parse(fs.readFileSync(path.join(ldir, 'settings.json'), 'utf8'));
    assert.match(s.hooks.Stop[0].hooks[0].command, new RegExp(`hook wait --as ${claude.id}$`));
    assert.match(JSON.parse(fs.readFileSync(path.join(ldir, '.claude.json'), 'utf8')).mcpServers.vinac.env.VINAC_AGENT_TOKEN, /^agt_/);
    const st = (await ui(A, 'GET', '/ui/connect/claude')).body;
    assert.doesNotMatch(JSON.stringify(st), /agt_/, 'the page status never shows a token');
    assert.equal(st.direct.identity, true);
  } finally { await A.stop(); delete process.env.VINAC_CODEX_DIR; delete process.env.VINAC_CLAUDE_DIR; }
});
