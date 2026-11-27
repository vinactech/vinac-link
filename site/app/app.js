// VINAC Link app (0.16.2): VINAC Link in a browser, on a phone or a laptop.
// - Needs me, Projects, Rooms: your computers, reached through your account's relay with sealed
//   requests (cloud.js). A browser shows the work and answers for you; it never runs agents, pairs
//   devices, changes rules or sees a computer's key values.
// - Keys: encrypted on this device with a passphrase (no account needed), sent sealed for one device:
//   as a code another phone opens, as sound, or through your account to one of your computers.
// - Devices: your computers through the account; computers and phones paired by code or sound.
// Anything in a link arrives after # (never sent to any server) and is removed from the address bar.
import {
  pairWithComputer, vaultKey, sealVault, openVault, newSalt, unb64u, PBKDF2_ITERATIONS,
  hostStart, hostHello, sealKey, openKey,
} from './web/phone-crypto.js';
import { cleanName, readPhoneLink, phoneLink, phoneFrameLooksValid, HELLO_MIN, PHONE_SECRET_MIN, PHONE_SECRET_MAX } from './web/phone-frame.js';
import { BEACON_TONES, BEACON_BPS } from './web/beacon.js';
import { SECRET_FEC } from './web/secret-frame.js';
import { qrSvg } from './web/qr.js';
import { AudioEngine } from './lab/js/audio.js';
import { decodeFskFrameV2 } from './lab/js/modem.js';
import * as cloud from './cloud.js';

const STORE = 'vinacPhoneVault';
const LOCK_AFTER_MS = 5 * 60_000;
const $ = id => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const SHEETS = ['sheetAdd', 'sheetKey', 'sheetSend', 'sheetHost', 'sheetReceive', 'sheetScan', 'scrim'];
const TITLES = { needs: 'Needs me', projects: 'Projects', rooms: 'Rooms', keys: 'Keys', devices: 'Devices' };
const canScan = 'BarcodeDetector' in globalThis && !!navigator.mediaDevices?.getUserMedia;

// Whatever the camera or a link opened: a pairing code, a phone's answer, a key, or "add this browser".
let incoming = readPhoneLink(location.hash);
let browserLink = cloud.readBrowserLink(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname);

let key = null, data = null, lockTimer = null, pairing = null, pending = null, current = -1, playing = false, toastTimer = null;
let hostFound = null, received = null, sendFrame = null, tab = 'keys';
const saved = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };
const devices = () => data?.computers || []; // devices paired by code or sound (stored as "computers")

async function persist() { localStorage.setItem(STORE, JSON.stringify({ ...saved(), box: await sealVault(key, data) })); }

function lock() {
  stopListening(); stopScan();
  key = null; data = null; pairing = null; current = -1; hostFound = null; received = null; sendFrame = null;
  closeSheets(); clearTimeout(lockTimer); render();
}
function bump() { clearTimeout(lockTimer); if (key) lockTimer = setTimeout(lock, LOCK_AFTER_MS); }
document.addEventListener('visibilitychange', () => { if (document.hidden && key) lockTimer = setTimeout(lock, 60_000); else bump(); });
['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, bump, { passive: true }));

function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function btn(label, fn, cls = 'btn small') { const b = el('button', label, cls); b.type = 'button'; b.addEventListener('click', fn); return b; }
const when = iso => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
// 0.16.4: the header gets a hairline once the page scrolls under it.
window.addEventListener('scroll', () => document.querySelector('.top')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
const chevron = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.classList.add('chev'); s.innerHTML = '<path d="m9 6 6 6-6 6"/>'; return s; };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }
function status(id, text, cls = '') { const s = $(id); s.className = `status ${cls}`.trim(); s.textContent = text; }
// qrSvg builds the SVG from the code's own modules (no outside text goes into it).
function drawQr(id, text) { $(id).innerHTML = qrSvg(text, { scale: 4, quiet: 3 }); }

// ---- sheets ----------------------------------------------------------------------------------
function openSheet(id) { closeSheets(); show('scrim'); show(id); $(id).querySelector('input, select, button.primary:not([hidden])')?.focus({ preventScroll: true }); }
function closeSheets() {
  stopListening(); stopScan();
  for (const id of SHEETS) show(id, false);
  $('keyValueShown').textContent = '••••••••••••'; $('keyShow').textContent = 'Show';
}
$('scrim').addEventListener('click', closeSheets);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

// ---- tabs -------------------------------------------------------------------------------------
function go(t) { tab = t; render(); if (['needs', 'projects', 'rooms'].includes(t)) loadAll(); }
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => go(b.dataset.tab));
for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => go(b.dataset.go));

