#!/usr/bin/env node
// vinac start  [--name NAME]                       start the service in the background, open the page, show next steps (default)
// vinac setup                                      how to connect Claude Code, Codex, OpenClaw, LM Studio, Goose or any MCP app (changes nothing)
// vinac daemon [--home DIR] [--port N] [--name NAME] [--host IP] [--open]   run the service in this window
// vinac mcp    [--home DIR] [--port N] [--simple]  agent tools over stdio (starts the service in the background if needed)
// vinac status [--home DIR]                        this device, pairing and unread count (starts the service if needed)
// vinac doctor [--home DIR] [--json]               check everything; changes nothing
// vinac stop   [--home DIR]                        stop the background service
// vinac open   [--home DIR]                        open the VINAC Link page in the browser
// vinac hook session-start [--home DIR]            used by the plugin's session-start hook
// vinac watch  [--home DIR]                        one line per new item, never the text (the plugin's monitor)
// vinac send-file PATH [--to DEVICE] [--text T]    send a file up to 64 MB
// vinac files                                      files received (that the firewall let through)
// vinac file save ID [--out DIR]                   save a received file
// vinac git send [--to D] [--branch B] [--since REF] [--all] [--repo DIR]   send a branch as a git bundle
// vinac git fetch ID [--repo DIR]                  add a received bundle's branches as vinac/<device>/<branch>
// vinac group list | set NAME DEV1,DEV2 | remove NAME   names for sets of devices ("to": the group name)
// vinac audit  [--verify] [--last N] [--json]      the hash-chained log of what happened (no message text)
//   [--from DATE] [--to DATE] [--category C] [--who person|agent|device|service] [--agent NAME] [--device NAME] [--q TEXT]
//   --csv (all matching, as CSV)   --check-report FILE (checks a signed report exported from the page)
// vinac run --secret NAME[=ENV] ... [--show-output] -- COMMAND ARGS   run a program with secrets in its environment (approved on the page); values it prints show as [hidden: NAME]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Daemon, DEFAULT_PORT } from '../src/daemon.js';
import { runMcpServer, AgentApi, VERSION } from '../src/mcp.js';
import { openApp, openInBrowser } from '../src/net.js';
import { doctor, formatChecks, stopDaemon, runHook, setupText } from '../src/setup.js';
import { env } from '../src/env.js';
import { isOlderVersion } from '../src/version.js';
import { defaultHome } from '../src/store.js';
import { redactor } from '../src/redact.js';
import {macLifecycleAvailable,managedConnect,readOnlyStartupDiagnostics,withLaunchLock} from '../src/mac-lifecycle.js';
import {maybeInstallFromVolume} from '../src/mac-install.js';

const [command = 'start', ...rest] = process.argv.slice(2);
const FLAGS = new Set(['open', 'tab', 'json', 'no-open', 'simple', 'verify', 'all', 'show-output', 'csv', 'recover', 'force-recovery', 'sample']);
const REPEAT = new Set(['secret']);
const opt = { _: [], cmd: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--') { opt.cmd = rest.slice(i + 1); break; }
  if (!rest[i].startsWith('--')) { opt._.push(rest[i]); continue; }
  const k = rest[i].slice(2);
  if (FLAGS.has(k)) opt[k] = true;
  else if (REPEAT.has(k)) (opt[k] ||= []).push(rest[++i]);
  else opt[k] = rest[++i];
}
const home = opt.home || undefined;
const port = opt.port ? Number(opt.port) : Number(env('PORT') || DEFAULT_PORT);

const fail = msg => { console.error(`vinac: ${msg}`); process.exit(1); };
async function connected() {
  const api = new AgentApi({ home, port, name: opt.name });
  await api.connect();
  return api;
}
const kb = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
function printSent(r) {
  if (r.results) for (const x of r.results) console.log(`${x.sent ? 'sent    ' : 'FAILED  '} ${x.to}${x.error ? `: ${x.error}` : ''}`);
  else console.log(`Sent to ${r.peer?.name} (id ${r.id}).${r.note ? ` ${r.note}` : ''}`);
}

