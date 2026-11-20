#!/usr/bin/env node
// Takes the website's product screenshots from a demo copy of VINAC Link: two services on temp homes
// and random ports (plain-file key store, 127.0.0.1 only), paired, with a few demo messages. Never
// touches a running VINAC Link. Uses a local Edge or Chrome in headless mode. No sound is played.
//   node connector/tools/capture-screens.mjs        -> site/media/app-*.jpg
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The OS key store, as on a real install (on Windows, DPAPI only encrypts the demo's own temp files).
if (!['win32', 'darwin'].includes(process.platform)) process.env.VINAC_KEYSTORE = 'file';
process.env.VINAC_NO_BROWSER = '1';
process.env.VINAC_LAN_HOST = '127.0.0.1';
const { Daemon } = await import('../src/daemon.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'site', 'media');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BROWSERS = [
  process.env.CHROME_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);

// ---- two demo devices, paired, with demo messages --------------------------------
const home = name => fs.mkdtempSync(path.join(os.tmpdir(), `vinac-shot-${name}-`));
async function start(name) {
  const d = await new Daemon({ home: home(name.replace(/\W/g, '')), name, port: 0, host: '127.0.0.1', lanHost: '127.0.0.1', altHosts: [], log: () => {} }).start();
  d.tailscale = null; // never show this computer's real Tailscale address in a public screenshot
  return d;
}
/** After the demo messages: show ordinary home-network addresses instead of 127.0.0.1 (display only). */
function homeNetworkLook(d, ownAddress, peerAddress) {
  d.address = ownAddress;
  const peers = d.store.peers();
  for (const p of peers) p.address = peerAddress;
  d.store.savePeers(peers);
}
async function ui(d, method, p, body, auth) {
  const headers = { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${d.apiToken}` } : { 'x-ui-token': d.uiToken }) };
  const r = await fetch(`http://127.0.0.1:${d.uiPort}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: ${JSON.stringify(j)}`);
  return j;
}
async function until(fn, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
}
async function pair(A, B) {
  const p = (await ui(A, 'POST', '/ui/announce')).pairing;
  await ui(B, 'POST', '/ui/heard', { code: p.beaconCode });
  const both = async () => { const [a, b] = [await ui(A, 'GET', '/ui/state'), await ui(B, 'GET', '/ui/state')]; return a.pairing?.state === 'comparing' && b.pairing?.state === 'comparing' && [a, b]; };
  const [a, b] = await until(both);
  await ui(A, 'POST', '/ui/confirm', { code: b.pairing.showCode });
  await ui(B, 'POST', '/ui/confirm', { code: a.pairing.showCode });
  await until(async () => (await ui(A, 'GET', '/ui/state')).pairing?.state === 'paired' && (await ui(B, 'GET', '/ui/state')).pairing?.state === 'paired');
}

const pc = await start('PC');
const mac = await start('Mac');
let browser;
try {
  await pair(pc, mac);
  const send = (from, msg) => ui(from, 'POST', '/api/send', msg, true);
  await send(pc, { text: 'Which branch has the auth refactor?', intent: 'agent.question.ask', args: { question: 'Which branch has the auth refactor?' } });
  await send(mac, { text: 'It is on feature/auth-v2. Tests pass on the Mac.' });
  await send(mac, { text: 'Build green on macOS: 412 tests passed.', intent: 'agent.status.update', args: { status: 'Build green on macOS: 412 tests passed.' } });
  await send(mac, {
    text: 'Please review the auth refactor before I merge it.', intent: 'agent.review.request',
    args: { summary: 'Please review the auth refactor before I merge it.', branch: 'feature/auth-v2', files: 'src/auth.js, src/session.js' },
  });
  await send(mac, { text: 'Update the README install steps for Linux.', intent: 'agent.task.handoff', args: { task: 'Update the README install steps for Linux.', branch: 'docs/linux' } });
  homeNetworkLook(pc, '192.168.1.24', '192.168.1.31:47800');

  // ---- headless browser over the DevTools protocol ---------------------------------
  const exe = BROWSERS.find(b => fs.existsSync(b));
  if (!exe) throw new Error('No Edge or Chrome found (set CHROME_BIN).');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-shot-browser-'));
  browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const devPort = (await until(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0], 15000)).trim();
  const target = (await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });

  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  fs.mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const [scheme, view, file] of [['dark', 'firewallNav', 'app-firewall-dark.jpg'], ['light', 'firewallNav', 'app-firewall-light.jpg'], ['dark', 'overviewNav', 'app-overview-dark.jpg']]) {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp('Page.navigate', { url: pc.uiUrl });
    await sleep(1800);
    await cdp('Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(view)})?.click()` });
    await sleep(900);
    const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    shots.push(`${file} (${Math.round(Buffer.from(data, 'base64').length / 1024)} KB)`);
  }
  ws.close();
  console.log(`screenshots in ${OUT}:\n  ${shots.join('\n  ')}`);
} finally {
  browser?.kill();
  await pc.stop(); await mac.stop();
}
