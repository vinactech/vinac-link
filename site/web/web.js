// VINAC Web (0.16): this browser as one of your VINAC Link devices.
// - Sign in to your account (email code). The session stays in this browser.
// - "Add this browser" from the link your computer shows: an X25519 key made here, its private part not
//   extractable; HELLO through your account's relay; the person compares 6 digits and presses Allow
//   on the computer. The sealing key (AES-256-GCM, not extractable) is kept in this browser's
//   IndexedDB, with a counter, so nothing sent can be replayed.
// - Then: sealed requests for what needs you, projects, rooms, and a few actions. No outside code.
import { codeFromMac } from './lib/phone-frame.js';

const CLOUD_URL = '{{cloud_url}}', CLOUD_KEY = '{{cloud_key}}';
const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
let toastTimer;
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.hidden = true; }, 4200); }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, fn, cls = 'ghost') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };

// ---- account session (like the Team console; kept in this browser) -----------------------------
const SKEY = 'vinac.web.session';
let session = null; try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { session = null; }
const saveSession = s => { session = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch { /* private window */ } };
const keep = s => saveSession({ access: s.access_token, refresh: s.refresh_token, expiresAt: Date.now() + (s.expires_in || 3600) * 1000 - 60_000, userId: s.user?.id || session?.userId, email: s.user?.email || session?.email });
async function auth(path, body) {
  const r = await fetch(`${CLOUD_URL}${path}`, { method: 'POST', headers: { apikey: CLOUD_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(/expired|invalid/i.test(JSON.stringify(j)) ? 'That code is wrong or has expired. Ask for a new one.' : r.status === 429 ? 'Too many codes asked for. Wait a minute.' : `The account service said: ${j.msg || j.message || r.status}`);
  return j;
}
async function token() {
  if (!session) throw new Error('Sign in first.');
  if (Date.now() < session.expiresAt) return session.access;
  const s = await auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh }).catch(() => null);
  if (!s) { saveSession(null); show(); throw new Error('The session ended. Sign in again.'); }
  keep(s); return session.access;
}

// ---- this browser's device record (IndexedDB: CryptoKeys stay non-extractable) -----------------
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
let device = null; // { id, name, computer: { id, name, account }, key: CryptoKey (AES-GCM), q }

// ---- the account relay, in the browser (Realtime, Phoenix v1 JSON) ------------------------------
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
      if (!p || b.to !== device?.id && b.to !== p.from) return;
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

// ---- adding this browser -------------------------------------------------------------------------
function pairFromHash() {
  const m = location.hash.match(/#pair=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { const p = JSON.parse(dec.decode(unb64u(m[1]))); return p.v === 1 && p.d && p.k && p.s ? p : null; } catch { return null; }
}
async function addBrowser(p, name) {
  if (!crypto.subtle) throw new Error('This browser has no Web Crypto (open it over https).');
  let kp;
  try { kp = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']); }
  catch { throw new Error('This browser is too old for VINAC Web (it needs X25519: Chrome 133, Safari 17, Firefox 130 or newer).'); }
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
  return { id, name, key, code, computer: { id: p.d, name: p.n || 'your computer', account: p.a } };
}

// ---- sealed requests ------------------------------------------------------------------------------
async function call(op, args = {}) {
  if (!device) throw new Error('Add this browser first.');
  device.q = (device.q || 0) + 1;
  await kv('put', 'device', device);
  const q = device.q;
  const n = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: enc.encode(`vinac web req|${device.id}|${device.computer.id}`) }, device.key, enc.encode(JSON.stringify({ t: Date.now(), q, op, args }))));
  const r = await relay(device.computer.id, '/web/call', { n: b64u(n), c: b64u(c) }, device.id, 20_000);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(r.n), additionalData: enc.encode(`vinac web res|${device.computer.id}|${device.id}|${q}`) }, device.key, unb64u(r.c));
  const out = JSON.parse(dec.decode(plain));
  if (!out.ok) throw new Error(out.error || 'The computer refused it.');
  return out.result;
}

