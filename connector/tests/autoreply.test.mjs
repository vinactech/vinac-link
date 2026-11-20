import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevice, pair, api, ui, waitFor, tempHome } from './helpers.mjs';
import { AUTO_INTENTS, REPLY_INTENTS, DEFAULT_ARGS, PROMPT, TOOLS, inQuietHours } from '../src/autoreply.js';
import { riskOf } from '../src/logos.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fixtures/fake-agent.mjs');

async function setup() {
  const A = await startDevice('Auto A'), B = await startDevice('Auto B'), C = await startDevice('Auto C');
  await pair(A, B); await pair(A, C);
  const ids = Object.fromEntries((await api(A, 'GET', '/api/peers')).body.peers.map(p => [p.name, p.id]));
  // The person points the auto-responder at the fake agent (a node script here).
  assert.equal((await ui(A, 'POST', '/ui/autoreply', { program: process.execPath })).status, 200);
  const file = path.join(A.homeDir, 'autoreply.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), args: [FAKE, ...DEFAULT_ARGS] }));
  const log = path.join(tempHome('fake-agent'), 'runs.jsonl');
  process.env.FAKE_AGENT_LOG = log;
  process.env.FAKE_AGENT_MODE = 'answer';
  const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const enable = (name, mode = 'questions') => ui(A, 'POST', '/ui/autoreply', { device: { id: ids[name], mode } });
  const settings = patch => { const s = JSON.parse(fs.readFileSync(file, 'utf8')); fs.writeFileSync(file, JSON.stringify({ ...s, ...patch })); };
  const autoLog = () => A.auto.log();
  return { A, B, C, ids, runs, enable, settings, autoLog, stop: async () => { await A.stop(); await B.stop(); await C.stop(); } };
}
const ask = (from, q, extra = {}) => api(from, 'POST', '/api/send', { to: 'Auto A', intent: 'agent.question.ask', args: { question: q }, ...extra });
const settle = () => new Promise(r => setTimeout(r, 400));

test('auto-reply intents are info risk; the prompt is fixed and carries no message; quiet hours wrap midnight', () => {
  for (const i of [...AUTO_INTENTS, ...REPLY_INTENTS]) assert.equal(riskOf(i), 'info', i);
  assert.ok(!AUTO_INTENTS.includes('agent.question.answer'), 'answers never start a run (no ping-pong)');
  assert.deepEqual(TOOLS, ['mcp__vinac__vinac_inbox', 'mcp__vinac__vinac_send']);
  assert.ok(DEFAULT_ARGS.includes('--strict-mcp-config') && DEFAULT_ARGS[DEFAULT_ARGS.indexOf('--tools') + 1] === '', 'no built-in tools, no other MCP servers');
  assert.doesNotMatch(PROMPT, /\{(prompt|mcpConfig|tools|maxTurns)\}|\$\{/, 'no placeholders in the prompt');
  const at = (h, m) => new Date(2026, 0, 1, h, m);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(23, 0)), true);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(6, 59)), true);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(7, 0)), false);
  assert.equal(inQuietHours({ from: '09:00', to: '17:00' }, at(12, 0)), true);
  assert.equal(inQuietHours(null, at(12, 0)), false);
});

test('auto-reply runs only when enabled, only for questions/status, never for automatic replies; the run sees only its message', { timeout: 60_000 }, async () => {
  const t = await setup();
  const { A, B, C } = t;
  try {
    // Off by default.
    await ask(B, 'EARLY-QUESTION-1?');
    await settle();
    assert.equal(t.autoLog().length, 0);

    assert.equal((await t.enable('Auto B')).status, 200);
    await api(B, 'POST', '/api/send', { to: 'Auto A', text: 'PLAIN-TEXT-2 what is up?' });
    await api(B, 'POST', '/api/send', { to: 'Auto A', intent: 'agent.task.handoff', args: { task: 'HANDOFF-3' } });
    await api(B, 'POST', '/api/send', { to: 'Auto A', intent: 'crm.contact.read', args: { name: 'HELD-4' } });
    await settle();
    assert.equal(t.autoLog().length, 0, 'plain text, change and read requests never start a run');

    const sent = await ask(B, 'Q-TEXT-881: what time zone are you in?');
    await waitFor(() => t.autoLog().some(e => e.status === 'done'), 15_000);
    const entry = t.autoLog().at(-1);
    assert.equal(entry.peer.name, 'Auto B');
    assert.deepEqual(entry.ids, [sent.body.id]);
    assert.equal(entry.replies, 1);
    assert.doesNotMatch(JSON.stringify(t.autoLog()), /Q-TEXT|EARLY|PLAIN|HANDOFF|HELD/, 'the log has no message text');

    const [run] = t.runs();
    assert.deepEqual(run.inbox.map(m => m.id), [sent.body.id], 'the run sees only the message that started it');
    assert.equal(run.argv[run.argv.indexOf('-p') + 1], PROMPT);
    assert.doesNotMatch(run.argv.join(' '), /Q-TEXT|Auto B|time zone/, 'the command line carries no message text');
    assert.equal(run.argv[run.argv.indexOf('--allowedTools') + 1], TOOLS.join(','));
    assert.deepEqual(run.envKeys.sort(), ['VINAC_API_TOKEN', 'VINAC_HOME']);
    assert.ok(!fs.readdirSync(path.join(A.homeDir, 'autoreply-run')).length, 'the run config is removed afterwards');

    // B got an automatic answer, marked as such.
    const bBox = (await api(B, 'GET', '/api/inbox')).body.messages;
    assert.equal(bBox.length, 1);
    assert.equal(bBox[0].auto, true);
    assert.equal(bBox[0].intent, 'agent.question.answer');
    assert.equal(bBox[0].replyTo, sent.body.id);

    // Only that question was read; the rest still waits for A's agent.
    const aBox = (await api(A, 'GET', '/api/inbox?peek=1')).body.messages.map(m => m.text);
    assert.ok(aBox.some(x => /EARLY-QUESTION/.test(x)) && aBox.some(x => /PLAIN-TEXT-2/.test(x)));
    assert.ok(!aBox.some(x => /Q-TEXT/.test(x)));

    // An automatic message never starts a run, even a question; a device left off never does.
    assert.equal((await t.enable('Auto C')).status, 200);
    await C.send({ to: 'Auto A', intent: 'agent.question.ask', args: { question: 'auto ping' } }, 'agent', { auto: true });
    await t.enable('Auto C', 'off');
    await ask(C, 'from C while off');
    await settle();
    assert.equal(t.autoLog().length, 1);
    const fromC = (await api(A, 'GET', '/api/inbox?peek=1')).body.messages.filter(m => m.peer.name === 'Auto C');
    assert.equal(fromC.find(m => m.args?.question === 'auto ping').auto, true);
  } finally { await t.stop(); }
});

