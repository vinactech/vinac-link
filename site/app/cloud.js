// The app's account side (0.16.2, from VINAC Web): sign in with an email code, add this browser to
// your computers, and send them sealed requests through your account's relay.
// - Each computer this browser is added to has its own X25519 key made here (never extractable) and
//   its own AES-256-GCM sealing key, kept in this browser's IndexedDB with a counter, so nothing sent
//   can be replayed. The relay only sees sealed bytes.
// - Nothing here creates an account: sign up on a computer (Account) or in the Team console first.
import { codeFromMac } from './web/phone-frame.js';

const CLOUD_URL = '{{cloud_url}}', CLOUD_KEY = '{{cloud_key}}';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

// ---- account session (kept in this browser) -------------------------------------------------------
const SKEY = 'vinac.web.session';
let session = null; try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { session = null; }
let onSignedOut = () => {};
export const signedIn = () => !!session;
export const accountEmail = () => session?.email || '';
export const accountId = () => session?.userId || '';
export function whenSignedOut(fn) { onSignedOut = fn; }
const saveSession = s => { session = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch { /* private window */ } };
const keep = s => saveSession({ access: s.access_token, refresh: s.refresh_token, expiresAt: Date.now() + (s.expires_in || 3600) * 1000 - 60_000, userId: s.user?.id || session?.userId, email: s.user?.email || session?.email });
async function auth(path, body) {
  const r = await fetch(`${CLOUD_URL}${path}`, { method: 'POST', headers: { apikey: CLOUD_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(/expired|invalid/i.test(JSON.stringify(j)) ? 'That code is wrong or has expired. Ask for a new one.' : r.status === 429 ? 'Too many codes asked for. Wait a minute.' : /signups? not allowed|user not found/i.test(JSON.stringify(j)) ? 'No account with this email. Make one on your computer first (VINAC Link › Account).' : `The account service said: ${j.msg || j.message || r.status}`);
  return j;
}
export async function sendCode(email) { await auth('/auth/v1/otp', { email: String(email).trim().toLowerCase(), create_user: false }); }
export async function verifyCode(email, code) {
  const e = String(email).trim().toLowerCase();
  const s = await auth('/auth/v1/verify', { type: 'email', email: e, token: String(code).trim() });
  keep({ ...s, user: { ...s.user, email: s.user?.email || e } });
}
export function signOut() { saveSession(null); try { ws?.close(); } catch { /* closed */ } }
async function token() {
  if (!session) throw new Error('Sign in first (Devices).');
  if (Date.now() < session.expiresAt) return session.access;
  const s = await auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh }).catch(() => null);
  if (!s) { saveSession(null); onSignedOut(); throw new Error('The session ended. Sign in again.'); }
  keep(s); return session.access;
}

// ---- this browser's computers (IndexedDB: CryptoKeys stay non-extractable) ---------------------------
function db() {
  return new Promise((res, rej) => { const r = indexedDB.open('vinac-web', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function kv(op, key, value) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'); const st = tx.objectStore('kv');
    const r = op === 'get' ? st.get(key) : op === 'del' ? st.delete(key) : st.put(value, key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
// [{ id, name, key: CryptoKey (AES-GCM), q, computer: { id, name, account } }]
let computers = [];
export async function loadComputers() {
  try {
    computers = await kv('get', 'computers') || [];
    const old = await kv('get', 'device'); // VINAC Web 0.16.1 kept one
    if (old && !computers.some(c => c.id === old.id)) { computers.push(old); await kv('put', 'computers', computers); }
    if (old) await kv('del', 'device');
  } catch { computers = []; }
  return computers;
}
export const myComputers = () => computers.filter(c => !session || !c.computer.account || c.computer.account === session.userId);
export async function forgetComputer(id) { computers = computers.filter(c => c.id !== id); await kv('put', 'computers', computers); }

// ---- the account relay, in the browser (Realtime, Phoenix v1 JSON) --------------------------------
let ws = null, ref = 0, joinRef = null, topic = null, joined = null, beat = null;
const pending = new Map();
async function connect() {
  if (ws && ws.readyState === 1 && joined) return joined;
  const tk = await token();
  topic = `realtime:relay:${session.userId}`;
  const u = new URL('/realtime/v1/websocket', CLOUD_URL.replace(/^http/, 'ws'));
  u.searchParams.set('apikey', CLOUD_KEY); u.searchParams.set('vsn', '1.0.0');
  ws = new WebSocket(u.toString());
  joined = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The relay did not answer.')), 10_000);
    ws.onopen = () => { joinRef = String(++ref); ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, postgres_changes: [], private: true }, access_token: tk }, ref: joinRef, join_ref: joinRef })); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'phx_reply' && m.ref === joinRef) { clearTimeout(t); if (m.payload?.status === 'ok') resolve(); else reject(new Error('The relay refused this account. Sign in again.')); return; }
      if (m.event !== 'broadcast' || m.topic !== topic || m.payload?.event !== 'res') return;
      const b = m.payload.payload;
      const p = b && pending.get(b.id);
      if (!p || b.to !== p.from) return;
      pending.delete(b.id); clearTimeout(p.timer);
      if (b.status === 200) p.resolve(b.body || {}); else p.reject(Object.assign(new Error(b.body?.error || `Error ${b.status}`), { status: b.status }));
    };
    ws.onclose = () => { joined = null; clearInterval(beat); for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('The relay closed the connection.')); } pending.clear(); };
  });
  await joined;
  clearInterval(beat); beat = setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) })); }, 25_000);
  return joined;
}
async function relay(to, route, body, from, timeoutMs = 12_000) {
  await connect();
  const id = b64u(crypto.getRandomValues(new Uint8Array(12)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The computer didn\'t answer. Is VINAC Link running there, with the relay on?')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, from });
    ws.send(JSON.stringify({ topic, event: 'broadcast', payload: { type: 'broadcast', event: 'req', payload: { id, from, to, route, body: { ...body, from } } }, ref: String(++ref), join_ref: joinRef }));
  });
}