// ---- screens --------------------------------------------------------------------------------------
let pendingEmail = null, pair = pairFromHash(), view = null, tab = 'needs';
function show() {
  const signedIn = !!session;
  $('signIn').hidden = signedIn;
  $('emailForm').hidden = !!pendingEmail; $('codeForm').hidden = !pendingEmail;
  $('addBrowser').hidden = !(signedIn && pair && !device);
  $('noComputer').hidden = !(signedIn && !pair && !device);
  $('home').hidden = !(signedIn && device);
  $('refreshBtn').hidden = !(signedIn && device);
  $('signInFor').hidden = !(pair && !device);
  if (pair) $('addComputer').textContent = $('signInComputer').textContent = pair.n || 'your computer';
  if (device) { $('homeComputer').textContent = device.computer.name; $('topSub').textContent = `${device.name} · ${device.computer.name}`; }
}
$('emailForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('email').value.trim().toLowerCase();
  try { await auth('/auth/v1/otp', { email, create_user: false }); pendingEmail = email; show(); $('code').focus(); toast('Code sent. Check your email.'); } catch (err) { toast(err.message); }
};
$('codeForm').onsubmit = async e => {
  e.preventDefault();
  try { const s = await auth('/auth/v1/verify', { type: 'email', email: pendingEmail, token: $('code').value.trim() }); keep(s); pendingEmail = null; show(); start(); } catch (err) { toast(err.message); }
};
$('otherEmail').onclick = () => { pendingEmail = null; show(); };
async function signOut() { saveSession(null); try { ws?.close(); } catch { /* closed */ } show(); }
$('signOut1').onclick = signOut; $('signOut2').onclick = signOut;
$('forgetBtn').onclick = async () => { if (!confirm('Remove this browser here? Remove it on the computer too (Account › Your browsers).')) return; await kv('del', 'device'); device = null; show(); };

$('addForm').onsubmit = async e => {
  e.preventDefault();
  if (pair.a && session.userId !== pair.a) { toast('Sign in with the same account as that computer.'); return; }
  const name = $('browserName').value.trim().slice(0, 40) || 'Browser';
  try {
    $('addForm').querySelector('button').disabled = true;
    const r = await addBrowser(pair, name);
    $('addDigits').textContent = `${r.code.slice(0, 3)} ${r.code.slice(3)}`;
    $('addCompare').hidden = false; $('addForm').hidden = true;
    for (let i = 0; i < 150; i++) {
      await new Promise(res => setTimeout(res, 2000));
      const s = await relay(r.computer.id, '/web/check', {}, r.id).catch(() => ({ state: 'waiting' }));
      if (s.state === 'paired') {
        device = { id: r.id, name: r.name, key: r.key, q: 0, computer: r.computer };
        await kv('put', 'device', device);
        history.replaceState(null, '', location.pathname); pair = null; show(); toast('Added. This browser can now reach your computer.'); load(); return;
      }
      if (s.state === 'refused' || s.state === 'none') { $('addStatus').textContent = 'Not added (cancelled on the computer, or the link expired). Ask the computer for a new link.'; return; }
    }
    $('addStatus').textContent = 'Timed out. Ask the computer for a new link.';
  } catch (err) { toast(err.message); $('addForm').querySelector('button').disabled = false; }
};
$('browserName').value = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone browser' : /Android/.test(navigator.userAgent) ? 'Android browser' : /Mac/.test(navigator.userAgent) ? 'Mac browser' : 'Browser';

for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => {
  tab = b.dataset.tab;
  for (const x of document.querySelectorAll('[data-tab]')) x.setAttribute('aria-selected', String(x === b));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
};
$('refreshBtn').onclick = () => load();