// ---- render ----------------------------------------------------------------------------------
function render() {
  $('title').textContent = TITLES[tab];
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
  const s = saved();
  show('lockBtn', !!key); show('receiveBtn', !!key);
  show('refreshBtn', ['needs', 'projects', 'rooms'].includes(tab) && cloud.myComputers().length > 0 && cloud.signedIn());
  show('addKeyBtn', tab === 'keys' && !!key);

  // Keys: create, unlock, or the list.
  show('vCreate', !s); show('vLocked', !!s && !key); show('vOpen', !!key);
  if (!key) {
    $('lockedLead').textContent = incoming?.kind === 'p' ? `Unlock to pair with ${incoming.pair.name}.`
      : incoming?.kind === 'k' ? 'Unlock to receive the key you opened.'
        : incoming?.kind === 'h' ? 'Unlock to finish pairing with the other phone.'
          : 'Enter your passphrase to open your keys.';
  }
  renderPairBanner(); renderAccount();
  if (!key) { show('vaultDevicesLocked', true); show('vaultDevices', false); return; }
  show('vaultDevicesLocked', false); show('vaultDevices', true);

  const q = $('keySearch').value.trim().toLowerCase();
  const kl = $('keyList'); kl.replaceChildren();
  const keys = data.keys.map((k, i) => ({ k, i })).filter(({ k }) => !q || k.name.toLowerCase().includes(q));
  if (!data.keys.length) {
    const li = el('li', null, 'empty'); li.append(el('b', 'No keys yet'), el('p', 'Tap + to add an API key or token, or ↓ to receive one. It stays encrypted on this device.'));
    kl.append(li);
  } else if (!keys.length) kl.append(Object.assign(el('li', null, 'empty'), { textContent: 'No key matches.' }));
  for (const { k, i } of keys) {
    const li = el('li', null, 'row'); li.tabIndex = 0; li.setAttribute('role', 'button');
    const t = el('div', null, 'txt'); t.append(el('b', k.name), el('small', k.from ? `From ${k.from} · ${when(k.addedAt)}` : `Added ${when(k.addedAt)}`));
    li.append(el('span', k.name[0].toUpperCase(), 'avatar'), t, chevron());
    li.addEventListener('click', () => openKeySheet(i));
    li.addEventListener('keydown', e => { if (e.key === 'Enter') openKeySheet(i); });
    kl.append(li);
  }

  const cl = $('computerList'); cl.replaceChildren();
  if (!devices().length) {
    const li = el('li', null, 'empty'); li.append(el('b', 'Nothing paired by code or sound yet'), el('p', 'Pair a computer or another phone to hand it keys without the internet.'));
    cl.append(li);
  }
  devices().forEach((c, i) => {
    const li = el('li');
    const phone = c.kind === 'phone';
    const t = el('div', null, 'txt'); t.append(el('b', c.name), el('small', `${phone ? 'Phone' : 'Computer'} · paired ${when(c.pairedAt)}`));
    const rm = btn('Remove', async () => { if (!confirm(`Remove ${c.name}? Remove this device on that ${phone ? 'phone' : 'computer'} too.`)) return; devices().splice(i, 1); await persist(); render(); });
    li.append(el('span', phone ? '▯' : '▭', 'avatar pc'), t, rm);
    cl.append(li);
  });
}

function renderPairBanner() {
  // Pairing as the guest (this device opened a computer's or a phone's code); needs the keys open.
  show('pairCard', !!pending && !!key);
  if (!pending || !key) return;
  const toPhone = pending.host === 'phone';
  $('pairName').textContent = pending.name;
  show('pairCode', !!pairing); show('pairDone', !!pairing);
  show('pairShow', toPhone); show('pairQr', toPhone && !!pairing && $('pairQr').childElementCount > 0);
  $('pairPlay').textContent = toPhone ? 'Play a sound instead' : 'Play pairing sound';
  $('pairPlay').className = toPhone ? 'btn' : 'btn primary';
  $('pairDone').textContent = toPhone ? 'The other phone says Paired' : 'The computer says Paired';
  $('pairIntro').textContent = !pairing
    ? (toPhone ? 'Show your code to the other phone (it scans it, or opens it with its camera). Or play a sound while it listens.'
      : 'Hold the phone close to that computer, volume up, then play the sound. The computer is listening for it.')
    : (toPhone ? 'The other phone should show the same 6 digits. If it does, press Allow there, then tap "The other phone says Paired".'
      : 'The computer should show the same 6 digits. If it does, press Allow there, then tap "The computer says Paired". Not heard? Play again, closer.');
  if (pairing) $('pairCode').textContent = pairing.code;
}

