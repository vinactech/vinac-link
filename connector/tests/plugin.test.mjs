import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tempHome, startDevice, pair, api, waitFor } from './helpers.mjs';
import { AgentApi } from '../src/mcp.js';
import { stopDaemon, sessionStartContext } from '../src/setup.js';
import { isOlderVersion } from '../src/version.js';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');           // plugin root: connector/, lab/, skills/ ...
const BIN = path.join(ROOT, 'connector/bin/vinac.mjs');
const json = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const cli = (...args) => run(process.execPath, [BIN, ...args], { timeout: 20_000 });

test('plugin files: both manifests, MCP configs, hooks and skills point at real files', { timeout: 30_000 }, () => {
  const version = json('connector/package.json').version;
  const claude = json('.claude-plugin/plugin.json');
  const codex = json('.codex-plugin/plugin.json');
  for (const m of [claude, codex]) {
    assert.equal(m.name, 'vinac-link');
    assert.equal(m.version, version, 'manifest version follows connector/package.json');
  }
  const claudeArgs = claude.mcpServers.vinac.args;
  assert.ok(fs.existsSync(claudeArgs[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)));
  const codexMcp = json(codex.mcpServers.replace('./', ''));
  assert.ok(fs.existsSync(codexMcp.mcpServers.vinac.args[0].replace('${PLUGIN_ROOT}', ROOT)));
  assert.ok(!fs.existsSync(path.join(ROOT, '.mcp.json')), 'Claude reads its server from plugin.json only');

  const hook = json('hooks/hooks.json').hooks.SessionStart[0].hooks[0];
  const script = hook.command.match(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)[1];
  assert.ok(fs.existsSync(path.join(ROOT, script)));

  const skills = fs.readdirSync(path.join(ROOT, 'skills'));
  assert.deepEqual(skills.sort(), ['firewall', 'inbox', 'pair', 'secrets', 'send', 'status']);
  for (const s of skills) {
    const text = fs.readFileSync(path.join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    assert.ok(front, `${s}: frontmatter`);
    assert.match(front, new RegExp(`^name: ${s}$`, 'm'));
    assert.match(front, /^description: .{40,}$/m);
  }
  // No skill may tell the agent to handle codes or secret values itself.
  const pairSkill = fs.readFileSync(path.join(ROOT, 'skills/pair/SKILL.md'), 'utf8');
  assert.match(pairSkill, /Never type, guess/);
});

test('marketplaces at the repo root list the plugin (the repo root is the plugin) for Claude Code and Codex; npm package lines up', { timeout: 30_000 }, () => {
  const c = json('.claude-plugin/marketplace.json');
  const o = json('.agents/plugins/marketplace.json');
  assert.equal(c.name, o.name);
  assert.equal(c.plugins[0].name, 'vinac-link');
  assert.equal(path.resolve(ROOT, c.plugins[0].source), ROOT);
  assert.equal(path.resolve(ROOT, o.plugins[0].source.path), ROOT);
  const pkg = json('package.json');
  assert.equal(pkg.name, 'vinac-link');
  assert.equal(pkg.version, json('connector/package.json').version);
  assert.ok(fs.existsSync(path.join(ROOT, pkg.bin.vinac)));
  // Exclusions ("!docs/…") may name files a checkout doesn't have (the public copy leaves internal notes out).
  for (const f of pkg.files.filter(f => !f.startsWith('!'))) assert.ok(fs.existsSync(path.join(ROOT, f)), `package files: ${f}`);
});

test('session-start hook: silent without a daemon, reports unread messages without reading them', { timeout: 30_000 }, async () => {
  const empty = await cli('hook', 'session-start', '--home', tempHome('hook-empty'));
  assert.equal(empty.stdout, '');

  const A = await startDevice('Hook A'), B = await startDevice('Hook B');
  try {
    await pair(A, B);
    assert.equal(await sessionStartContext({ home: A.homeDir }), null, 'nothing to say with no unread messages');
    const sent = await api(B, 'POST', '/api/send', { to: 'Hook A', text: 'hello from B' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const { stdout } = await cli('hook', 'session-start', '--home', A.homeDir);
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /1 unread message from paired devices/);
    assert.doesNotMatch(stdout, /hello from B/, 'the hook never puts message text into context');
    assert.equal((await api(A, 'GET', '/api/status')).body.unreadMessages, 1, 'the hook does not mark messages read');

    const doc = JSON.parse((await cli('doctor', '--json', '--home', A.homeDir)).stdout);
    const labels = doc.map(c => c.label).join('\n');
    assert.match(labels, /Background service running/);
    assert.match(labels, /Paired: Hook B/);
    assert.match(labels, /1 unread message/);
  } finally { await A.stop(); await B.stop(); }
});

async function freePortPair() {
  for (;;) {
    const p = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
    const ok = await new Promise(r => { const s = net.createServer().once('error', () => r(false)).listen(p + 1, '127.0.0.1', () => s.close(() => r(true))); });
    if (ok && p < 65000) return p;
  }
}

test('version compare: older, newer, equal and pre-release', () => {
  assert.ok(isOlderVersion('0.7.0', '0.8.1') && isOlderVersion('0.8.0', '0.8.1') && isOlderVersion('0.9.9', '1.0.0'));
  assert.ok(!isOlderVersion('0.8.1', '0.8.1') && !isOlderVersion('0.9.0', '0.8.1') && !isOlderVersion('1.0.0', '0.10.0'));
  assert.ok(isOlderVersion('0.8.1-beta', '0.8.1') && !isOlderVersion('0.8.1', '0.8.1-beta'));
});

test('`vinac start` after an update replaces an older running service, and leaves a newer one alone', { timeout: 60_000 }, async () => {
  const current = json('connector/package.json').version;
  const env = { ...process.env, VINAC_NO_BROWSER: '1' };
  // Other test files run in parallel and may take a port this one just found free: retry on a new one.
  const startOld = async (home, version) => {
    for (let attempt = 0; ; attempt++) {
      const port = await freePortPair();
      spawn(process.execPath, [BIN, 'daemon', '--home', home, '--port', String(port)], { env: { ...env, VINAC_TEST_VERSION: version }, stdio: 'ignore', detached: true }).unref();
      try { await waitFor(() => new AgentApi({ home, port }).attach(), 12_000); return port; }
      catch (e) { if (attempt >= 2) throw e; }
    }
  };
  const runningVersion = async (home, port) => { const a = new AgentApi({ home, port }); await a.attach(); return (await a.call('GET', '/api/status')).version; };
  const startCli = (home, port) => run(process.execPath, [BIN, 'start', '--home', home, '--port', String(port), '--no-open'], { timeout: 40_000, env });

  const homeOld = tempHome('upd-old'); const homeNew = tempHome('upd-new');
  try {
    const portOld = await startOld(homeOld, '0.1.0');
    assert.equal(await runningVersion(homeOld, portOld), '0.1.0');
    const out = (await startCli(homeOld, portOld)).stdout;
    assert.match(out, new RegExp(`Updating the running VINAC Link from 0\\.1\\.0 to ${current.replace(/\./g, '\\.')}`));
    assert.equal(await runningVersion(homeOld, portOld), current, 'the new version runs now');

    const portNew = await startOld(homeNew, '99.0.0'); // after the first: it holds its ports now
    const out2 = (await startCli(homeNew, portNew)).stdout;
    assert.doesNotMatch(out2, /Updating the running/);
    assert.equal(await runningVersion(homeNew, portNew), '99.0.0', 'a newer service is not replaced');
  } finally {
    await stopDaemon({ home: homeOld }).catch(() => {});
    await stopDaemon({ home: homeNew }).catch(() => {});
  }
});

test('agent tools start the service in the background; it outlives them and `stop` ends it', { timeout: 30_000 }, async () => {
  const home = tempHome('bg');
  const port = await freePortPair();
  const first = new AgentApi({ home, port, name: 'Background test' });
  try {
    // A busy machine can be slow to start a process: allow more time than the default.
    first.startBackground = first.startBackground.bind(first, 20_000);
    assert.equal(await first.connect(), 'started in the background');
    assert.equal(first.daemon, undefined, 'not running inside the agent process');

    const second = new AgentApi({ home, port });
    assert.equal(await second.connect(), 'existing', 'a second agent session reuses it');
    const status = await second.tool('vinac_status');
    assert.equal(status.device.name, 'Background test');
    assert.equal(status.version, JSON.parse(fs.readFileSync(path.join(ROOT, 'connector/package.json'), 'utf8')).version);

    const stopped = await stopDaemon({ home });
    assert.equal(stopped.stopped, true, stopped.message);
    await waitFor(async () => !(await new AgentApi({ home, port }).attach()), 5000);
    assert.equal((await stopDaemon({ home })).stopped, false);
  } finally {
    // Whatever happened above, leave nothing running (an open server keeps the test process alive).
    await first.daemon?.stop();
    await stopDaemon({ home }).catch(() => {});
  }
});
