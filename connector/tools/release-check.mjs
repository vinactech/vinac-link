#!/usr/bin/env node
// Checks that VINAC Link is ready to release. Publishes nothing and pushes nothing.
//   node connector/tools/release-check.mjs [--skip-tests] [--tag]
// 1. every manifest has the same version, and CHANGELOG.md has a section for it
// 2. the test suite passes (skip with --skip-tests, e.g. when CI ran it already)
// 3. `claude plugin validate .` passes without warnings (skipped if no claude CLI; set CLAUDE_BIN)
// 4. `npm pack` holds what the product needs and nothing internal
// 5. the packed file installs into a temp folder and runs there: version, MCP handshake, the page
//    and the sound modem files it serves. Temp home, random ports, plain-file key store, so a
//    VINAC Link or AgentLink service already running on this computer is never touched.
// --tag: with a clean tree, also creates the local tag v<version> (never pushed).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
const json = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const failures = [];
const step = (name) => console.log(`\n== ${name}`);
const ok = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures.push(msg); console.log(`  FAIL ${msg}`); };
const skip = (msg) => console.log(`  skip ${msg}`);

// npm: through the running npm when started by `npm run`, else the npm next to node.
function npm(npmArgs, opts = {}) {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith('.js')) return spawnSync(process.execPath, [cli, ...npmArgs], { encoding: 'utf8', ...opts });
  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });
}

// 1. Versions
step('Versions');
const version = json('package.json').version;
const manifests = ['connector/package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
  'openclaw/node/package.json', 'openclaw/node/openclaw.plugin.json',
  'openclaw/gateway/package.json', 'openclaw/gateway/openclaw.plugin.json'];
for (const f of manifests) {
  const v = json(f).version;
  if (v === version) ok(`${f} ${v}`); else fail(`${f} is ${v}, package.json is ${version}`);
}
// The changelog is internal (not in the public repository copy): checked only where it exists.
if (!fs.existsSync(path.join(ROOT, 'CHANGELOG.md'))) skip('no CHANGELOG.md (public repository copy)');
else {
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) ok(`CHANGELOG.md has ${version}`);
  else fail(`CHANGELOG.md has no "## ${version}" section`);
}