function openKeySheet(i) {
  current = i; const k = data.keys[i];
  $('keyAvatar').textContent = k.name[0].toUpperCase();
  $('keyTitle').textContent = k.name; $('keyAdded').textContent = k.from ? `From ${k.from} · ${when(k.addedAt)}` : `Added ${when(k.addedAt)}`;
  openSheet('sheetKey');
}
$('keyShow').addEventListener('click', () => {
  const shown = $('keyShow').textContent === 'Hide';
  $('keyValueShown').textContent = shown ? '••••••••••••' : data.keys[current].value;
  $('keyShow').textContent = shown ? 'Show' : 'Hide';
});
$('keyDelete').addEventListener('click', async () => {
  const k = data.keys[current];
  if (!confirm(`Delete ${k.name} from this device?`)) return;
  data.keys.splice(current, 1); await persist(); closeSheets(); render(); toast(`${k.name} deleted.`);
});

// ---- your computers, through the account ------------------------------------------------------------
let pendingEmail = null, adding = null, views = new Map(), pick = { projects: null, rooms: null }, loading = false;
function renderAccount() {
  const signed = cloud.signedIn(), mine = cloud.myComputers();
  $('brandSub').textContent = !signed ? 'Not signed in · keys work without an account'
    : mine.length ? `${cloud.accountEmail() || 'Signed in'} · ${mine.length} computer${mine.length > 1 ? 's' : ''}`
      : `${cloud.accountEmail() || 'Signed in'} · no computer added yet`;
  show('signIn', !signed); show('emailForm', !pendingEmail); show('codeForm', !!pendingEmail);
  show('acctNote', signed); $('acctEmail').textContent = cloud.accountEmail();
  show('webList', signed && mine.length > 0);
  const wl = $('webList'); wl.replaceChildren();
  for (const c of mine) {
    const v = views.get(c.id);
    const li = el('li');
    const t = el('div', null, 'txt'); t.append(el('b', c.computer.name), el('small', v?.error ? `Not reached: ${v.error}` : v?.state ? `Reached · as ${c.name}` : `As ${c.name}`));
    const rm = btn('Remove', async () => { if (!confirm(`Remove ${c.computer.name} from this browser? Remove this browser on the computer too (Account › Your browsers).`)) return; await cloud.forgetComputer(c.id); views.delete(c.id); render(); });
    li.append(el('span', '▭', 'avatar pc'), t, rm);
    wl.append(li);
  }
  // Adding this browser to a computer (from its link).
  show('addCard', !!browserLink);
  if (browserLink) {
    $('addComputer').textContent = browserLink.n || 'your computer';
    show('addForm', signed && !adding); show('addCompare', !!adding);
    // 0.16.4: the link carries the computer's account email: fill it in, one tap sends the code.
    if (!signed && browserLink.e && !pendingEmail && !$('email').value) $('email').value = browserLink.e;
    if (!signed) status('addStatus', pendingEmail ? `Step 2 of 3: type the code we emailed to ${pendingEmail} (below).` : `Step 1 of 3: sign in with ${browserLink.e || 'the same account as that computer'} (below).`);
  }
  const none = !signed || !mine.length;
  show('noComputer', none);
  $('noComputerText').textContent = !signed
    ? 'Sign in (Devices) with your account, then add this browser on a computer: VINAC Link › Account › Your browsers › Add a browser.'
    : 'Add this browser on a computer: VINAC Link › Account › Your browsers › Add a browser, then open the link it shows here.';
}
$('emailForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await cloud.sendCode($('email').value); pendingEmail = $('email').value; render(); $('code').focus(); toast('Code sent. Check your email.'); } catch (err) { toast(err.message); }
});
$('codeForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await cloud.verifyCode(pendingEmail, $('code').value); pendingEmail = null; $('code').value = ''; status('addStatus', ''); render(); loadAll(); } catch (err) { toast(err.message); }
});
$('otherEmail').addEventListener('click', () => { pendingEmail = null; render(); });
// 0.16.4: paste the whole email line ("Your code is 0581 4657") or type: digits only, and it signs in at 8.
$('code').addEventListener('input', () => {
  const d = $('code').value.replace(/\D/g, '').slice(0, 10);
  if (d !== $('code').value) $('code').value = d;
  if (d.length === 8) $('codeForm').requestSubmit();
});
$('signOutBtn').addEventListener('click', () => { cloud.signOut(); views.clear(); render(); });
cloud.whenSignedOut(() => { views.clear(); render(); });
{ // 0.16.4: a name that says which browser on which device ("Chrome on Windows").
  const ua = navigator.userAgent;
  const app = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  $('browserName').value = dev ? `${app} on ${dev}` : app;
}
$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('browserName').value.trim().slice(0, 40) || 'Browser';
  try {
    status('addStatus', 'Asking the computer…');
    const r = await cloud.addBrowser(browserLink, name);
    adding = r; $('addDigits').textContent = r.code; render();
    status('addStatus', 'Step 3 of 3: the computer shows a banner with these digits. Same digits? Press Allow there.');
    const c = await r.wait(() => adding !== r);
    adding = null; browserLink = null; status('addStatus', '');
    toast(`Added. This browser can now reach ${c.computer.name}.`); go('needs');
  } catch (err) { if (adding) adding = null; render(); status('addStatus', err.message, 'bad'); }
});
$('addCancel').addEventListener('click', () => { adding = null; browserLink = null; status('addStatus', ''); render(); });