test('a run can only read its messages and answer them, to that device, a bounded number of times', { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    await t.enable('Auto B');
    process.env.FAKE_AGENT_MODE = 'evil';
    const sent = await ask(t.B, 'evil test?');
    await waitFor(() => t.autoLog().some(e => e.status === 'done' || e.status === 'failed'), 15_000);
    const run = t.runs()[0];
    const tries = run.tries;
    for (const k of ['peers', 'secrets', 'intents', 'noReplyTo', 'wrongReplyTo', 'riskyIntent', 'askBack', 'otherDevice']) assert.equal(tries[k].ok, false, `${k}: ${JSON.stringify(tries[k])}`);
    assert.match(tries.riskyIntent.error, /plain text or one of/);
    assert.match(tries.otherDevice.error, /only to the device that asked/);
    assert.deepEqual(tries.secondInbox.result.messages, [], 'a message is shown once');
    assert.equal(tries[`answer-${sent.body.id}`].ok, true);
    const floods = Object.keys(tries).filter(k => k.startsWith('flood-'));
    assert.equal(floods.filter(k => tries[k].ok).length, 1, 'one message: at most two replies');
    assert.match(tries['flood-4'].error, /all the replies/);
    assert.equal((await api(t.C, 'GET', '/api/inbox')).body.messages.length, 0, 'nothing reached C');
    assert.equal((await api(t.B, 'GET', '/api/inbox')).body.messages.every(m => m.auto), true);

    // The person-only settings have no agent route.
    assert.equal((await api(t.A, 'POST', '/ui/autoreply', { device: { id: t.ids['Auto C'], mode: 'questions' } })).status, 401);
    for (const p of ['/api/autoreply', '/api/auto-reply', '/api/settings']) assert.equal((await api(t.A, 'POST', p, {})).status, 404);
  } finally { await t.stop(); }
});

test('limits: runs per hour, quiet hours, one run at a time with a time limit, missing program', { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    await t.enable('Auto B'); await t.enable('Auto C');
    assert.equal((await ui(t.A, 'POST', '/ui/autoreply', { maxPerHour: 2 })).status, 200);
    assert.equal((await ui(t.A, 'POST', '/ui/autoreply', { maxPerHour: 0 })).status, 400);
    assert.equal((await ui(t.A, 'POST', '/ui/autoreply', { quietHours: { from: '25:00', to: '07:00' } })).status, 400);
    for (let i = 1; i <= 3; i++) {
      await ask(t.B, `question ${i}?`);
      await waitFor(() => t.autoLog().length === i && t.autoLog().at(-1).status !== 'running', 15_000);
    }
    assert.deepEqual(t.autoLog().map(e => e.status), ['done', 'done', 'skipped']);
    assert.match(t.autoLog().at(-1).reason, /limit of 2 runs per hour/);

    // Quiet hours that cover now.
    const now = new Date(), hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    assert.equal((await ui(t.A, 'POST', '/ui/autoreply', { quietHours: { from: hhmm(new Date(now - 60_000)), to: hhmm(new Date(+now + 3600_000)) } })).status, 200);
    await ask(t.C, 'at night?');
    await waitFor(() => t.autoLog().length === 4);
    assert.equal(t.autoLog().at(-1).reason, 'quiet hours');
    await ui(t.A, 'POST', '/ui/autoreply', { quietHours: null });

    // One at a time, and a run that hangs is stopped.
    t.settings({ timeoutS: 1 });
    process.env.FAKE_AGENT_MODE = 'sleep';
    await ask(t.C, 'slow 1?');
    await waitFor(() => t.A.auto.running);
    t.settings({ maxPerHour: 10 });
    await ask(t.B, 'slow 2?');
    await settle();
    assert.equal(t.autoLog().filter(e => e.status === 'running').length, 1, 'only one run at a time');
    await waitFor(() => t.autoLog().filter(e => e.status === 'failed').length === 2, 15_000);
    assert.match(t.autoLog().find(e => e.status === 'failed').reason, /stopped after 1 s/);

    // The page shows the log; a missing program is reported, not guessed.
    await ui(t.A, 'POST', '/ui/autoreply', { program: path.join(here, 'no-such-agent.exe') });
    const view = (await ui(t.A, 'GET', '/ui/firewall')).body.autoReply;
    assert.equal(view.programFound, false);
    assert.equal(view.devices.find(d => d.name === 'Auto B').mode, 'questions');
    assert.ok(view.log.length >= 6);
    await ask(t.B, 'nobody home?');
    await waitFor(() => /not found/.test(t.autoLog().at(-1).reason || ''));
  } finally { await t.stop(); }
});
