import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Daemon } from '../src/daemon.js';
import { MemoryBus } from '../src/discovery.js';

process.env.VINAC_KEYSTORE ??= 'file';
process.env.VINAC_NO_BROWSER = '1';
process.env.VINAC_LAN_HOST = '127.0.0.1'; // tests never listen on the real network
process.env.VINAC_DISCOVERY = 'off';      // ...nor send discovery packets on it (services the CLI starts inherit this)

export const tempHome = label => fs.mkdtempSync(path.join(os.tmpdir(), `vinac-${label}-`));

/** Devices in one test process find each other on this in-memory "network" while pairing. */
export const network = new MemoryBus();

/** `extra.maxProtocol: 2` plays a device on an older version (no Noise). */
export async function startDevice(name, home = tempHome(name), extra = {}) {
  const d = await new Daemon({ home, name, port: 0, host: '127.0.0.1', lanHost: '127.0.0.1', log: () => {}, discovery: network.join(), ...extra }).start();
  d.homeDir = home;
  return d;
}

export const state = async d => (await ui(d, 'GET', '/ui/state')).body;
export const api = (d, method, p, body) => ui(d, method, p, body, { token: null, auth: `Bearer ${d.apiToken}` });

/** Starts pairing (typed beacon code) and waits until both devices show their codes. */
export async function startPair(A, B, { via = 'code' } = {}) {
  const p = (await ui(A, 'POST', '/ui/announce')).body.pairing;
  const heard = await ui(B, 'POST', '/ui/heard', via === 'hex' ? { hex: p.beaconHex } : { code: p.beaconCode });
  if (heard.status !== 200) throw new Error(JSON.stringify(heard.body));
  await waitFor(async () => (await state(A)).pairing?.state === 'comparing' && (await state(B)).pairing?.state === 'comparing');
  return p;
}

/** What the person does: type B's code into A and A's code into B. */
export async function pair(A, B, opts) {
  await startPair(A, B, opts);
  const [a, b] = [(await state(A)).pairing.showCode, (await state(B)).pairing.showCode];
  const r1 = await ui(A, 'POST', '/ui/confirm', { code: b });
  const r2 = await ui(B, 'POST', '/ui/confirm', { code: a });
  if (r1.status !== 200 || r2.status !== 200) throw new Error(`confirm failed: ${JSON.stringify([r1.body, r2.body])}`);
  await waitFor(async () => (await state(A)).pairing?.state === 'paired' && (await state(B)).pairing?.state === 'paired', 4000);
}

/** Calls the approval-page endpoints the way the page does. */
export async function ui(d, method, p, body, { token = d.uiToken, auth } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-ui-token'] = token;
  if (auth) headers.authorization = auth;
  const r = await fetch(`http://127.0.0.1:${d.uiPort}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

export async function waitFor(fn, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 50));
  }
}
