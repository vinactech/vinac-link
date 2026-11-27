// 0.16.3: fixes from the 2026-11-27 review. Grants bound to the argument list, one-time key
// approvals collected once by the identity that asked, room files checked with the posting agent,
// ambiguous room names, and an exact next action for cards. Temporary homes and loopback only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startDevice, ui, api, state, tempHome } from './helpers.mjs';
import { Grants, splitCommand, argvMatches, spawnArgv, showArgv } from '../src/grants.js';
import { nextCardAction } from '../src/daemon.js';

const as = (d, token) => (method, p, body) => ui(d, method, p, body, { token: null, auth: `Bearer ${token}` });
const VALUE = 'sk_test_review_value_0123456789';
const memoryStore = () => { let g = []; return { grants: () => g, saveGrants: x => { g = x; } }; };

test('grants match the argument list, not a joined or shortened string', () => {
  const grants = new Grants(memoryStore());
  const cwd = path.resolve(tempHome('argv-grant'));
  grants.add({ names: ['K'], argv: ['node', 'my script.js'], cwd, hours: 1 });
  const m = argv => grants.match({ names: ['K'], argv, cwd });
  assert.ok(m(['node', 'my script.js']), 'the same arguments');
  assert.equal(m(['node', 'my', 'script.js']), null, 'the same text with other argument boundaries does not match');
  assert.equal(m(['node', 'my script.js', '--more']), null, 'exact by default');
  // Two commands that only differ after 400 characters.
  const long = 'x'.repeat(450);
  grants.add({ names: ['K'], argv: ['node', `${long}a`], cwd, hours: 1 });
  assert.ok(m(['node', `${long}a`]));
  assert.equal(m(['node', `${long}b`]), null, 'a difference past 400 characters still counts');
  // Prefix only when chosen: the grant's arguments, then at least one more.
  assert.ok(argvMatches({ argv: ['npm', 'run'], prefix: true }, ['npm', 'run', 'build']));
  assert.ok(!argvMatches({ argv: ['npm', 'run'], prefix: true }, ['npm', 'run']));
  assert.ok(!argvMatches({ argv: ['npm', 'run'], prefix: true }, ['npm', 'runx']));
  // A grant made before 0.16.3 (string only) matches nothing.
  assert.ok(!argvMatches({ command: 'npm test', prefix: false }, ['npm', 'test']));
  assert.equal(grants.view().length, 2);
});

test('grants bind which variable each key goes into', () => {
  const grants = new Grants(memoryStore());
  const cwd = path.resolve(tempHome('env-grant'));
  grants.add({ names: ['STRIPE_KEY'], argv: ['npm', 'test'], envNames: { STRIPE_KEY: 'STRIPE_KEY' }, cwd, hours: 1 });
  assert.ok(grants.match({ names: ['STRIPE_KEY'], argv: ['npm', 'test'], cwd }), 'the default variable');
  assert.equal(grants.match({ names: ['STRIPE_KEY'], argv: ['npm', 'test'], envNames: { STRIPE_KEY: 'NODE_OPTIONS' }, cwd }), null, 'another variable asks again');
});

test('typed commands: quotes keep spaces in one argument', () => {
  assert.deepEqual(splitCommand('npm run dev'), ['npm', 'run', 'dev']);
  assert.deepEqual(splitCommand('node "my script.js" --x=\'a b\''), ['node', 'my script.js', '--x=a b']);
  assert.deepEqual(splitCommand('node ""'), ['node', '']);
  assert.throws(() => splitCommand('node "open'), /unclosed quote/);
  assert.equal(showArgv(['node', 'my script.js']), 'node "my script.js"');
});