const LABEL = { request: 'Held request', decision: 'Decision', key: 'Key request', task: 'Open task', keyOffer: 'Key to accept', run: 'Program asks', keyAsk: 'Key asked for', mention: 'Mention', pairOffer: 'Pairing request' };
async function loadAll() {
  const mine = cloud.myComputers();
  if (!cloud.signedIn() || !mine.length || loading) { renderWork(); return; }
  loading = true;
  try {
    await Promise.all(mine.map(async c => {
      try { views.set(c.id, { state: await cloud.call(c, 'state') }); }
      catch (e) { views.set(c.id, { error: e.message }); }
    }));
  } finally { loading = false; }
  renderAccount(); renderWork();
}
$('refreshBtn').addEventListener('click', () => loadAll());
setInterval(() => { if (document.visibilityState === 'visible' && ['needs', 'projects', 'rooms'].includes(tab)) loadAll(); }, 30_000);

async function act(c, op, args, done) {
  try { await cloud.call(c, op, args); toast(done); loadAll(); } catch (e) { toast(e.message); }
}
function renderWork() {
  const mine = cloud.myComputers();
  const many = mine.length > 1;
  // Needs me: every computer's, in one list.
  const ul = $('needsList'); ul.replaceChildren();
  let count = 0;
  for (const c of mine) {
    const v = views.get(c.id);
    if (v?.error) { const li = el('li', null, 'item'); li.append(el('small', c.computer.name), el('p', `Not reached: ${v.error}`, 'muted')); ul.append(li); continue; }
    for (const n of v?.state?.needsMe || []) {
      count++;
      const li = el('li', null, 'item');
      li.append(el('small', `${many ? `${c.computer.name} · ` : ''}${LABEL[n.kind] || n.kind}${n.room ? ` · # ${n.room}` : n.with ? ` · ${n.with}` : ''}`), el('b', n.title));
      const row = el('div', null, 'acts');
      const where = { room: n.roomId || undefined, to: n.peerId || undefined };
      if (n.kind === 'decision') for (const o of n.options || []) row.append(btn(o, () => act(c, 'answer', { ...where, card: n.card, option: o }, `Answered: ${o}.`)));
      else if (n.kind === 'request') row.append(btn('Approve', () => act(c, 'request', { id: n.id, approve: true }, 'Approved.'), 'btn small primary'), btn('Reject', () => act(c, 'request', { id: n.id, approve: false }, 'Rejected.')));
      else if (n.kind === 'task') row.append(btn('Claim', () => act(c, 'task', { ...where, card: n.card, action: 'claim' }, 'Claimed.')));
      else if (n.kind === 'key' && !n.local) row.append(btn('Send the key', () => { if (confirm(`Send this key from ${c.computer.name} to ${n.from}? It goes sealed to that device only.`)) act(c, 'sendKey', { card: n.card }, 'Sent.'); }, 'btn small primary'));
      else row.append(el('span', `Open VINAC Link on ${c.computer.name} for this one.`, 'muted small'));
      li.append(row); ul.append(li);
    }
  }
  if (mine.length && cloud.signedIn() && !count && ![...views.values()].some(v => v.error)) ul.append(el('li', views.size ? 'Nothing needs you right now.' : 'Loading…', 'empty'));
  ul.hidden = !mine.length || !cloud.signedIn();
  $('needsCount').textContent = count || ''; show('needsCount', count > 0);
  renderList('projects', mine, many); renderList('rooms', mine, many);
}

// Projects and Rooms: one computer at a time (chips to switch when there are several).
function renderList(kind, mine, many) {
  const chips = $(kind === 'projects' ? 'projectChips' : 'roomChips'); chips.replaceChildren();
  if (!pick[kind] || !mine.some(c => c.id === pick[kind])) pick[kind] = mine[0]?.id || null;
  if (many) for (const c of mine) { const b = btn(c.computer.name, () => { pick[kind] = c.id; renderWork(); }, `chip${c.id === pick[kind] ? ' on' : ''}`); chips.append(b); }
  const c = mine.find(x => x.id === pick[kind]);
  const ul = $(kind === 'projects' ? 'projectList' : 'roomList'); ul.replaceChildren();
  ul.hidden = !c || !cloud.signedIn();
  if (!c) return;
  const list = views.get(c.id)?.state?.[kind] || [];
  if (!list.length) { ul.append(el('li', views.get(c.id) ? `No ${kind} on ${c.computer.name} yet.` : 'Loading…', 'empty')); return; }
  for (const x of list) {
    const li = el('li', null, 'item link'); li.tabIndex = 0;
    li.append(el('b', kind === 'rooms' ? `# ${x.name}` : x.name), el('small', kind === 'rooms' ? (x.last ? `${x.last.by ? `${x.last.by}: ` : ''}${x.last.text}` : 'No posts yet.') : (x.about || '')));
    li.addEventListener('click', () => (kind === 'projects' ? openProject(c, x.id) : openRoom(c, x.id)));
    ul.append(li);
  }
}
async function openProject(c, id) {
  try {
    const v = await cloud.call(c, 'project', { id });
    const box = $('projectView'); box.hidden = false;
    box.replaceChildren(btn('‹ Projects', () => { box.hidden = true; $('projectList').hidden = false; }, 'btn quiet small'), el('h2', v.project.name, 'view-title'));
    $('projectList').hidden = true;
    for (const [label, items] of [['Open', v.board.open], ['Claimed', v.board.claimed], ['Done', v.board.done]]) {
      box.append(el('h3', `${label} (${items.length})`, 'sec'));
      const ul = el('ul', null, 'list items');
      for (const t of items) {
        const li = el('li', null, 'item'); li.append(el('b', `${t.review ? 'Review: ' : ''}${t.title}`), el('small', [t.branch && `branch ${t.branch}`, t.claimedBy && `claimed by ${t.claimedBy}`, t.doneBy && `done by ${t.doneBy}`].filter(Boolean).join(' · ')));
        const row = el('div', null, 'acts');
        if (label === 'Open' && v.room) row.append(btn('Claim', () => act(c, 'task', { room: v.room.id, card: t.id, action: 'claim' }, 'Claimed.').then(() => openProject(c, id))));
        if (label !== 'Done' && v.room) row.append(btn('Mark done', () => act(c, 'task', { room: v.room.id, card: t.id, action: 'done' }, 'Done.').then(() => openProject(c, id))));
        if (row.childElementCount) li.append(row);
        ul.append(li);
      }
      if (!items.length) ul.append(el('li', 'Nothing here.', 'empty'));
      box.append(ul);
    }
  } catch (e) { toast(e.message); }
}
async function openRoom(c, id) {
  try {
    const v = await cloud.call(c, 'room', { id });
    const box = $('roomView'); box.hidden = false; $('roomList').hidden = true;
    box.replaceChildren(btn('‹ Rooms', () => { box.hidden = true; $('roomList').hidden = false; }, 'btn quiet small'), el('h2', `# ${v.room.name}`, 'view-title'));
    const ul = el('ul', null, 'list items msgs');
    for (const m of v.messages) { const li = el('li', null, 'item'); li.append(el('small', `${m.from} · ${new Date(m.at).toLocaleString()}`), el('p', m.text)); ul.append(li); }
    if (!v.messages.length) ul.append(el('li', 'No posts yet.', 'empty'));
    const f = el('form', null, 'post stack'); const t = el('textarea'); t.rows = 2; t.maxLength = 4000; t.placeholder = 'Post in this room';
    const send = el('button', 'Post', 'btn primary block'); send.type = 'submit'; f.append(t, send);
    f.addEventListener('submit', async e => { e.preventDefault(); if (!t.value.trim()) return; try { await cloud.call(c, 'post', { room: id, text: t.value }); t.value = ''; openRoom(c, id); } catch (err) { toast(err.message); } });
    box.append(ul, f);
  } catch (e) { toast(e.message); }
}

// ---- sound -----------------------------------------------------------------------------------
let chunks = [], samples = 0, listenTimer = null, listenFor = null, decoding = false;
const engine = new AudioEngine({ onPcm: pcm => {
  if (!listenFor) return;
  chunks.push(pcm); samples += pcm.length;
  const max = (engine.context?.sampleRate || 48000) * 45; // the longest key is ~35 s of sound
  while (samples > max && chunks.length > 1) samples -= chunks.shift().length;
} });

async function play(frame, statusId, label) {
  if (playing) return false;
  playing = true;
  status(statusId, `${label}… keep the devices close, volume up.`);
  try {
    await engine.playFrame(frame, { rawBps: BEACON_BPS, tones: BEACON_TONES, fec: SECRET_FEC, amplitude: 0.3 });
    status(statusId, 'Done playing.');
    return true;
  } catch (e) { status(statusId, `Could not play sound: ${e.message}`, 'bad'); return false; }
  finally { playing = false; }
}

/** Listens for a HELLO or a key; `statusId` shows progress. Asks for the microphone. */
async function listen(statusId) {
  stopListening();
  listenFor = statusId; chunks = []; samples = 0;
  try { await engine.startReceiver(); }
  catch { listenFor = null; status(statusId, 'The microphone is blocked. Allow it for this page, or use a code instead.', 'bad'); return; }
  status(statusId, 'Listening… play the sound on the other device, close by.');
  listenTimer = setInterval(async () => {
    if (decoding || !samples || !listenFor) return;
    decoding = true;
    try {
      const pcm = new Float32Array(samples); let o = 0;
      for (const c of chunks) { pcm.set(c, o); o += c.length; }
      const r = decodeFskFrameV2(pcm, { sampleRate: engine.context.sampleRate, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: Math.min(HELLO_MIN, PHONE_SECRET_MIN), maxLength: PHONE_SECRET_MAX, accept: b => phoneFrameLooksValid(b) });
      if (!r?.ok) return;
      const keep = pcm.slice(Math.min(pcm.length, r.endSample)); chunks = keep.length ? [keep] : []; samples = keep.length;
      if (r.fecFailed) { status(statusId, 'Heard it, but the sound was damaged. Play it again, a little closer…'); return; }
      const st = listenFor;
      stopListening();
      await handleIncoming({ kind: r.frameBytes[0] === 0xc6 ? 'h' : 'k', bytes: r.frameBytes }, st);
    } catch (e) { status(statusId, `${e.message} Still listening…`); }
    finally { decoding = false; }
  }, 1000);
}
function stopListening() {
  if (!listenFor && !listenTimer) return;
  listenFor = null; clearInterval(listenTimer); listenTimer = null; chunks = []; samples = 0;
  try { engine.stopReceiver(); } catch { /* not started */ }
}

// ---- scanning a code with the camera (where the browser can read QR codes) ---------------------
let scanStream = null, scanTimer = null, scanBack = null;
async function scan(backTo, statusId) {
  if (!canScan) { status(statusId, 'This browser can\'t read codes itself: point this phone\'s camera app at the code instead.'); return; }
  scanBack = backTo;
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { status(statusId, 'The camera is blocked. Allow it for this page, or use the camera app.', 'bad'); return; }
  const v = $('scanVideo'); v.srcObject = scanStream; await v.play().catch(() => {});
  for (const id of SHEETS) show(id, false);
  show('scrim'); show('sheetScan');
  const det = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
  scanTimer = setInterval(async () => {
    try {
      const codes = await det.detect(v);
      for (const c of codes) {
        const bl = cloud.readBrowserLink(c.rawValue);
        const hit = bl ? { kind: 'w', link: bl } : readPhoneLink(c.rawValue);
        if (!hit) continue;
        stopScan(); show('sheetScan', false);
        show(scanBack); await handleIncoming(hit, scanBack === 'sheetHost' ? 'hostStatus' : 'recvStatus');
        return;
      }
    } catch { /* not ready yet */ }
  }, 300);
}
function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  scanStream?.getTracks().forEach(t => t.stop()); scanStream = null;
  const v = $('scanVideo'); if (v) v.srcObject = null;
}
$('scanCancel').addEventListener('click', () => { stopScan(); show('sheetScan', false); if (scanBack) show(scanBack); else closeSheets(); });

// ---- anything that arrives: a pairing code, a phone's answer, a key, a computer's browser link ----------
async function handleIncoming(item, statusId = 'recvStatus') {
  if (!item) return;
  if (item.kind === 'w') { browserLink = item.link; closeSheets(); go('devices'); return; }
  if (item.kind === 'p') { pending = item.pair; pairing = null; $('pairQr').replaceChildren(); closeSheets(); go('devices'); return; }
  if (item.kind === 'h') {
    if (!data.hosting) { toast('No pairing is waiting on this device: press "Pair another phone" first.'); return; }
    try {
      hostFound = await hostHello(data.hosting, item.bytes);
      if ($('sheetHost').hidden) openSheet('sheetHost');
      renderHost();
    } catch (e) { if ($('sheetHost').hidden) toast(e.message); else status('hostStatus', e.message, 'bad'); }
    return;
  }
  if (item.kind === 'k') {
    try {
      received = await openKey(devices(), item.bytes);
      if ($('sheetReceive').hidden) openSheet('sheetReceive');
      renderReceive();
    } catch (e) { if ($('sheetReceive').hidden) toast(e.message); else status(statusId, e.message, 'bad'); }
  }
}

// ---- create, unlock, lock --------------------------------------------------------------------
async function opened() {
  bump(); render();
  const item = incoming; incoming = null;
  if (item) await handleIncoming(item);
}
$('createForm').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('newPass').value !== $('newPass2').value) { toast('The two passphrases differ.'); return; }
  const salt = newSalt();
  key = await vaultKey($('newPass').value, unb64u(salt));
  data = { phoneName: cleanName($('phoneName').value, 20) || 'My phone', keys: [], computers: [] };
  localStorage.setItem(STORE, JSON.stringify({ v: 1, salt, iterations: PBKDF2_ITERATIONS, box: await sealVault(key, data) }));
  $('newPass').value = $('newPass2').value = '';
  navigator.storage?.persist?.().catch(() => {});
  await opened();
});
$('unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const s = saved();
  status('unlockStatus', 'Unlocking…');
  try {
    const k = await vaultKey($('pass').value, unb64u(s.salt), s.iterations || PBKDF2_ITERATIONS);
    data = await openVault(k, s.box); key = k;
    for (const c of data.computers) { c.role ??= 'guest'; c.kind ??= 'computer'; c.seen ??= 0; }
    if (data.hosting && data.hosting.expires < Date.now()) data.hosting = null;
    $('pass').value = ''; status('unlockStatus', '');
    await opened();
  } catch { status('unlockStatus', 'Wrong passphrase.', 'bad'); }
});
$('lockBtn').addEventListener('click', lock);
$('keySearch').addEventListener('input', render);