const LABEL = { request: 'Held request', decision: 'Decision', key: 'Key request', task: 'Open task', keyOffer: 'Key to accept', run: 'Program asks', keyAsk: 'Key asked for', mention: 'Mention', pairOffer: 'Pairing request' };
async function act(op, args, done) {
  try { await call(op, args); toast(done); load(); } catch (e) { toast(e.message); }
}
async function load() {
  if (!device) return;
  try {
    const s = await call('state');
    renderNeeds(s.needsMe || []); renderProjects(s.projects || []); renderRooms(s.rooms || []);
  } catch (e) { toast(e.message); }
}
function renderNeeds(needs) {
  $('needsCount').textContent = needs.length || '';
  const ul = $('needsList'); ul.replaceChildren();
  if (!needs.length) { ul.append(el('li', 'empty', 'Nothing needs you right now.')); return; }
  for (const n of needs) {
    const li = el('li', 'item');
    li.append(el('small', null, `${LABEL[n.kind] || n.kind}${n.room ? ` · # ${n.room}` : n.with ? ` · ${n.with}` : ''}`), el('b', null, n.title));
    const row = el('div', 'acts');
    const where = { room: n.roomId || undefined, to: n.peerId || undefined };
    if (n.kind === 'decision') for (const o of n.options || []) row.append(btn(o, () => act('answer', { ...where, card: n.card, option: o }, `Answered: ${o}.`)));
    else if (n.kind === 'request') row.append(btn('Approve', () => act('request', { id: n.id, approve: true }, 'Approved.'), 'primary'), btn('Reject', () => act('request', { id: n.id, approve: false }, 'Rejected.')));
    else if (n.kind === 'task') row.append(btn('Claim', () => act('task', { ...where, card: n.card, action: 'claim' }, 'Claimed.')));
    else if (n.kind === 'key' && !n.local) row.append(btn('Send the key', () => { if (confirm(`Send this key from your computer to ${n.from}? It goes sealed to that device only.`)) act('sendKey', { card: n.card }, 'Sent.'); }, 'primary'));
    else row.append(el('span', 'muted', 'Open VINAC Link on the computer for this one.'));
    li.append(row); ul.append(li);
  }
}
function renderProjects(list) {
  const ul = $('projectList'); ul.replaceChildren(); $('projectView').hidden = true;
  if (!list.length) { ul.append(el('li', 'empty', 'No projects yet.')); return; }
  for (const p of list) { const li = el('li', 'item link'); li.append(el('b', null, p.name), el('small', null, p.about || '')); li.onclick = () => openProject(p.id); ul.append(li); }
}
async function openProject(id) {
  try {
    const v = await call('project', { id });
    const box = $('projectView'); box.hidden = false; box.replaceChildren(el('h2', null, v.project.name));
    for (const [label, items] of [['Open', v.board.open], ['Claimed', v.board.claimed], ['Done', v.board.done]]) {
      box.append(el('h3', null, `${label} (${items.length})`));
      const ul = el('ul', 'list');
      for (const c of items) {
        const li = el('li', 'item'); li.append(el('b', null, `${c.review ? 'Review: ' : ''}${c.title}`), el('small', null, [c.branch && `branch ${c.branch}`, c.claimedBy && `claimed by ${c.claimedBy}`, c.doneBy && `done by ${c.doneBy}`].filter(Boolean).join(' · ')));
        if (label === 'Open' && v.room) li.append(btn('Claim', () => act('task', { room: v.room.id, card: c.id, action: 'claim' }, 'Claimed.')));
        if (label !== 'Done' && v.room) li.append(btn('Mark done', () => act('task', { room: v.room.id, card: c.id, action: 'done' }, 'Done.')));
        ul.append(li);
      }
      box.append(ul);
    }
  } catch (e) { toast(e.message); }
}
function renderRooms(list) {
  const ul = $('roomList'); ul.replaceChildren(); $('roomView').hidden = true;
  if (!list.length) { ul.append(el('li', 'empty', 'No rooms yet.')); return; }
  for (const r of list) { const li = el('li', 'item link'); li.append(el('b', null, `# ${r.name}`), el('small', null, r.last ? `${r.last.by ? `${r.last.by}: ` : ''}${r.last.text}` : 'No posts yet.')); li.onclick = () => openRoom(r.id); ul.append(li); }
}
async function openRoom(id) {
  try {
    const v = await call('room', { id });
    const box = $('roomView'); box.hidden = false; box.replaceChildren(el('h2', null, `# ${v.room.name}`));
    const ul = el('ul', 'list msgs');
    for (const m of v.messages) { const li = el('li', 'item'); li.append(el('small', null, `${m.from} · ${new Date(m.at).toLocaleString()}`), el('p', null, m.text)); ul.append(li); }
    const f = el('form', 'post'); const t = el('textarea'); t.rows = 2; t.maxLength = 4000; t.placeholder = 'Post in this room';
    const send = el('button', 'primary', 'Post'); send.type = 'submit'; f.append(t, send);
    f.onsubmit = async e => { e.preventDefault(); if (!t.value.trim()) return; try { await call('post', { room: id, text: t.value }); t.value = ''; openRoom(id); } catch (err) { toast(err.message); } };
    box.append(ul, f);
  } catch (e) { toast(e.message); }
}

async function start() {
  device = await kv('get', 'device').catch(() => null) || null;
  show();
  if (device && session) { load(); setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000); }
}
start();
