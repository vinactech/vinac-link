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
const { MemoryBus } = await import('../src/discovery.js');
const network = new MemoryBus(); // the two demo devices find each other here, never on the real network

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
  const d = await new Daemon({ home: home(name.replace(/\W/g, '')), name, port: 0, host: '127.0.0.1', lanHost: '127.0.0.1', altHosts: [], discovery: network.join(), log: () => {} }).start();
  d.tailscale = null; // never show this computer's real Tailscale address in a public screenshot
  return d;
}
/** After the demo messages: show ordinary home-network addresses instead of 127.0.0.1 (display only). */
function homeNetworkLook(d, ownAddress, peerAddresses) {
  d.address = ownAddress;
  const peers = d.store.peers();
  for (const p of peers) p.address = peerAddresses[p.name] || p.address;
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
let browser, server;
try {
  const { cdp, shoot, close } = await openBrowser();
  const shots = [];
  const snap = async (d, file, prep = '', wait = 900, scheme = 'dark') => {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp('Page.navigate', { url: d.uiUrl });
    await sleep(1800);
    if (prep) {
      const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${prep} })()`, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`${file}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      await sleep(wait);
    }
    shots.push(await shoot(file));
  };
  // Guide: the first screen, before any pairing
  await snap(pc, 'tour-welcome.jpg');
  // Pair a device, with the Mac's Pair screen open too, so the Mac shows up under "On this network"
  await ui(mac, 'POST', '/ui/discover');
  await snap(pc, 'tour-pair.jpg', `document.getElementById('newPairBtn').click()`, 4200);
  await ui(mac, 'POST', '/ui/cancel').catch(() => {});
  // Pairing, stopped at "Check the code" for a picture
  const p = (await ui(pc, 'POST', '/ui/announce')).pairing;
  await ui(mac, 'POST', '/ui/heard', { code: p.beaconCode });
  const both = async () => { const [a, b] = [await ui(pc, 'GET', '/ui/state'), await ui(mac, 'GET', '/ui/state')]; return a.pairing?.state === 'comparing' && b.pairing?.state === 'comparing' && [a, b]; };
  const [a, b] = await until(both);
  await snap(pc, 'tour-compare.jpg');
  await ui(pc, 'POST', '/ui/confirm', { code: b.pairing.showCode });
  await ui(mac, 'POST', '/ui/confirm', { code: a.pairing.showCode });
  await until(async () => (await ui(pc, 'GET', '/ui/state')).pairing?.state === 'paired' && (await ui(mac, 'GET', '/ui/state')).pairing?.state === 'paired');
  // A third computer for the rooms picture, paired with both (before the display-only addresses).
  server = await start('Build Server');
  await pair(pc, server); await pair(mac, server);
  const send = (from, msg) => ui(from, 'POST', '/api/send', msg, true);
  await send(pc, { to: 'Mac', text: 'Which branch has the auth refactor?', intent: 'agent.question.ask', args: { question: 'Which branch has the auth refactor?' } });
  await send(mac, { to: 'PC', text: 'It is on feature/auth-v2. Tests pass on the Mac.' });
  await send(mac, { to: 'PC', text: 'Build green on macOS: 412 tests passed.', intent: 'agent.status.update', args: { status: 'Build green on macOS: 412 tests passed.' } });
  await send(mac, {
    to: 'PC', text: 'Please review the auth refactor before I merge it.', intent: 'agent.review.request',
    args: { summary: 'Please review the auth refactor before I merge it.', branch: 'feature/auth-v2', files: 'src/auth.js, src/session.js' },
  });
  await send(mac, { to: 'PC', text: 'Update the README install steps for Linux.', intent: 'agent.task.handoff', args: { task: 'Update the README install steps for Linux.', branch: 'docs/linux' } });
  homeNetworkLook(pc, '192.168.1.24', { Mac: '192.168.1.31:47800', 'Build Server': '192.168.1.40:47800' });
  // The shown address is made up, so the reachability check would say "offline": keep the demo Mac online.
  pc.setOnline = id => pc.online.set(id, { online: true, at: Date.now() });
  for (const p of pc.store.peers()) pc.setOnline(p.id);

  // Product shots (home page) and the guide's steps
  await snap(pc, 'app-firewall-dark.jpg', `document.getElementById('firewallNav').click()`);
  await snap(pc, 'app-firewall-light.jpg', `document.getElementById('firewallNav').click()`, 900, 'light');
  await snap(pc, 'app-overview-dark.jpg', `document.getElementById('overviewNav').click()`);
  await snap(pc, 'tour-thread.jpg', `document.querySelector('.convo')?.click()`, 1200);
  await snap(pc, 'tour-secrets.jpg', `document.getElementById('secretsNav').click(); await new Promise(r => setTimeout(r, 500)); document.querySelector('.convo')?.click(); await new Promise(r => setTimeout(r, 600)); document.getElementById('secretBtn').click(); document.getElementById('secretName').value = 'OPENAI_API_KEY'; document.getElementById('secretValue').value = 'sk-demo-not-a-real-key'; document.querySelector('input[name=how][value=wifi]').click();`, 900);
  await snap(pc, 'tour-help.jpg', `document.getElementById('helpBtn').click()`);
  // Keys without being in sync (taken last: the request also waits on the firewall page).
  // Demo values only, never real keys.
  await ui(pc, 'POST', '/ui/secrets/add', { name: 'STRIPE_TEST_KEY', value: 'sk_test_demo_not_a_real_key' });
  await ui(mac, 'POST', '/api/send', { to: 'PC', intent: 'person.secret.request', args: { name: 'STRIPE_TEST_KEY', reason: 'npm start needs it for the shop build' } }, true);
  await ui(mac, 'POST', '/ui/secret/wifi', { to: 'PC', name: 'OPENAI_API_KEY', value: 'sk-demo-not-a-real-key' });
  await snap(pc, 'tour-keys.jpg', `document.getElementById('secretsNav').click()`, 1200);
  // The activity log (compliance): an agent identity and an allowed run, as a company would see them.
  const agentTok = (await ui(pc, 'POST', '/ui/agents/add', { name: 'Codex on the Mac' })).newAgent.token;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-shot-shop-'));
  const ask = await fetch(`http://127.0.0.1:${pc.uiPort}/api/secret-use`, { method: 'POST', headers: { authorization: `Bearer ${agentTok}`, 'content-type': 'application/json' }, body: JSON.stringify({ names: ['STRIPE_TEST_KEY'], command: ['npm', 'test'], cwd: work }) }).then(r => r.json());
  await ui(pc, 'POST', '/ui/secret-use/decide', { id: ask.id, approve: true, allowHours: 8 });
  await snap(pc, 'tour-activity.jpg', `document.getElementById('activityNav').click(); for (let i = 0; i < 40 && document.querySelectorAll('#auditList li').length < 10; i++) await new Promise(r => setTimeout(r, 100));`, 1200);
  // A shared project room, made on the Mac (the PC's peer addresses above are display-only, so the
  // PC only receives here). Posts from the Mac's person and agent and from the build server's agent.
  const room = (await ui(mac, 'POST', '/ui/rooms', { name: 'Website launch', members: ['PC', 'Build Server'] })).room;
  await ui(mac, 'POST', '/ui/send', { room: room.id, text: 'Kicking off the launch room: build first, then the copy review.' });
  await send(server, { room: room.id, text: 'Build 42 passed: all tests green. Installers are in build/installers/out.' });
  await send(mac, { room: room.id, text: 'Copy review done on the Mac. Two typos fixed on the French home page.' });
  await until(async () => ((await ui(pc, 'GET', '/ui/state')).rooms || []).some(r => r.incoming?.length >= 3));
  await snap(pc, 'tour-room.jpg', `document.querySelector('#roomList .convo').click()`, 1200);
  close();
  console.log(`screenshots in ${OUT}:\n  ${shots.join('\n  ')}`);
} finally {
  browser?.kill();
  await pc.stop(); await mac.stop(); await server?.stop();
}

// ---- headless browser over the DevTools protocol ---------------------------------
async function openBrowser() {
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
  const shoot = async file => {
    const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    return `${file} (${Math.round(Buffer.from(data, 'base64').length / 1024)} KB)`;
  };
  return { cdp, shoot, close: () => ws.close() };
}