try {
  if (command === 'start') {
    const api = new AgentApi({ home, port, name: opt.name });
    if(macLifecycleAvailable() && await maybeInstallFromVolume({api,version:VERSION,explicitHome:!!opt.home,noOpen:!!opt['no-open'],openPage:opt.tab?openInBrowser:openApp})) process.exit(0);
    // After an update, an older service may still be running from before: replace it with this
    // version. Pairings, keys and messages live in the home folder and are kept. A newer running
    // service is left alone.
    if (!macLifecycleAvailable() && await api.attach()) {
      const running = (await api.call('GET', '/api/status', null, 2000).catch(() => ({}))).version;
      if (running && isOlderVersion(running, VERSION)) {
        console.log(`Updating the running VINAC Link from ${running} to ${VERSION} ...`);
        await stopDaemon({ home });
        for (const until = Date.now() + 10_000; Date.now() < until && await api.attach();) await new Promise(r => setTimeout(r, 200));
      }
    }
    const how = macLifecycleAvailable() ? await managedConnect(api,{upgrade:true,version:VERSION,recover:!!opt.recover,force:!!opt['force-recovery'],expectedInstance:opt['recover-instance']}) : await api.connect();
    const s = await api.tool('vinac_status');
    if (!opt['no-open']) (opt.tab ? openInBrowser : openApp)(s.approvalPage);
    console.log(`VINAC Link ${s.version||VERSION} is running (${how}).
  This device: ${s.device.name}  ·  ${s.device.fingerprint}
  Address:     ${s.device.address || 'no network found (connect Wi-Fi, a hotspot or a cable)'}
  Page:        ${s.approvalPage}
  Paired:      ${s.peers} device(s)

Next: pair another computer on the page, then connect your agent:
  vinac setup`);
    await api.daemon?.stop();
  } else if (command === 'diagnose-startup') {
    if(!macLifecycleAvailable()) throw Error('Native startup diagnostics are available in the macOS installer.');
    console.log(JSON.stringify(await readOnlyStartupDiagnostics(home||defaultHome(),opt.port?port:undefined,{sample:!!opt.sample}),null,2));
  } else if (command === 'setup') {
    console.log(setupText());
  } else if (command === 'daemon') {
    const runDaemon=async()=>{
    const d = await new Daemon({ home, port, name: opt.name, host: opt.host }).start();
    console.error(`[vinac] approval page: ${d.uiUrl}  (Ctrl+C to stop)`);
    if (opt.open) (opt.tab ? openInBrowser : openApp)(d.uiUrl);
    await new Promise(resolve=>{
      const stop=async()=>{await d.stop();resolve();};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    });
    };
    if(macLifecycleAvailable())await withLaunchLock(home||defaultHome(),runDaemon,{timeout:1500,lockName:'.daemon.lock'});
    else await runDaemon();
  } else if (command === 'mcp') {
    await runMcpServer({ home, port, name: opt.name, simple: !!opt.simple });
  } else if (command === 'status' || command === 'open') {
    const api = new AgentApi({ home, port, name: opt.name });
    const how = await api.connect();
    const s = await api.tool('vinac_status');
    if (command === 'open') { (opt.tab ? openInBrowser : openApp)(s.approvalPage); console.log(s.approvalPage); }
    else console.log(JSON.stringify({ daemon: how, ...s }, null, 2));
    await api.daemon?.stop();
  } else if (command === 'doctor') {
    const checks = await doctor({ home });
    console.log(opt.json ? JSON.stringify(checks, null, 2) : formatChecks(checks));
  } else if (command === 'stop') {
    console.log((await stopDaemon({ home,force:!!opt['force-recovery'],expectedInstance:opt['recover-instance'] })).message);
  } else if (command === 'hook') {
    await runHook(opt._[0], { home });
  } else if (command === 'watch') {
    const { watch } = await import('../src/watch.js');
    const stop = new AbortController();
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => stop.abort());
    await watch({ home, signal: stop.signal });
  } else if (command === 'send-file') {
    const file = opt._[0];
    if (!file) fail('usage: vinac send-file PATH [--to DEVICE] [--text "note"]');
    const st = fs.statSync(file);
    if (!st.isFile()) fail(`${file} is not a file.`);
    const api = await connected();
    console.error(`Sending ${path.basename(file)} (${kb(st.size)})…`);
    printSent(await api.upload('/api/send-file', { to: opt.to, room: opt.room, name: path.basename(file), text: opt.text }, fs.readFileSync(file)));
    await api.daemon?.stop();
  } else if (command === 'files') {
    const api = await connected();
    const { files } = await api.call('GET', '/api/files');
    if (opt.json) console.log(JSON.stringify(files, null, 2));
    else if (!files.length) console.log('No received files.');
    else for (const f of files) console.log(`${f.id}  ${kb(f.size).padStart(8)}  ${f.name}  from ${f.from.name}, ${new Date(f.receivedAt).toLocaleString()}`);
    await api.daemon?.stop();
  } else if (command === 'file') {
    const [sub, id] = opt._;
    if (sub !== 'save' || !id) fail('usage: vinac file save ID [--out DIR]');
    const api = await connected();
    const f = await api.download(id);
    const dir = path.resolve(opt.out || '.');
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(f.name), base = path.basename(f.name, ext);
    let target = path.join(dir, f.name);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base} (${n})${ext}`); // never overwrite
    fs.writeFileSync(target, f.bytes);
    console.log(`Saved ${target} (${kb(f.bytes.length)}, sha256 ${f.sha256?.slice(0, 16)}…). It came from another device: check it before you use it.`);
    await api.daemon?.stop();
  } else if (command === 'git') {
    const { makeBundle, fetchBundle } = await import('../src/gitsync.js');
    const [sub, id] = opt._;
    const repo = opt.repo ? path.resolve(opt.repo) : process.cwd();
    if (sub === 'send') {
      const b = makeBundle({ repo, branch: opt.branch, since: opt.since, all: !!opt.all });
      const api = await connected();
      console.error(`Sending ${b.name} (${kb(b.bytes.length)})…`);
      printSent(await api.upload('/api/send-file', { to: opt.to, name: b.name, text: b.text, mime: 'application/x-git-bundle' }, b.bytes));
      await api.daemon?.stop();
    } else if (sub === 'fetch' && id) {
      const api = await connected();
      const { files } = await api.call('GET', '/api/files');
      const meta = files.find(f => f.id === id);
      if (!meta) fail('No received file with that id (see vinac files).');
      const f = await api.download(id);
      const refs = fetchBundle({ repo, bytes: f.bytes, device: meta.from.name });
      console.log(`Fetched from ${meta.from.name} (nothing checked out or merged):`);
      for (const r of refs) console.log(`  ${r.ref}  ${r.commit}`);
      console.log(`Review: git log --oneline ..${refs[0].ref}   ·   git diff ...${refs[0].ref}`);
      await api.daemon?.stop();
    } else fail('usage: vinac git send [--to DEVICE] [--branch B] [--since REF] [--all]   |   vinac git fetch ID');
  } else if (command === 'group') {
    const [sub, name, members] = opt._;
    const api = await connected();
    let groups;
    if (!sub || sub === 'list') ({ groups } = await api.call('GET', '/api/groups'));
    else if (sub === 'set' && name && members) ({ groups } = await api.call('POST', '/api/groups', { name, members: members.split(',').map(s => s.trim()).filter(Boolean) }));
    else if (sub === 'remove' && name) ({ groups } = await api.call('POST', '/api/groups', { name, members: null }));
    else fail('usage: vinac group list | vinac group set NAME "PC 1,PC 2" | vinac group remove NAME');
    if (!groups.length) console.log('No groups. Make one: vinac group set build "PC 1,PC 2"');
    for (const g of groups) console.log(`${g.name}: ${g.devices.map(d => d.name).join(', ') || '(no paired devices left)'}`);
    await api.daemon?.stop();
  } else if (command === 'audit') {
    const { AuditLog } = await import('../src/audit.js');
    const log = new AuditLog(home || defaultHome());
    const compliance = await import('../src/compliance.js');
    const filters = Object.fromEntries(['from', 'to', 'category', 'who', 'agent', 'device', 'q'].filter(k => opt[k]).map(k => [k, opt[k]]));
    if (opt['check-report']) {
      // A signed report exported from the page (Activity log > Report > JSON): checks the device's
      // signature and that no entry was changed.
      const fs = await import('node:fs');
      const r = compliance.checkReport(JSON.parse(fs.readFileSync(opt['check-report'], 'utf8')));
      console.log(r.ok ? `OK: signed by "${r.device.name}" (${r.device.fingerprint}) on ${r.generatedAt}; ${r.count} entries, unchanged.${r.chainOk ? '' : ' (Its chain was already broken when it was made.)'}` : `NOT OK: ${r.problem}`);
      if (!r.ok) process.exitCode = 2;
    } else if (opt.csv) {
      const r = compliance.query(log, filters, { limit: 1_000_000 });
      process.stdout.write(compliance.toCsv(r.entries.reverse()));
    } else if (opt.verify) {
      const v = log.verify();
      console.log(v.ok ? `OK: ${v.count} entries, chain intact. Latest hash: ${v.head}` : `BROKEN at ${v.file} line ${v.line}: ${v.problem} (${v.count} entries checked before it).`);
      if (!v.ok) process.exitCode = 2;
    } else {
      const entries = Object.keys(filters).length
        ? compliance.query(log, filters, { limit: Number(opt.last) || 30 }).entries.reverse().map(v => ({ at: v.at, type: v.type, ...v.fields }))
        : log.tail(Number(opt.last) || 30);
      if (opt.json) console.log(JSON.stringify(entries, null, 2));
      else if (!entries.length) console.log('The audit log is empty.');
      else for (const e of entries) {
        const { at, type, prev, hash, ...f } = e;
        const who = f.peer?.name ? ` ${f.peer.name}` : '';
        delete f.peer;
        console.log(`${new Date(at).toLocaleString()}  ${type.padEnd(16)}${who}  ${Object.entries(f).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`);
      }
    }
  } else if (command === 'keys') {
    // vinac keys check [--env dev|prod]: what this folder's project needs (vinac.keys.json) and what's missing here.
    if (opt._[0] !== 'check') fail('usage: vinac keys check [--env dev|prod]');
    const api = await connected();
    const r = await api.call('GET', `/api/keys/check?cwd=${encodeURIComponent(process.cwd())}&env=${encodeURIComponent(opt.env || 'dev')}`);
    if (opt.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(r.project ? `Project: ${r.project} (${r.env})` : 'This folder is not in a VINAC Link project (set one on the page: Secrets › Projects).');
      if (r.manifest) console.log(`Needed (${r.manifest}): ${r.needed.join(', ') || 'none'}`);
      else console.log('No vinac.keys.json here: list the key NAMES the project needs, e.g. {"dev": ["SUPABASE_URL"], "prod": []}.');
      if (r.missing?.length) console.log(`Missing on this device: ${r.missing.join(', ')}. Ask for them on the page, or post a key request card in the project's room.`);
      else if (r.manifest) console.log('All needed keys are on this device.');
    }
    await api.daemon?.stop();
  } else if (command === 'run') {
    if (!opt.cmd.length) fail('usage: vinac run [--secret NAME[=ENV_VAR] ...] [--env dev|prod] -- COMMAND [ARGS]   (no --secret: the keys vinac.keys.json lists)');
    const api = await connected();
    let names = opt.secret || [];
    if (!names.length) {
      const k = await api.call('GET', `/api/keys/check?cwd=${encodeURIComponent(process.cwd())}&env=${encodeURIComponent(opt.env || 'dev')}`);
      if (!k.manifest) fail('Name the keys with --secret NAME, or add a vinac.keys.json to the project folder.');
      if (k.missing.length) fail(`Missing on this device: ${k.missing.join(', ')} (vinac keys check).`);
      names = k.needed;
      if (!names.length) fail(`vinac.keys.json lists no keys for ${k.env}.`);
    }
    const wanted = names.map(s => { const [name, as] = s.split('='); return { name, as: as || name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }; });
    const ask = await api.call('POST', '/api/secret-use', { names: wanted.map(w => w.name), command: opt.cmd, cwd: process.cwd(), env: opt.env || 'dev', envNames: Object.fromEntries(wanted.map(w => [w.name, w.as])) });
    if (ask.status === 'granted') {
      // A standing grant covers this run: VINAC Link starts the program itself and streams its
      // output (values hidden). The values never reach this process. No stdin; Ctrl-C stops it.
      console.error(`Allowed by a standing grant (until ${new Date(ask.grant.expiresAt).toLocaleString()}). VINAC Link starts it; output follows.`);
      let code = 1;
      for await (const m of api.stream('/api/secret-run', { id: ask.id })) {
        if (m.out) process.stdout.write(m.out);
        else if (m.err) process.stderr.write(m.err);
        else if (m.exit !== undefined) code = m.exit;
      }
      await api.daemon?.stop();
      process.stdout.write('', () => process.exit(code));
      await new Promise(() => {});
    }
    console.error(`Waiting for approval on the VINAC Link page (Secrets): ${ask.approvalPage}`);
    let r = { status: 'pending' };
    for (const until = Date.now() + 130_000; r.status === 'pending' && Date.now() < until;) r = await api.call('GET', `/api/secret-use?id=${ask.id}&wait=25`, null, 40_000);
    if (r.status !== 'approved') fail(r.status === 'denied' ? 'Not approved.' : 'No answer on the page in time.');
    const childEnv = { ...process.env };
    for (const w of wanted) childEnv[w.as] = r.values[w.name];
    await api.daemon?.stop();
    const [cmd, ...args] = opt.cmd;
    // Windows: npm, npx and other .cmd files need cmd.exe; quote each argument ourselves.
    const winQuote = a => (/^[\w./:=@+-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
    // By default the program's output passes through a filter that hides the values
    // ([hidden: NAME]). --show-output keeps the terminal as is (colours, prompts).
    const stdio = opt['show-output'] ? 'inherit' : ['inherit', 'pipe', 'pipe'];
    const child = process.platform === 'win32'
      ? spawn([cmd, ...args].map(winQuote).join(' '), { stdio, env: childEnv, shell: true })
      : spawn(cmd, args, { stdio, env: childEnv });
    if (!opt['show-output']) {
      const values = Object.fromEntries(wanted.map(w => [w.name, r.values[w.name]]));
      child.stdout.pipe(redactor(values)).pipe(process.stdout);
      child.stderr.pipe(redactor(values)).pipe(process.stderr);
    }
    child.on('error', e => fail(`could not start ${cmd}: ${e.message}`));
    // 'close' comes after the output is through the filter; then let it reach the terminal before exiting.
    child.on('close', code => process.stdout.write('', () => process.stderr.write('', () => process.exit(code ?? 1))));
  } else if (command === 'join') {
    // An invite made by a person on another device ("Invite a device" on its page). Redeeming it pairs
    // this device with that one; the code works once, for 10 minutes.
    const code = opt._.join('');
    if (!code) fail('usage: vinac join <invite code>   (make one on the other device: Pair a device > Invite a device)');
    const api = await connected();
    const r = await api.call('POST', '/api/join', { code }, 40_000);
    console.log(`Paired with ${r.peer.name} (${r.peer.fingerprint}). Your agents can now message each other through VINAC Link.`);
    await api.daemon?.stop();
  } else if (command === 'version' || command === '--version') {
    console.log(VERSION);
  } else {
    console.log(`VINAC Link ${VERSION}: a secure link between AI agents on your computers, no cloud needed.
Usage: vinac <command>        (or: npx vinac-link <command>, or: node connector/bin/vinac.mjs <command>)
  start       start in the background and open the page (default)
  setup       how to connect Claude Code, Codex, OpenClaw, LM Studio, Goose or another MCP app
  doctor      check that everything works (changes nothing)
  status      this device, pairing and unread messages
  open        open the page
  stop        stop the background service
  daemon      run the service in this window (--name NAME, --open)
  mcp         agent tools over stdio, for MCP apps (--simple: three tools, for small local models)
  watch       print one line per new message or waiting item (no text); for agent monitors
  send-file   send a file up to 64 MB:  vinac send-file report.pdf --to "Office PC"  (or --room NAME: posted once, members get it on request)
  files       list received files;  file save ID --out DIR  saves one
  git         git send [--to D] [--branch B] [--since REF]  ·  git fetch ID  (branches arrive as vinac/<device>/...)
  group       group list | group set NAME "PC 1,PC 2" | group remove NAME   (then send "to": NAME)
  audit       the log of what happened (--verify checks it was not edited; --from/--to/--agent/--q filter;
              --csv exports; --check-report FILE checks a signed report from the page)
  run         run --secret NAME -- COMMAND  runs a program with a secret in its environment, after you approve on the page
  join        join <invite>  pairs with the device whose person made that invite (Pair a device > Invite a device)
Options: --home DIR  --port N  --name NAME`);
  }
} catch (e) {
  fail(e.message);
}
