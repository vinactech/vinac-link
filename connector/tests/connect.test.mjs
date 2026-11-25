// 0.15: connect Claude Code without the `claude` command (all in temporary folders; the real
// ~/.claude is never read or written here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeStatus, connectClaude, disconnectClaude, connectableCopy, hookCommand, PLUGIN_ID } from '../src/connect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-claude-'));
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const NODE = 'C:\\Program Files\\VINAC Link\\node\\node.exe';
const BIN = 'C:\\Program Files\\VINAC Link\\connector\\bin\\vinac.mjs';
const opts = dir => ({ dir, node: NODE, bin: BIN });

test('connect writes an MCP entry and the four hooks with absolute paths, keeping everything else', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects: { a: 1 }, mcpServers: { other: { command: 'x' } } }));
  assert.equal(claudeStatus(opts(dir)).mode, 'none');

  const r = connectClaude(opts(dir));
  assert.equal(r.ok, true); assert.equal(r.mode, 'direct'); assert.equal(r.changed.length, 2);
  const cfg = read(path.join(dir, '.claude.json'));
  assert.deepEqual(cfg.mcpServers.vinac, { type: 'stdio', command: NODE, args: [BIN, 'mcp'], env: {} });
  assert.deepEqual(cfg.projects, { a: 1 }); assert.ok(cfg.mcpServers.other, 'other servers stay');
  const s = read(path.join(dir, 'settings.json'));
  assert.equal(s.theme, 'dark');
  assert.ok(s.hooks.Stop.some(g => g.hooks[0].command === 'echo mine'), 'the person\'s own hooks stay');
  const wait = s.hooks.Stop.find(g => g.hooks[0].command.includes('vinac.mjs')).hooks[0];
  assert.equal(wait.command, '"C:/Program Files/VINAC Link/node/node.exe" "C:/Program Files/VINAC Link/connector/bin/vinac.mjs" hook wait');
  assert.equal(wait.asyncRewake, true);
  assert.ok(fs.existsSync(path.join(dir, 'settings.json.vinac-backup')) && fs.existsSync(path.join(dir, '.claude.json.vinac-backup')), 'originals backed up');
  assert.equal(claudeStatus(opts(dir)).mode, 'direct');

  // Again: nothing changes, and the backup still holds the original.
  const again = connectClaude(opts(dir));
  assert.equal(again.changed.length, 0);
  assert.equal(read(path.join(dir, 'settings.json.vinac-backup')).hooks.Stop.length, 1);
  assert.equal(read(path.join(dir, 'settings.json')).hooks.Stop.length, 2, 'no duplicate hooks');

  // Remove: back to the person's own entries.
  const off = disconnectClaude(opts(dir));
  assert.equal(off.changed.length, 2);
  assert.equal(read(path.join(dir, '.claude.json')).mcpServers.vinac, undefined);
  assert.deepEqual(read(path.join(dir, 'settings.json')).hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] });
});

test('the direct hooks match the plugin\'s hooks (same events, matcher, timeouts, asyncRewake)', () => {
  const dir = tmp();
  connectClaude(opts(dir));
  const mine = read(path.join(dir, 'settings.json')).hooks;
  const plugin = read(path.join(ROOT, 'hooks/hooks.json')).hooks;
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(plugin).sort());
  for (const ev of Object.keys(plugin)) {
    const [p, m] = [plugin[ev][0], mine[ev][0]];
    assert.equal(m.matcher, p.matcher, ev);
    const { command: pc, ...pRest } = p.hooks[0]; const { command: mc, ...mRest } = m.hooks[0];
    assert.deepEqual(mRest, pRest, ev);
    assert.equal(mc.split(' hook ')[1], pc.split(' hook ')[1], ev);
  }
});

test('a hand-made `claude mcp add vinac -- node …` entry is replaced (it had no wake-ups)', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { vinac: { type: 'stdio', command: 'node', args: ['/Applications/VINAC Link.app/Contents/Resources/connector/bin/vinac.mjs', 'mcp'], env: {} } } }));
  const before = claudeStatus(opts(dir));
  assert.equal(before.mode, 'partial'); assert.equal(before.manual, true);
  connectClaude(opts(dir));
  assert.equal(read(path.join(dir, '.claude.json')).mcpServers.vinac.command, NODE);
  assert.equal(claudeStatus(opts(dir)).mode, 'direct');
});

test('with the plugin installed, connect removes the direct entries so no tool shows twice', () => {
  const dir = tmp();
  connectClaude(opts(dir));
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ scope: 'user', version: '0.15.0' }] } }));
  const s = read(path.join(dir, 'settings.json')); s.enabledPlugins = { [PLUGIN_ID]: true }; fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s));
  const r = connectClaude(opts(dir));
  assert.equal(r.mode, 'plugin'); assert.equal(r.changed.length, 2);
  assert.equal(read(path.join(dir, '.claude.json')).mcpServers.vinac, undefined);
  assert.equal(read(path.join(dir, 'settings.json')).hooks, undefined);
  assert.equal(claudeStatus(opts(dir)).plugin.version, '0.15.0');
  assert.equal(connectClaude(opts(dir)).changed.length, 0);
});

test('refuses a copy on a disk image, and broken JSON is left alone', () => {
  assert.match(connectableCopy('/Volumes/VINAC Link/VINAC Link.app/Contents/Resources/connector/bin/vinac.mjs'), /disk image/);
  assert.equal(connectableCopy('/Applications/VINAC Link.app/Contents/Resources/connector/bin/vinac.mjs'), null);
  const dir = tmp();
  const r0 = connectClaude({ dir, node: '/Volumes/x/node', bin: '/Volumes/x/vinac.mjs' });
  assert.equal(r0.ok, false); assert.equal(fs.existsSync(path.join(dir, '.claude.json')), false);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
  const r = connectClaude(opts(dir));
  assert.equal(r.ok, false); assert.match(r.message, /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ not json');
});

test('hook commands quote paths with spaces and use forward slashes', () => {
  assert.equal(hookCommand('prompt', { node: '/Applications/VINAC Link.app/node', bin: '/a b/vinac.mjs' }), '"/Applications/VINAC Link.app/node" "/a b/vinac.mjs" hook prompt');
});

test('the page connects Claude Code; agents cannot', async () => {
  const dir = tmp();
  process.env.VINAC_CLAUDE_DIR = dir;
  const { startDevice, api, ui } = await import('./helpers.mjs');
  const A = await startDevice('A');
  try {
    assert.ok((await api(A, 'POST', '/ui/connect/claude', {})).status >= 400, 'agent token refused');
    const st = (await ui(A, 'GET', '/ui/connect/claude')).body;
    assert.equal(st.mode, 'none'); assert.equal(st.dismissed, false);
    const r = (await ui(A, 'POST', '/ui/connect/claude', {})).body;
    assert.equal(r.mode, 'direct');
    assert.equal(read(path.join(dir, '.claude.json')).mcpServers.vinac.command, process.execPath);
    await ui(A, 'POST', '/ui/connect/claude', { dismiss: true });
    assert.equal((await ui(A, 'GET', '/ui/connect/claude')).body.dismissed, true);
    await ui(A, 'POST', '/ui/connect/claude', { remove: true });
    assert.equal(read(path.join(dir, '.claude.json')).mcpServers.vinac, undefined);
  } finally { await A.stop?.(); delete process.env.VINAC_CLAUDE_DIR; }
});
