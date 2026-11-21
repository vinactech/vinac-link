import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { env } from './env.js';

const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|vboxnet|VMware|docker|Loopback|utun|bridge|awdl|llw|tailscale|zerotier/i;
const PREFERRED = /Wi-?Fi|WLAN|Ethernet|^en\d|^eth\d|^wlan\d/i;
const isPrivate = ip => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
/** Link-local (169.254/16): what two computers joined by a cable, with no router, give themselves. */
export const isLinkLocal = ip => /^169\.254\./.test(ip);
/** Tailscale (and other CGNAT overlay) addresses: 100.64.0.0/10. */
export const isTailscale = ip => { const m = /^100\.(\d{1,3})\./.exec(ip); return !!m && +m[1] >= 64 && +m[1] <= 127; };

/** This machine's Tailscale IPv4 address, or null. */
export function tailscaleAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && isTailscale(a.address)) return a.address;
  }
  return null;
}

/**
 * A peer's other addresses ("ip:port"), as it reported them. Only private,
 * link-local, Tailscale or loopback IPv4 addresses are kept, at most 4: they are just
 * candidates, and the device must prove itself there before one is used.
 */
export function altAddressList(v) {
  if (!Array.isArray(v)) return [];
  const ok = [];
  for (const a of v.slice(0, 16)) {
    if (ok.length >= 4) break;
    const m = typeof a === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(a);
    if (!m || m.slice(1, 5).some(o => +o > 255) || +m[5] < 1 || +m[5] > 65535) continue;
    const ip = m.slice(1, 5).join('.');
    if (isPrivate(ip) || isLinkLocal(ip) || isTailscale(ip) || /^127\./.test(ip)) ok.push(`${ip}:${+m[5]}`);
  }
  return [...new Set(ok)];
}

/**
 * The address this machine uses for its default route (Wi-Fi or Ethernet with
 * the gateway). A UDP "connect" picks the route without sending any packet.
 */
export function defaultRouteAddress() {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    const done = ip => { try { s.close(); } catch { /* closed */ } resolve(ip); };
    s.on('error', () => done(null));
    s.connect(53, '192.0.2.1', () => {
      const ip = s.address().address;
      done(ip && ip !== '0.0.0.0' && !ip.startsWith('169.254.') ? ip : null);
    });
  });
}

/**
 * Fallback guess when there is no default route (no router, e.g. a hotspot
 * without internet or a direct cable). A link-local address is used only when
 * nothing better exists.
 */
export function lanAddress(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const linkLocal = isLinkLocal(a.address);
      found.push({ name, ip: a.address, score: (linkLocal ? -10 : 0) + (VIRTUAL.test(name) ? 0 : 4) + (isPrivate(a.address) ? 2 : 0) + (PREFERRED.test(name) ? 1 : 0) });
    }
  }
  found.sort((x, y) => y.score - x.score);
  return found[0]?.ip || null;
}

/** Other addresses of this machine on a direct cable (link-local), offered to peers as candidates. */
export function linkLocalAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal && isLinkLocal(a.address)) out.push(a.address);
  }
  return out.slice(0, 2);
}

/** A request body as bytes, up to `limit`. */
export function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error(`Files are limited to ${Math.round(limit / 1024 / 1024)} MB.`), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

const MAX_REPLY = 64 * 1024;

/** POSTs JSON to another device. Never follows redirects; refuses replies over 64 KB. */
export async function postJson(url, body, timeoutMs = 6000) {
  const r = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const chunks = []; let size = 0;
  if (r.body) {
    for await (const c of r.body) {
      size += c.length;
      if (size > MAX_REPLY) throw Object.assign(new Error('Reply too large'), { status: 502 });
      chunks.push(c);
    }
  }
  let data = {};
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { data = {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  if (!r.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error.slice(0, 300) : `HTTP ${r.status}`), { status: r.status, data });
  return data;
}

/** Token bucket per key (an IP address or a peer id): `perMinute` requests, refilled continuously. */
export class RateLimiter {
  constructor(perMinute, maxKeys = 2000) { this.rate = perMinute / 60_000; this.cap = perMinute; this.buckets = new Map(); this.maxKeys = maxKeys; }
  allow(key, cost = 1) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value);
      b = { tokens: this.cap, at: now }; this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.cap, b.tokens + (now - b.at) * this.rate); b.at = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost; return true;
  }
}

// Browsers that can show a page as its own app window (no address bar or tabs): Edge, Chrome,
// Brave, Chromium. Edge comes with every Windows PC.
function appBrowser() {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.platform === 'win32'
    ? pf.flatMap(d => [
      path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')])
    : process.platform === 'darwin'
      ? ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].flatMap(n => [
        `/Applications/${n}.app/Contents/MacOS/${n}`, path.join(os.homedir(), 'Applications', `${n}.app`, 'Contents', 'MacOS', n)])
      : (process.env.PATH || '').split(':').filter(Boolean).flatMap(d =>
        ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'].map(n => path.join(d, n)));
  return candidates.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
}

/**
 * Opens the VINAC Link page in its own window, like an app (falls back to a normal browser tab).
 * VINAC_BROWSER_TAB=1 always uses a tab.
 */
export function openApp(url) {
  if (env('NO_BROWSER')) return false;
  const exe = !env('BROWSER_TAB') && appBrowser();
  if (exe) {
    try {
      spawn(exe, [`--app=${url}`, '--window-size=1240,840', '--no-first-run'], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { /* fall back to a tab */ }
  }
  return openInBrowser(url);
}

export function openInBrowser(url) {
  if (env('NO_BROWSER')) return false;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', `"${url}"`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).unref(); return true; }
  catch { return false; }
}