// ---- adding this browser to a computer ----------------------------------------------------------------
/** The link a computer shows (Account › Your browsers): { v, d, n, k, s, a } or null. */
export function readBrowserLink(text) {
  const m = String(text ?? '').match(/[#&]pair=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { const p = JSON.parse(dec.decode(unb64u(m[1]))); return p.v === 1 && p.d && p.k && p.s ? p : null; } catch { return null; }
}

/** Says hello to the computer; returns { code, wait() } — wait() resolves to the computer record once Allow is pressed. */
export async function addBrowser(p, name) {
  if (p.a && session && session.userId !== p.a) throw new Error('Sign in with the same account as that computer.');
  if (!crypto.subtle) throw new Error('This browser has no Web Crypto (open it over https).');
  let kp;
  try { kp = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']); }
  catch { throw new Error('This browser is too old for this (it needs X25519: Chrome 133, Safari 17, Firefox 130 or newer).'); }
  const ppub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const cpubKey = await crypto.subtle.importKey('raw', unb64u(p.k), { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: cpubKey }, kp.privateKey, 256));
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const okm = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: unb64u(p.s), info: concat(enc.encode('VINAC web v1'), unb64u(p.k), ppub) }, hk, 512));
  shared.fill(0);
  const kmac = await crypto.subtle.importKey('raw', okm.slice(0, 32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const key = await crypto.subtle.importKey('raw', okm.slice(32, 64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  okm.fill(0);
  const id = hex((await crypto.subtle.digest('SHA-256', ppub)).slice(0, 8));
  const tag = new Uint8Array(await crypto.subtle.sign('HMAC', kmac, concat(enc.encode('hello'), ppub, enc.encode(name)))).slice(0, 16);
  const code = codeFromMac(new Uint8Array(await crypto.subtle.sign('HMAC', kmac, enc.encode('code'))));
  await relay(p.d, '/web/hello', { ppub: b64u(ppub), name, tag: b64u(tag) }, id);
  const rec = { id, name, key, q: 0, computer: { id: p.d, name: p.n || 'your computer', account: p.a } };
  const wait = async (stopped = () => false) => {
    for (let i = 0; i < 150 && !stopped(); i++) {
      await new Promise(res => setTimeout(res, 2000));
      const s = await relay(p.d, '/web/check', {}, id).catch(() => ({ state: 'waiting' }));
      if (s.state === 'paired') {
        computers = computers.filter(c => c.computer.id !== p.d); // added again: the new one replaces it
        computers.push(rec); await kv('put', 'computers', computers);
        return rec;
      }
      if (s.state === 'refused' || s.state === 'none') throw new Error('Not added (cancelled on the computer, or the link expired). Ask the computer for a new link.');
    }
    throw new Error('Timed out. Ask the computer for a new link.');
  };
  return { code, wait };
}

// ---- sealed requests to one computer ------------------------------------------------------------------
export async function call(c, op, args = {}) {
  c.q = (c.q || 0) + 1;
  await kv('put', 'computers', computers);
  const q = c.q;
  const n = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: enc.encode(`vinac web req|${c.id}|${c.computer.id}`) }, c.key, enc.encode(JSON.stringify({ t: Date.now(), q, op, args }))));
  const r = await relay(c.computer.id, '/web/call', { n: b64u(n), c: b64u(sealed) }, c.id, 20_000);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(r.n), additionalData: enc.encode(`vinac web res|${c.computer.id}|${c.id}|${q}`) }, c.key, unb64u(r.c));
  const out = JSON.parse(dec.decode(plain));
  if (!out.ok) throw new Error(out.error || 'The computer refused it.');
  return out.result;
}