// ---- pairing as the guest (this device opened the other device's code) -------------------------------
async function makeHello() {
  if (!pairing) pairing = await pairWithComputer(pending.raw, data.phoneName);
  return pairing;
}
$('pairShow').addEventListener('click', async () => {
  try { const p = await makeHello(); drawQr('pairQr', phoneLink('h', p.hello)); render(); }
  catch (e) { status('pairStatus', e.message, 'bad'); }
});
$('pairPlay').addEventListener('click', async () => {
  try { const p = await makeHello(); render(); await play(p.hello, 'pairStatus', 'Playing the pairing sound'); }
  catch (e) { status('pairStatus', e.message, 'bad'); }
});
$('pairDone').addEventListener('click', async () => {
  data.computers = devices().filter(c => c.name !== pairing.computer.name); // pairing again replaces it
  data.computers.push(pairing.computer);
  await persist();
  const name = pending.name;
  pending = null; pairing = null; $('pairQr').replaceChildren(); go('devices');
  toast(`Paired with ${name}.`);
});
$('pairCancel').addEventListener('click', () => { pending = null; pairing = null; $('pairQr').replaceChildren(); render(); });

// ---- pairing as the host (another phone opens this device's code) ---------------------------------
function renderHost() {
  show('hostWait', !hostFound); show('hostConfirm', !!hostFound);
  if (hostFound) { $('hostName').textContent = hostFound.name; $('hostCode').textContent = hostFound.code; status('hostStatus', ''); }
  show('hostScan', canScan);
}
$('hostBtn').addEventListener('click', async () => {
  try {
    if (!data.hosting || data.hosting.expires < Date.now()) { data.hosting = (await hostStart(data.phoneName)).pending; await persist(); }
    hostFound = null;
    drawQr('hostQr', data.hosting.link);
    openSheet('sheetHost'); renderHost(); status('hostStatus', '');
  } catch (e) { toast(e.message); }
});
$('hostScan').addEventListener('click', () => scan('sheetHost', 'hostStatus'));
$('hostListen').addEventListener('click', () => listen('hostStatus'));
$('hostAllow').addEventListener('click', async () => {
  const r = hostFound.record;
  data.computers = devices().filter(c => !(c.phoneId === r.phoneId && c.role === 'host'));
  data.computers.push(r); data.hosting = null; hostFound = null;
  await persist(); closeSheets(); go('devices');
  toast(`Paired with ${r.name}. Tell the other phone to tap "The other phone says Paired".`);
});
$('hostCancel').addEventListener('click', async () => { data.hosting = null; hostFound = null; await persist(); closeSheets(); });

