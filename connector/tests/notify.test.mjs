// 0.14 step 1: wake-up hooks and desktop notifications (no real notification is shown here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevice, pair, api, ui, waitFor } from './helpers.mjs';
import { describe as notice, Notifier, showDesktop, readNotifySettings } from '../src/notify.js';
import { noteHook, waitHook, newLines, readState } from '../src/hooks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('plugin hooks: prompt, tool and an asyncRewake Stop hook run `vinac hook` from the plugin root', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8')).hooks;
  const cmd = ev => h[ev][0].hooks[0];
  assert.match(cmd('UserPromptSubmit').command, /vinac\.mjs" hook prompt$/);
  assert.match(cmd('PostToolUse').command, /vinac\.mjs" hook tool$/);
  assert.match(cmd('Stop').command, /vinac\.mjs" hook wait$/);
  assert.equal(cmd('Stop').asyncRewake, true);
  assert.ok(cmd('Stop').timeout > 1200, 'the waiter (20 min) ends before its timeout');
  for (const ev of ['UserPromptSubmit', 'PostToolUse']) assert.ok(cmd(ev).timeout <= 5);
});

test('notification texts: device and kind, never message text; names cleaned', () => {
  const m = { dir: 'in', peer: { name: 'Mac"; rm -rf ~' }, text: 'SECRET-TEXT-1' };
  assert.deepEqual(notice(m), { title: 'VINAC Link', body: 'New message from Mac rm -rf.' });
  assert.match(notice({ ...m, intent: 'agent.room.post', args: { name: 'Launch <b>' } }).title, /^Room: Launch b$/);
  assert.equal(notice({ ...m, firewall: { status: 'pending' } }).title, 'Waiting for your approval');
  for (const v of [notice(m), notice({ ...m, intent: 'agent.question.ask', args: { question: 'Q-TEXT' } })]) assert.doesNotMatch(JSON.stringify(v), /SECRET-TEXT|Q-TEXT/);
});

test('desktop helper: texts travel in environment variables, never in the command', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    let call;
    showDesktop({ title: 'T-1', body: 'B-2' }, { platform, run: (file, args, opts) => { call = { file, args, opts }; } });
    assert.equal(call.opts.env.VINAC_N_TITLE, 'T-1');
    assert.equal(call.opts.env.VINAC_N_BODY, 'B-2');
    if (platform !== 'linux') assert.doesNotMatch(call.args.join(' '), /T-1|B-2/, platform);
  }
});

test('notifier: a burst becomes one notification; off when the person turns it off', async () => {
  const A = await startDevice('Notify A'), B = await startDevice('Notify B');
  const shown = [];
  A.notifier.enabled = true; A.notifier.show = n => shown.push(n); A.notifier.gapMs = 1500;
  try {
    await pair(A, B);
    await api(B, 'POST', '/api/send', { to: 'Notify A', text: 'one' });
    await waitFor(() => shown.length === 1);
    assert.deepEqual(shown[0], { title: 'VINAC Link', body: 'New message from Notify B.' });
    await api(B, 'POST', '/api/send', { to: 'Notify A', text: 'two' });
    await api(B, 'POST', '/api/send', { to: 'Notify A', text: 'three' });
    await waitFor(() => shown.length === 2);
    assert.match(shown[1].body, /^2 new items/);
    // The person turns desktop notifications off on the page; agents have no route for it.
    assert.equal((await ui(A, 'POST', '/ui/notify', { desktop: false })).status, 200);
    assert.equal(readNotifySettings(A.homeDir).desktop, false);
    assert.equal((await api(A, 'POST', '/ui/notify', { desktop: true })).status >= 400, true);
    A.notifier.lastAt = 0;
    await api(B, 'POST', '/api/send', { to: 'Notify A', text: 'four' });
    await new Promise(r => setTimeout(r, 300));
    assert.equal(shown.length, 2);
    assert.equal((await ui(A, 'POST', '/ui/notify', { wakesPerHour: 0 })).status, 400);
  } finally { await A.stop(); await B.stop(); }
});

test('hooks: prompt and tool notes name the device or room once; idle waiter wakes once, then respects budget and the switch', async () => {
  const A = await startDevice('Hook A'), B = await startDevice('Hook B');
  try {
    await pair(A, B);
    const home = A.homeDir, input = { session_id: 'sess-1' };
    assert.deepEqual(await noteHook('prompt', { home, input }), []);
    await api(B, 'POST', '/api/send', { to: 'Hook A', text: 'TEXT-NEVER-SHOWN' });
    const lines = await noteHook('prompt', { home, input });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /new message from "Hook B"/);
    assert.doesNotMatch(lines[0], /TEXT-NEVER-SHOWN/);
    assert.deepEqual(await noteHook('prompt', { home, input }), [], 'reported once per session');
    assert.deepEqual(await noteHook('tool', { home, input }), [], 'tool notes at most every 15 s');

    // A room post names the room.
    assert.equal((await ui(B, 'POST', '/ui/rooms', { name: 'Launch', members: ['Hook A'] })).status, 200);
    const waiting = waitHook({ home, input, totalMs: 8000, pollS: 1 });
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await api(B, 'POST', '/api/send', { room: 'Launch', text: 'ROOM-TEXT' })).status, 200);
    const woke = await waiting;
    assert.equal(woke.length, 1);
    assert.match(woke[0], /new post in room "Launch" from "Hook B"/);
    assert.equal(readState(home, 'sess-1').wakes.length, 1);

    // A newer waiter (or the person typing) supersedes an older one.
    const older = waitHook({ home, input, totalMs: 4000, pollS: 1 });
    await new Promise(r => setTimeout(r, 200));
    await noteHook('prompt', { home, input });
    await api(B, 'POST', '/api/send', { to: 'Hook A', text: 'x' });
    assert.deepEqual(await older, []);

    // Waking off on the page: the waiter ends quietly.
    assert.equal((await ui(A, 'POST', '/ui/notify', { wakeAgents: false })).status, 200);
    const off = waitHook({ home, input: { session_id: 'sess-2' }, totalMs: 4000, pollS: 1 });
    await api(B, 'POST', '/api/send', { to: 'Hook A', text: 'y' });
    assert.deepEqual(await off, []);

    // Budget: with 1 wake-up per hour used, the next item is left for the next prompt.
    assert.equal((await ui(A, 'POST', '/ui/notify', { wakeAgents: true, wakesPerHour: 1 })).status, 200);
    const over = waitHook({ home, input, totalMs: 4000, pollS: 1 });
    await new Promise(r => setTimeout(r, 300));
    await api(B, 'POST', '/api/send', { to: 'Hook A', text: 'z' });
    assert.deepEqual(await over, []);
  } finally { await A.stop(); await B.stop(); }
});

test('hook lines: ids reported once, waiting count only when it grows', () => {
  const st = { seen: [], waiting: 0 };
  assert.equal(newLines({ unread: [{ id: 'a1', peer: { name: 'M' } }], waitingForPerson: 1 }, st).length, 2);
  assert.deepEqual(newLines({ unread: [{ id: 'a1', peer: { name: 'M' } }], waitingForPerson: 1 }, st), []);
});

test('notifier is off in tests unless asked', () => {
  assert.equal(new Notifier({ home: '.' }).enabled, false);
});