// 2. Tests
step('Tests');
if (args.has('--skip-tests')) skip('--skip-tests');
else {
  const log = path.join(os.tmpdir(), `vinac-release-tests-${process.pid}.log`);
  const out = fs.openSync(log, 'w');
  const r = npm(['test', '--prefix', 'connector'], { cwd: ROOT, stdio: ['ignore', out, out] });
  fs.closeSync(out);
  const text = fs.readFileSync(log, 'utf8');
  const pass = text.match(/^(?:#|ℹ) pass (\d+)/m)?.[1], failed = text.match(/^(?:#|ℹ) fail (\d+)/m)?.[1];
  if (r.status === 0) ok(`${pass} passed`); else fail(`tests failed (${failed ?? '?'} failing); log: ${log}`);
}

// 3. Plugin validation
step('Claude Code plugin');
const claude = process.env.CLAUDE_BIN || (spawnSync('claude', ['--version'], { shell: process.platform === 'win32' }).status === 0 ? 'claude' : null);
if (!claude) skip('no claude CLI found (set CLAUDE_BIN to its path)');
else {
  const r = spawnSync(claude, ['plugin', 'validate', '.'], { cwd: ROOT, encoding: 'utf8', shell: claude === 'claude' && process.platform === 'win32' });
  const text = `${r.stdout}${r.stderr}`;
  if (r.status !== 0) fail(`plugin validate failed:\n${text}`);
  else if (/warning/i.test(text)) fail(`plugin validate passed with warnings:\n${text}`);
  else ok('plugin validate passed, no warnings');
}

// 4. Package contents
step('npm package');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-release-'));
const packed = npm(['pack', '--json', '--pack-destination', work], { cwd: ROOT });
let tarball = null;
if (packed.status !== 0) fail(`npm pack failed: ${packed.stderr}`);
else {
  const info = JSON.parse(packed.stdout)[0];
  tarball = path.join(work, info.filename);
  const files = new Set(info.files.map(f => f.path));
  ok(`${info.filename}: ${info.entryCount} files, ${(info.size / 1024).toFixed(0)} KB`);
  const required = ['connector/bin/vinac.mjs', 'connector/src/daemon.js', 'connector/src/autoreply.js',
    'connector/src/watch.js', 'connector/web/index.html', 'connector/web/app.js', 'lab/js/modem.js',
    'lab/worklets/vinac-tx-processor.js', 'lab/worklets/vinac-rx-processor.js', 'skills/inbox/SKILL.md',
    'hooks/hooks.json', 'monitors/monitors.json', '.claude-plugin/plugin.json', '.claude-plugin/icon.png',
    '.codex-plugin/plugin.json', 'codex.mcp.json', 'openclaw/gateway/frontdesk.js', 'openclaw/node/commands.js',
    'LICENSE', 'NOTICE', 'README.md', 'SECURITY.md', 'connector/web/icon.png'];
  const missing = required.filter(f => !files.has(f));
  if (missing.length) fail(`missing from the package: ${missing.join(', ')}`); else ok(`${required.length} required files present`);
  const internal = [...files].filter(f => /(^|\/)tests?\/|fixtures\/|^docs\/(LAUNCH|ROADMAP)\.md$|^CHANGELOG\.md$|CLAUDE\.md$|^\.claude\/|^\.private\/|^site\/|^\.github\/|^connector\/tools\/|(^|\/)\.env(?!\.example)|\.log$|^scratch\//.test(f));
  if (internal.length) fail(`internal files in the package: ${internal.join(', ')}`); else ok('no tests, internal docs, tools or env files');
  if (info.size > 1024 * 1024) fail(`package is ${(info.size / 1048576).toFixed(1)} MB (limit 1 MB)`);
}

// 5. Install and run the packed file
step('Install and run the package');
if (!tarball) skip('no package');
else {
  const app = path.join(work, 'app'), home = path.join(work, 'home');
  fs.mkdirSync(app); fs.mkdirSync(home);
  fs.writeFileSync(path.join(app, 'package.json'), '{ "private": true }\n');
  const inst = npm(['install', tarball, '--no-audit', '--no-fund', '--ignore-scripts', '--prefer-offline'], { cwd: app });
  const bin = path.join(app, 'node_modules', 'vinac-link', 'connector', 'bin', 'vinac.mjs');
  if (inst.status !== 0 || !fs.existsSync(bin)) fail(`install failed: ${inst.stderr}`);
  else {
    ok('installed into a temp folder');
    const env = { ...process.env, VINAC_KEYSTORE: 'file', VINAC_NO_BROWSER: '1', VINAC_LAN_HOST: '127.0.0.1', VINAC_PORT: '0' };
    const v = spawnSync(process.execPath, [bin, 'version'], { encoding: 'utf8', env });
    if (v.stdout.trim() === version) ok(`vinac version: ${version}`); else fail(`vinac version printed "${v.stdout.trim()}"`);
    try { await smoke(bin, home, env); } catch (e) { fail(`installed package: ${e.message}`); }
    spawnSync(process.execPath, [bin, 'stop', '--home', home], { env, encoding: 'utf8' });
  }
}

async function smoke(bin, home, env) {
  const child = spawn(process.execPath, [bin, 'mcp', '--home', home, '--port', '0'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', next = 1;
  const waiting = new Map();
  child.stdout.on('data', d => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
    waiting.set(id, m => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'release-check', version } });
    const tools = (await call('tools/list', {})).result.tools.map(t => t.name);
    if (tools.length === 10) ok(`MCP handshake, ${tools.length} tools`); else fail(`MCP lists ${tools.length} tools: ${tools.join(', ')}`);
    const status = JSON.parse((await call('tools/call', { name: 'vinac_status', arguments: {} })).result.content[0].text);
    const page = new URL(status.approvalPage);
    for (const p of ['/', '/web/app.js', '/web/styles.css','/lab/js/modem.js', '/lab/js/audio.js', '/lab/worklets/vinac-tx-processor.js', '/lab/worklets/vinac-rx-processor.js']) {
      const r = await fetch(new URL(p, page.origin));
      if (r.ok) ok(`page serves ${p}`); else fail(`page ${p}: HTTP ${r.status}`);
    }
  } finally {
    child.stdin.end();
    await new Promise(r => { child.on('exit', r); setTimeout(() => { child.kill(); r(); }, 5000); });
  }
}

// Tag
if (args.has('--tag')) {
  step('Tag');
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const exists = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/v${version}`], { cwd: ROOT }).status === 0;
  if (failures.length) skip('checks failed, no tag');
  else if (dirty) fail('uncommitted changes, no tag');
  else if (exists) skip(`v${version} already exists`);
  else {
    const t = spawnSync('git', ['tag', '-a', `v${version}`, '-m', `VINAC Link ${version}`], { cwd: ROOT, encoding: 'utf8' });
    if (t.status === 0) ok(`tagged v${version} locally (not pushed)`); else fail(`git tag: ${t.stderr}`);
  }
}

fs.rmSync(work, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} problem(s); not ready to release.` : `\nReady: VINAC Link ${version}. Nothing was published or pushed.`);
process.exit(failures.length ? 1 : 0);