// ---- receiving a key ---------------------------------------------------------------------------
function renderReceive() {
  show('recvWays', !received); show('recvGot', !!received);
  if (received) {
    $('recvName').textContent = received.name; $('recvFrom').textContent = received.record.name;
    show('recvReplace', data.keys.some(k => k.name === received.name));
    status('recvStatus', '');
  }
  show('recvScan', canScan);
}
$('receiveBtn').addEventListener('click', () => { received = null; openSheet('sheetReceive'); renderReceive(); status('recvStatus', ''); });
$('recvScan').addEventListener('click', () => scan('sheetReceive', 'recvStatus'));
$('recvListen').addEventListener('click', () => listen('recvStatus'));
$('recvSave').addEventListener('click', async () => {
  const r = received; if (!r) return;
  r.record.seen = Math.max(r.record.seen || 0, r.counter); // that code or sound can't be used again
  data.keys = data.keys.filter(k => k.name !== r.name);
  data.keys.push({ name: r.name, value: r.value, addedAt: new Date().toISOString(), from: r.record.name });
  data.keys.sort((a, b) => a.name.localeCompare(b.name));
  received = null;
  await persist(); closeSheets(); go('keys'); toast(`${r.name} saved.`);
});
$('recvCancel').addEventListener('click', () => { received = null; closeSheets(); });