test('the service starts exactly the argument list (spaces, quotes, cmd.exe characters)', { timeout: 20_000 }, async () => {
  const dir = path.resolve(tempHome('argv-run'));
  const script = path.join(dir, 'echo.js');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  const args = ['two words', 'quote"inside', 'a & b', '%PATH%', '100%!', 'x'.repeat(500)];
  const out = await new Promise((resolve, reject) => {
    const child = spawnArgv([process.execPath, script, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let s = ''; child.stdout.on('data', b => { s += b; }); child.on('error', reject); child.on('close', () => resolve(s));
  });
  assert.deepEqual(JSON.parse(out), args, 'every argument arrives unchanged, none is read by a shell');
  if (process.platform === 'win32') {
    const bat = path.join(dir, 'tool.cmd');
    fs.writeFileSync(bat, '@echo %*\r\n');
    const env = { ...process.env, PATH: `${dir};${process.env.PATH || process.env.Path}` };
    assert.throws(() => spawnArgv(['tool', 'a & calc'], { env }), /batch file/, 'a batch file never gets cmd.exe characters');
    assert.throws(() => spawnArgv(['tool', '%USERNAME%'], { env }), /batch file/);
    const plain = await new Promise(resolve => {
      const c = spawnArgv(['tool', 'run', 'two words'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let s = ''; c.stdout.on('data', b => { s += b; }); c.on('close', () => resolve(s.trim()));
    });
    assert.equal(plain, 'run "two words"', 'plain arguments still reach npm-style .cmd files');
  }
});

test('one-time key approval: only the identity that asked collects it, once, before the deadline', { timeout: 30_000 }, async () => {
  const A = await startDevice('collect-a');
  try {
    await ui(A, 'POST', '/ui/secrets/add', { name: 'DEMO_KEY', value: VALUE });
    const codex = as(A, (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent.token);
    const other = as(A, (await ui(A, 'POST', '/ui/agents/add', { name: 'Other' })).body.newAgent.token);
    const cwd = path.resolve(tempHome('collect-work'));
    const ask = () => codex('POST', '/api/secret-use', { names: ['DEMO_KEY'], command: ['npm', 'test'], cwd });

    // Another identity (or the default token) can't collect, even while it is waiting.
    const a = await ask();
    const waiting = codex('GET', `/api/secret-use?id=${a.body.id}&wait=10`);
    const waiting2 = codex('GET', `/api/secret-use?id=${a.body.id}&wait=10`);
    assert.equal((await other('GET', `/api/secret-use?id=${a.body.id}`)).status, 404);
    assert.equal((await api(A, 'GET', `/api/secret-use?id=${a.body.id}`)).status, 404);
    await ui(A, 'POST', '/ui/secret-use/decide', { id: a.body.id, approve: true });
    // Two callers were waiting: exactly one gets the value.
    const [r1, r2] = await Promise.all([waiting, waiting2]);
    const got = [r1, r2].filter(r => r.status === 200 && r.body.values?.DEMO_KEY === VALUE);
    assert.equal(got.length, 1, `exactly one collection: ${JSON.stringify([r1.body, r2.body])}`);
    assert.equal([r1, r2].filter(r => r.status === 404).length, 1);
    assert.equal((await codex('GET', `/api/secret-use?id=${a.body.id}`)).status, 404, 'and never again');

    // An approval nobody collects in time expires.
    const b = await ask();
    await ui(A, 'POST', '/ui/secret-use/decide', { id: b.body.id, approve: true });
    A.secretUses.get(b.body.id).expires = Date.now() - 1; // test clock: the 30 s deadline passed
    const late = await codex('GET', `/api/secret-use?id=${b.body.id}`);
    assert.equal(late.body.status, 'expired');
    assert.equal(late.body.values, undefined, 'no value after the deadline');
    assert.ok(!A.audit.tail(50).some(e => e.type === 'secret.used' && e.via === 'approved' && A.secretUses.has(b.body.id)));
  } finally { await A.stop(); }
});

test('room files: checked with the posting agent before anything is stored; refused uploads leave nothing', { timeout: 30_000 }, async () => {
  const A = await startDevice('roomfile-a');
  try {
    const work = path.resolve(tempHome('roomfile-proj'));
    const codexAdd = (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent;
    const otherAdd = (await ui(A, 'POST', '/ui/agents/add', { name: 'Other' })).body.newAgent;
    const ws = await ui(A, 'POST', '/ui/projects/workspace', { name: 'Shop', folder: work, agents: [codexAdd.id] });
    assert.equal(ws.status, 200, JSON.stringify(ws.body));
    const room = (await state(A)).rooms.find(r => r.project === 'Shop');
    const upload = (token, name) => fetch(`http://127.0.0.1:${A.uiPort}/api/send-file?room=${encodeURIComponent(room.id)}&name=${name}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: Buffer.from('hello') });
    const files = () => (fs.existsSync(path.join(A.homeDir, 'files')) ? fs.readdirSync(path.join(A.homeDir, 'files')) : []);

    const ok = await upload(codexAdd.token, 'notes.txt');
    assert.equal(ok.status, 200, await ok.clone().text());
    const post = (await ui(A, 'GET', `/ui/rooms/messages?id=${room.id}`)).body.messages?.find(m => m.card?.type === 'file' || m.args?.card?.type === 'file');
    assert.ok(post, 'the file card is in the room');
    assert.equal(post.agent?.name, 'Codex', 'attributed to the agent that posted it');
    const before = files().length;

    const refused = await upload(otherAdd.token, 'other.txt');
    assert.equal(refused.status, 403, 'an agent outside the project is refused for files as for text');
    const refusedDefault = await upload(A.apiToken, 'default.txt');
    assert.equal(refusedDefault.status, 403, 'the default agent too');
    assert.equal(files().length, before, 'a refused upload stores nothing');
  } finally { await A.stop(); }
});

test('room names several rooms share reach no room; ids always work', { timeout: 30_000 }, async () => {
  const { pair } = await import('./helpers.mjs');
  const A = await startDevice('ambig-a'), B = await startDevice('ambig-b');
  try {
    await pair(A, B);
    const peer = (await state(A)).peers[0].id;
    await ui(A, 'POST', '/ui/rooms', { name: 'Test Room', members: [peer] });
    // A second room whose name differs only in case (e.g. made on another device).
    const rooms = A.store.rooms();
    const copy = { ...rooms[0], id: 'secondRoomId1', name: 'Test room' };
    A.store.saveRooms([...rooms, copy]);
    const before = A.store.messages().length;
    const r = await api(A, 'POST', '/api/send', { room: 'test room', text: 'Which one?' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /AMBIGUOUS_ROOM: 2 rooms/);
    assert.match(r.body.error, new RegExp(rooms[0].id));
    assert.match(r.body.error, /secondRoomId1/);
    assert.equal(A.store.messages().length, before, 'nothing was posted');
    assert.equal((await api(A, 'POST', '/api/send', { room: 'secondRoomId1', text: 'This one.' })).status, 200, 'the id picks one');
  } finally { await A.stop(); await B.stop(); }
});

test('OpenClaw: the page gives it its own identity; its node plugin then acts as "OpenClaw"; removing it falls back', { timeout: 30_000 }, async () => {
  const oc = path.resolve(tempHome('openclaw-dir'));
  process.env.VINAC_OPENCLAW_DIR = oc;
  const A = await startDevice('openclaw-a');
  try {
    // No plugin yet: the page can't connect it.
    assert.equal((await ui(A, 'GET', '/ui/connect/openclaw')).body.mode, 'none');
    fs.writeFileSync(path.join(oc, 'openclaw.json'), JSON.stringify({ plugins: { entries: { 'vinac-link-node': { enabled: true } } } }));
    assert.equal((await ui(A, 'GET', '/ui/connect/openclaw')).body.mode, 'plugin');
    assert.equal((await api(A, 'POST', '/ui/connect/openclaw', {})).status, 401, 'agents cannot give themselves an identity');
    const r = await ui(A, 'POST', '/ui/connect/openclaw', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status.mode, 'own');
    assert.ok(!JSON.stringify(r.body).includes('agt_'), 'the page never sees the token');
    const before = fs.readFileSync(path.join(oc, 'openclaw.json'), 'utf8');
    const { runCommand } = await import('../../openclaw/node/commands.js');
    const st = JSON.parse(await runCommand('vinac.status', '{}', { home: A.homeDir }));
    assert.equal(st.ok, true, JSON.stringify(st));
    assert.equal(st.result.you?.agent, 'OpenClaw', 'the node plugin acts as OpenClaw');
    assert.equal(fs.readFileSync(path.join(oc, 'openclaw.json'), 'utf8'), before, 'OpenClaw\'s settings are never changed');
    // Removing the identity on the Agents page removes the token file: back to the default agent.
    const id = (await state(A)).agents.find(a => a.name === 'OpenClaw').id;
    await ui(A, 'POST', '/ui/agents/remove', { id });
    assert.equal((await ui(A, 'GET', '/ui/connect/openclaw')).body.mode, 'plugin');
    const st2 = JSON.parse(await runCommand('vinac.status', '{}', { home: A.homeDir }));
    assert.equal(st2.result.you?.identity, 'default');
  } finally { delete process.env.VINAC_OPENCLAW_DIR; await A.stop(); }
});

test('cards: each says exactly what to send next; status says who the agent is',{ timeout: 30_000 }, async () => {
  assert.deepEqual(nextCardAction({ id: 'c1', type: 'task', state: 'open', roomId: 'r1' }).next, { tool: 'vinac_send', args: { room: 'r1', cardUpdate: { card: 'c1', action: 'claim' } } });
  assert.equal(nextCardAction({ id: 'c2', type: 'task', state: 'claimed', peerId: 'p1', claimedBy: 'Codex' }).next.args.cardUpdate.action, 'done');
  assert.match(nextCardAction({ id: 'c3', type: 'decision', state: 'open' }).nextNote, /Only a person/);
  const A = await startDevice('cards-next');
  try {
    const work = path.resolve(tempHome('cards-proj'));
    const codex = (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent;
    await ui(A, 'POST', '/ui/projects/workspace', { name: 'Board', folder: work, agents: [codex.id] });
    const room = (await state(A)).rooms.find(r => r.project === 'Board');
    const empty = (await as(A, codex.token)('GET', `/api/cards?room=${room.id}&open=1`)).body;
    assert.match(empty.note, /^No open cards in this room\./);
    assert.ok(!/vinac_card\b/.test(empty.note), 'no tool that does not exist');
    const posted = await as(A, codex.token)('POST', '/api/send', { room: room.id, card: { type: 'task', title: 'Review the checkout' } });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const cards = (await as(A, codex.token)('GET', `/api/cards?room=${room.id}&open=1`)).body.cards;
    assert.equal(cards[0].roomId, room.id);
    const claim = await as(A, codex.token)('POST', '/api/send', cards[0].next.args);
    assert.equal(claim.status, 200, `the suggested call works: ${JSON.stringify(claim.body)}`);

    const st = (await as(A, codex.token)('GET', '/api/status')).body;
    assert.equal(st.you.agent, 'Codex');
    assert.equal(st.you.identity, 'own');
    assert.equal(st.you.rooms.find(r => r.id === room.id).mayPost, true);
    const dflt = (await api(A, 'GET', '/api/status')).body.you;
    assert.equal(dflt.identity, 'default');
    assert.equal(dflt.rooms.find(r => r.id === room.id).mayPost, false, 'the default agent is not one of the project\'s agents');
  } finally { await A.stop(); }
});