// ---- add and send ------------------------------------------------------------------------------
$('addKeyBtn').addEventListener('click', () => { $('addKeyForm').reset(); openSheet('sheetAdd'); });
$('addKeyCancel').addEventListener('click', closeSheets);
$('addKeyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('keyName').value.trim(), value = $('keyValue').value;
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) { toast('Names use letters, digits, _ . - (up to 40).'); return; }
  if (new TextEncoder().encode(value).length > 200) { toast('A value can be up to 200 bytes.'); return; }
  data.keys = data.keys.filter(k => k.name !== name);
  data.keys.push({ name, value, addedAt: new Date().toISOString() });
  data.keys.sort((a, b) => a.name.localeCompare(b.name));
  await persist();
  closeSheets(); render(); toast(`${name} saved.`);
});

// Where a key can go: devices paired by code or sound ("v:<index>"), and computers through the account ("c:<id>").
function sendTarget() {
  const v = $('sendTo').value;
  if (v.startsWith('c:')) { const c = cloud.myComputers().find(x => x.id === v.slice(2)); return c && { net: true, c }; }
  const d = devices()[Number(v.slice(2)) || 0];
  return d && { net: false, d };
}
function renderSend() {
  const t = sendTarget(), net = !!t?.net, phone = !net && t?.d?.kind === 'phone';
  show('sendNet', net); show('sendStepsPc', !net && !phone); show('sendPhone', phone); show('sendPlay', !net);
  $('sendQr').replaceChildren(); show('sendMakeQr', true); sendFrame = null;
  $('sendPlay').textContent = phone ? 'Send by sound instead (encrypted)' : 'Send encrypted key by sound';
  $('sendPlay').className = phone ? 'btn block' : 'btn primary block';
  status('sendStatus', '');
}
$('keySend').addEventListener('click', () => {
  const k = data.keys[current];
  const nets = cloud.signedIn() ? cloud.myComputers() : [];
  if (!devices().length && !nets.length) { toast('Pair a device first, or sign in to reach your computers (Devices).'); return; }
  $('sendName').textContent = k.name;
  const sel = $('sendTo'); sel.replaceChildren();
  for (const c of nets) sel.append(new Option(`${c.computer.name} (through your account)`, `c:${c.id}`));
  devices().forEach((d, i) => sel.append(new Option(`${d.name}${d.kind === 'phone' ? ' (phone, code or sound)' : ' (sound)'}`, `v:${i}`)));
  show('sendToRow', sel.options.length > 1);
  openSheet('sheetSend'); renderSend();
});
$('sendTo').addEventListener('change', renderSend);
$('sendNow').addEventListener('click', async () => {
  const k = data.keys[current], t = sendTarget();
  if (!t?.net) return;
  try {
    status('sendStatus', `Sending ${k.name} to ${t.c.computer.name}…`);
    await cloud.call(t.c, 'giveKey', { name: k.name, value: k.value });
    status('sendStatus', `Sent. ${t.c.computer.name} keeps ${k.name} as a key from this browser.`, 'ok');
  } catch (e) { status('sendStatus', e.message, 'bad'); }
});
async function sealCurrent() {
  const k = data.keys[current], c = sendTarget().d;
  const { frame, counter } = await sealKey(c, k.name, k.value);
  c.counter = counter; await persist(); // a newer number every time: a replayed code or sound is refused there
  return { frame, k, c };
}
$('sendMakeQr').addEventListener('click', async () => {
  try {
    const { frame, k, c } = await sealCurrent();
    sendFrame = frame;
    drawQr('sendQr', phoneLink('k', frame)); show('sendMakeQr', false);
    status('sendStatus', `Sealed for ${c.name} only. When it says it saved ${k.name}, close this.`, 'ok');
  } catch (e) { status('sendStatus', e.message, 'bad'); }
});
$('sendPlay').addEventListener('click', async () => {
  try {
    const { frame, k, c } = sendFrame ? { frame: sendFrame, k: data.keys[current], c: sendTarget().d } : await sealCurrent();
    if (await play(frame, 'sendStatus', `Sending ${k.name} to ${c.name}`)) {
      status('sendStatus', `Played. ${c.name} should say it received ${k.name}. If not, check it's listening and play again.`, 'ok');
    }
  } catch (e) { status('sendStatus', e.message, 'bad'); }
});
$('sendCancel').addEventListener('click', closeSheets);

// ---- start -------------------------------------------------------------------------------------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
(async () => {
  await cloud.loadComputers();
  tab = browserLink ? 'devices'
    : incoming ? 'keys' // unlock first; a pairing code then moves to Devices
      : cloud.signedIn() && cloud.myComputers().length ? 'needs' : 'keys';
  render();
  if (tab === 'needs') loadAll();
})();
