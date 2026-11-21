// VINAC Link page. Talks only to this device's daemon (same origin).
// Conversations with paired devices, plus the pairing flow (sound or typed code).
import { AudioEngine } from '/lab/js/audio.js';
import { decodeFskFrameV2 } from '/lab/js/modem.js';
import { BEACON_BYTES, BEACON_TONES, BEACON_BPS, BEACON_FEC, decodeBeacon, fromHex, toHex } from '/web/beacon.js';
import { SECRET_FEC, SECRET_MIN_BYTES, SECRET_MAX_BYTES, secretFrameLooksValid } from '/web/secret-frame.js';
import { codedLength } from '/lab/js/fec.js';

const TOKEN = document.querySelector('meta[name="ui-token"]').content;
const $ = id => document.getElementById(id);
const app = $('app'), card = $('pairCard');
const KEYSTORE = { dpapi: 'Key kept by Windows DPAPI', keychain: 'Key kept in the macOS Keychain', 'secret-service': 'Key kept in the system keyring', file: 'Key kept in a user-only file' };
const VIEW_OF = { announcing: 'announcing', listening: 'listening', connecting: 'connecting', exchanging: 'connecting', comparing: 'comparing' };
const GROUP_MS = 5 * 60_000;
const ICON = {
  reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7L5 12l5 5M5 12h9a5 5 0 0 1 5 5v1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
};

// Per-viewer conveniences only; the page works without them.
const LS = {
  get(k, d) { try { const v = localStorage.getItem(`vinac.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`vinac.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

// Appearance: Auto (system), Light or Dark; remembered in this browser only.
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === (choice || 'system')));
}
applyTheme(LS.get('theme', 'system'));
for (const b of document.querySelectorAll('[data-theme-choice]')) b.onclick = () => { LS.set('theme', b.dataset.themeChoice); applyTheme(b.dataset.themeChoice); };

// Help & about: links to the docs, support, terms, privacy and the license (they open in the browser).
const helpModal = $('helpModal');
const closeHelp = () => { helpModal.hidden = true; $('helpBtn').focus(); };
$('helpBtn').onclick = () => { helpModal.hidden = false; $('helpClose').focus(); };
$('helpClose').onclick = closeHelp;
helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !helpModal.hidden) closeHelp(); });

let state = null, lastPaired = null, firstLoad = true;
let selected = LS.get('selected', null), wantPair = false, wantSecrets = false, wantFirewall = false, wantOverview = true, mobileMain = false;
let thread = [], threadKey = '', justOpened = true, search = '', replyTo = null;
let pending = [];                          // messages typed here that are sending or failed
let lastSeen = LS.get('lastSeen', {});     // peer id -> time of the last incoming message the person saw
let notifyOn = LS.get('notify', false);
const known = new Set();                   // incoming ids already noticed (for notifications)

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'x-ui-token': TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 4500);
}

async function act(method, path, body) {
  try { render(await api(method, path, body)); } catch (e) { toast(e.message); }
}

// ---- small helpers ----------------------------------------------------------

const peerById = id => state?.peers.find(p => p.id === id);
const convoOf = id => state?.conversations.find(c => c.peerId === id);
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
function colorFor(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; }
function avatar(el, peer) {
  el.textContent = initials(peer?.name); el.style.setProperty('--av', colorFor(peer?.id));
  el.dataset.online = peer?.online == null ? '' : String(peer.online);
}
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const clock = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(iso) {
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function shortWhen(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(iso);
  if ((now - d) < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const personUnread = c => (c?.incoming || []).filter(x => x.at > (lastSeen[c.peerId] || '')).length;
const flat = t => t.replace(/`+/g, '').replace(/\s+/g, ' ').trim(); // one-line preview
const isNarrow = () => matchMedia('(max-width: 760px)').matches;

// ---- rendering --------------------------------------------------------------

function render(s) {
  state = s;
  const d = s.device, p = s.pairing;
  $('deviceLine').textContent = d.name;
  $('deviceLine').title = d.fingerprint;
  $('keyPill').textContent = `${KEYSTORE[d.keystore] || d.keystore} · ${d.fingerprint}`;
  $('keyPill').title = d.keystoreNote || '';
  $('helpVersion').textContent = d.version ? `v${d.version}` : '';
  $('aboutVersion').textContent = `Version ${d.version || '?'} · protocol v${d.protocol}`;

  if (selected && !peerById(selected)) selected = null;

  const pairing = !!(p && VIEW_OF[p.state]);
  const main = pairing || wantPair ? 'pair' : wantSecrets ? 'secrets' : wantFirewall ? 'firewall'
    : selected && !wantOverview ? 'thread' : s.peers.length ? 'overview' : 'empty';
  app.dataset.main = main;
  app.dataset.pane = main === 'pair' || main === 'secrets' || main === 'firewall' || ((main === 'thread' || main === 'overview') && mobileMain) || (main === 'empty' && !s.peers.length) ? 'main' : 'list';
  $('overviewNav').setAttribute('aria-current', String(main === 'overview'));

  renderPairing(p);
  renderConvos();
  const uses = s.secretUses || [];
  $('secretsCount').textContent = uses.length ? `${uses.length} waiting` : s.secrets.length || '';
  for (const u of uses) if (!seenUses.has(u.id)) { seenUses.add(u.id); toast(`A program asks to use ${u.names.join(', ')}. Open Secrets to approve or deny.`); }
  $('secretsNav').setAttribute('aria-current', String(main === 'secrets'));
  $('firewallCount').textContent = s.waitingRequests || '';
  $('firewallCount').title = s.waitingRequests ? `${s.waitingRequests} request(s) waiting for you` : '';
  $('firewallNav').setAttribute('aria-current', String(main === 'firewall'));
  if (main === 'secrets') renderSecrets();
  if (main === 'firewall' || main === 'overview') loadFirewall();
  if (main === 'overview') renderOverview();
  if (main === 'thread') { renderHead(); loadThread(); } else { $('info').hidden = true; }
  if (!$('info').hidden) renderInfo();
  noticeNew();
  markSeen();
  syncAudio(p);
  firstLoad = false;
}

function sortedConvos() {
  return state.peers.map(peer => ({ peer, c: convoOf(peer.id) }))
    .sort((a, b) => (b.c?.last?.sentAt || b.peer.pairedAt).localeCompare(a.c?.last?.sentAt || a.peer.pairedAt));
}

function renderConvos() {
  const q = $('convoSearch').value.trim().toLowerCase();
  const nav = $('convos'); nav.replaceChildren();
  let shown = 0;
  for (const { peer, c } of sortedConvos()) {
    const last = c?.last;
    if (q && !peer.name.toLowerCase().includes(q) && !(last?.text || '').toLowerCase().includes(q)) continue;
    shown++;
    const unread = personUnread(c);
    const b = document.createElement('button');
    b.className = `convo${unread ? ' unread' : ''}`;
    b.setAttribute('aria-current', String(peer.id === selected && app.dataset.main === 'thread'));
    const av = document.createElement('span'); av.className = 'avatar'; avatar(av, peer);
    const name = document.createElement('b'); name.textContent = peer.name;
    const when = document.createElement('time'); when.textContent = last ? shortWhen(last.sentAt) : '';
    const prev = document.createElement('span'); prev.className = 'preview';
    prev.textContent = last ? `${last.direction === 'sent' ? (last.by === 'agent' ? 'Your agent: ' : 'You: ') : ''}${flat(last.text)}`
      : peer.canMessage ? 'No messages yet' : 'Pair again to message';
    b.append(av, name, when, prev);
    if (unread) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = unread > 99 ? '99+' : unread; b.append(badge); }
    b.onclick = () => select(peer.id);
    nav.append(b);
  }
  if (!shown) {
    const none = document.createElement('p'); none.className = 'none';
    none.textContent = q ? 'Nothing matches.' : 'No paired devices yet. Pair one to start a conversation.';
    nav.append(none);
  }
  const total = state.conversations.reduce((n, c) => n + personUnread(c), 0);
  document.title = total ? `(${total}) VINAC Link` : 'VINAC Link';
}

function renderHead() {
  const peer = peerById(selected); if (!peer) return;
  avatar($('headAvatar'), peer);
  $('headName').textContent = peer.name;
  $('headStatus').textContent = `${peer.online === true ? 'Online' : peer.online === false ? 'Offline' : 'Checking…'} · ${peer.fingerprint}`;
  const banner = $('banner');
  if (!peer.canMessage) { banner.hidden = false; banner.textContent = 'This device was paired before messaging existed. Remove it and pair again to send messages.'; }
  else if (peer.online === false) { banner.hidden = false; banner.textContent = `${peer.name} seems to be offline. Messages go directly to the device and are not queued, so sending will fail until VINAC Link runs there.`; }
  else banner.hidden = true;
  $('composeText').disabled = $('sendBtn').disabled = $('attachBtn').disabled = !peer.canMessage;
}

async function loadThread() {
  const c = convoOf(selected);
  const key = `${selected}:${c?.total}:${c?.last?.id}:${c?.agentUnread}:${c?.waiting}:${state.waitingRequests}`;
  if (key === threadKey) return;
  threadKey = key;
  const peer = selected;
  try {
    const r = await api('GET', `/ui/messages?peer=${encodeURIComponent(peer)}`);
    if (peer !== selected) return;
    thread = r.messages;
    renderThread();
  } catch (e) { threadKey = ''; toast(e.message); }
}

function renderThread() {
  const box = $('thread');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const q = search.trim().toLowerCase();
  const all = [...thread, ...pending.filter(m => m.peer.id === selected)];
  const list = q ? all.filter(m => m.text.toLowerCase().includes(q)) : all;
  $('searchCount').textContent = q ? `${list.length} found` : '';
  box.replaceChildren();

  if (!list.length) {
    if (q) { const none = document.createElement('p'); none.className = 'none'; none.textContent = 'No messages match.'; box.append(none); }
    else box.append(emptyEl('div', 'bubbles', 'Say hello', 'Write a message below, or ask your AI agent to use vinac_send. Messages go straight to the device, encrypted.'));
  }
  let prev = null;
  for (const m of list) {
    if (!prev || !sameDay(prev.sentAt, m.sentAt)) {
      const day = document.createElement('div'); day.className = 'day'; day.textContent = dayLabel(m.sentAt); box.append(day); prev = null;
    }
    const cont = prev && prev.direction === m.direction && prev.by === m.by && new Date(m.sentAt) - new Date(prev.sentAt) < GROUP_MS && !q;
    box.append(messageEl(m, cont, q));
    prev = m;
  }
  if (justOpened || atBottom) box.scrollTop = box.scrollHeight;
  justOpened = false;
}

const KEY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/></svg>';

function messageEl(m, cont, q) {
  if (m.kind === 'secret') {
    // A secret was sent or received. The note never holds the value.
    const el = document.createElement('div'); el.className = 'note'; el.dataset.id = m.id;
    el.innerHTML = KEY_SVG;
    const t = document.createElement('span'); highlight(t, m.text, q);
    const time = document.createElement('small'); time.textContent = clock(m.sentAt);
    el.append(t, time);
    return el;
  }
  const out = m.direction === 'sent';
  const el = document.createElement('div');
  el.className = `msg ${out ? 'out' : 'in'}${cont ? ' cont' : ''}${m.status ? ` ${m.status}` : ''}`;
  el.dataset.id = m.id;
  if (!m.status) el.tabIndex = 0; // tap or Tab to reach Reply / Copy

  const who = document.createElement('div'); who.className = 'who';
  if (!out) { const n = document.createElement('span'); n.textContent = m.peer.name; who.append(n); }
  if (m.by) { const tag = document.createElement('span'); tag.className = `tag${m.by === 'person' ? ' person' : ''}`; tag.textContent = m.by === 'agent' ? 'Agent' : out ? 'You' : 'Person'; who.append(tag); }
  if (who.childElementCount) el.append(who);

  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (m.intent) {
    const r = text('span', `Request · ${m.intent}`); r.className = 'request';
    if (m.args) r.title = JSON.stringify(m.args, null, 1);
    bubble.append(r);
  }
  if (m.intent === 'document.file.share' && m.args?.file) {
    const dl = button(`Download ${m.args.name} (${kb(m.args.size)})`, () => downloadFile(m.args.file, m.args.name));
    dl.className = 'ghost filebtn';
    queueMicrotask(() => bubble.append(dl));
  }
  if (m.replyTo) {
    const orig = thread.find(x => x.id === m.replyTo);
    const quote = document.createElement('button'); quote.className = 'quote'; quote.type = 'button';
    quote.textContent = orig ? `${orig.direction === 'sent' ? 'You' : orig.peer.name}: ${flat(orig.text)}` : 'Reply to an earlier message';
    if (orig) quote.onclick = () => jumpTo(orig.id);
    bubble.append(quote);
  }
  rich(bubble, m.text, q);
  el.append(bubble);

  const meta = document.createElement('div'); meta.className = 'meta';
  const time = document.createElement('span'); time.textContent = clock(m.sentAt); time.title = new Date(m.sentAt).toLocaleString();
  meta.append(time);
  if (m.status === 'sending') meta.append(text('span', '· Sending…'));
  else if (m.status === 'failed') {
    const f = text('span', '· Not delivered'); f.className = 'fail'; f.title = m.error || ''; meta.append(f);
    meta.append(button('Retry', () => { pending = pending.filter(x => x !== m); sendMessage(m.text, m.replyTo); }));
    meta.append(button('Discard', () => { pending = pending.filter(x => x !== m); renderThread(); }));
  } else if (out) meta.append(text('span', '· Delivered'));
  else if (m.firewall && !['allowed', 'approved'].includes(m.firewall.status)) {
    const f = button(`· ${FW_LABEL[m.firewall.status]}`, () => openFirewall());
    f.className = `linkish fw-${m.firewall.status}`; meta.append(f);
  } else meta.append(text('span', m.read ? '· Your agent read this' : '· Not yet read by your agent'));
  el.append(meta);

  if (!m.status) {
    const tools = document.createElement('div'); tools.className = 'tools';
    tools.append(iconButton('reply', 'Reply', () => startReply(m)), iconButton('copy', 'Copy text', async () => {
      try { await navigator.clipboard.writeText(m.text); toast('Copied.'); } catch { toast('Could not copy.'); }
    }));
    el.append(tools);
  }
  return el;
}

const text = (tag, t) => { const e = document.createElement(tag); e.textContent = t; return e; };
function button(label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; return b; }

// Small line illustrations for empty lists (fixed strings, theme colours from CSS).
const ART = {
  shield: '<path class="a" d="M80 12l32 12v24c0 22-14 37-32 44-18-7-32-22-32-44V24l32-12Z"/><path class="s" d="M66 51l10 10 19-20"/>',
  flow: '<rect class="a" x="22" y="26" width="46" height="34" rx="8"/><rect class="a" x="92" y="50" width="46" height="34" rx="8"/><path class="s" d="M32 38h26M32 48h16M102 62h26M102 72h16M72 40h20l-6-6M88 70H68l6 6"/>',
  key: '<circle class="a" cx="58" cy="58" r="20"/><circle class="s" cx="58" cy="58" r="7"/><path class="s" d="M73 45l38-26M100 27l8 11M91 33l6 8"/>',
  bubbles: '<path class="a" d="M24 22h70a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10H48l-16 12V64h-8a10 10 0 0 1-10-10V32a10 10 0 0 1 10-10Z"/><path class="b" d="M136 46H82a10 10 0 0 0-10 10v18a10 10 0 0 0 10 10h34l14 10V84h6a10 10 0 0 0 10-10V56a10 10 0 0 0-10-10Z"/><path class="s" d="M36 38h44M36 48h28"/>',
  pulse: '<rect class="a" x="18" y="18" width="124" height="70" rx="12"/><path class="s" d="M30 58h22l8-18 12 34 10-26 6 10h42"/>',
};
function emptyEl(tag, kind, title, body) {
  const el = document.createElement(tag); el.className = 'none empty-state';
  const art = document.createElement('div'); art.className = 'art';
  art.innerHTML = `<svg viewBox="0 0 160 100" aria-hidden="true">${ART[kind]}<circle class="d" cx="16" cy="18" r="3"/><circle class="d" cx="146" cy="16" r="2"/><circle class="d" cx="150" cy="92" r="3"/></svg>`;
  el.append(art);
  if (title) el.append(text('b', title));
  el.append(text('span', body));
  return el;
}
function iconButton(icon, label, fn) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'icon'; b.title = label; b.setAttribute('aria-label', label);
  b.innerHTML = ICON[icon]; b.onclick = fn; return b;
}

/** Plain text with ```code blocks``` and `inline code`; never parses HTML. */
function rich(parent, body, q) {
  const parts = body.split('```');
  parts.forEach((part, i) => {
    // The <pre> is a block already, so drop the line breaks right next to it.
    if (!(i % 2)) { if (i > 0) part = part.replace(/^\n/, ''); if (i < parts.length - 1) part = part.replace(/\n$/, ''); }
    if (i % 2) {
      const pre = document.createElement('pre');
      highlight(pre, part.replace(/^[\w+-]*\n/, '').replace(/\n$/, ''), q);
      parent.append(pre);
    } else {
      part.split('`').forEach((bit, j) => {
        if (j % 2 && bit) { const c = document.createElement('code'); highlight(c, bit, q); parent.append(c); }
        else highlight(parent, j % 2 ? '``' : bit, q);
      });
    }
  });
}
function highlight(parent, str, q) {
  if (!q) { parent.append(str); return; }
  const lower = str.toLowerCase(); let at = 0, i;
  while ((i = lower.indexOf(q, at)) >= 0) {
    parent.append(str.slice(at, i));
    const mk = document.createElement('mark'); mk.textContent = str.slice(i, i + q.length); parent.append(mk);
    at = i + q.length;
  }
  parent.append(str.slice(at));
}

function jumpTo(id) {
  if (search) { search = ''; $('threadSearch').value = ''; $('searchBar').hidden = true; renderThread(); }
  const el = $('thread').querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ---- secrets received --------------------------------------------------------

const KEYSTORE_SHORT = { dpapi: 'Windows DPAPI', keychain: 'Keychain', 'secret-service': 'keyring', file: 'user-only file' };
let shownSecret = null, secretsKey = '';
const seenUses = new Set();

// `vinac run`: a program asks to start with secrets in its environment. The person
// sees the command it says it will run, and approves this one run or denies it.
function renderUses() {
  const uses = state.secretUses || [];
  $('useBox').hidden = !uses.length;
  const list = $('useList'); list.replaceChildren();
  for (const u of uses) {
    const li = document.createElement('li'); li.className = 'secret';
    li.append(text('b', `Use ${u.names.join(', ')}?`));
    const cmd = text('code', u.command); cmd.className = 'use-cmd';
    const row = document.createElement('div'); row.className = 'row';
    const yes = button('Approve this run', () => act('POST', '/ui/secret-use/decide', { id: u.id, approve: true }));
    const no = button('Deny', () => act('POST', '/ui/secret-use/decide', { id: u.id, approve: false }));
    yes.className = 'primary small-btn'; no.className = 'ghost';
    row.append(yes, no);
    li.append(row, cmd, text('small', `In ${u.cwd || 'an unknown folder'} · expires in ${u.expiresIn} s · the program gets the value; check that you started this command.`));
    list.append(li);
  }
}

function renderSecrets(force = false) {
  const q = ($('secretSearch').value || '').trim().toLowerCase();
  const key = JSON.stringify(state.secrets) + shownSecret?.id + JSON.stringify((state.secretUses || []).map(u => u.id)) + q;
  if (key === secretsKey && !force) return;
  secretsKey = key;
  renderUses();
  const list = $('secretList'); list.replaceChildren();
  $('secretSearch').hidden = state.secrets.length < 4 && !q;
  if (!state.secrets.length) {
    list.append(emptyEl('li', 'key', 'Your vault is empty', 'Add a key you have, or receive one from a paired device. Values stay in this computer\'s key store, never in a chat, and agents see only their names.'));
    return;
  }
  const shown = [...state.secrets].reverse().filter(s => !q || s.name.toLowerCase().includes(q) || (s.from?.name || '').toLowerCase().includes(q));
  if (!shown.length) { const li = text('li', 'No secret matches.'); li.className = 'none'; list.append(li); return; }
  const when = iso => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  for (const s of shown) {
    const li = document.createElement('li'); li.className = 'secret';
    const name = text('b', s.name);
    if (s.pending) { const t = text('span', 'Replacement waiting'); t.className = 'pendingtag'; name.append(t); }
    const origin = s.own ? `Added on this device · ${when(s.receivedAt)}` : `From ${s.from.name} · ${when(s.receivedAt)} · by ${s.via === 'wifi' ? 'Wi-Fi' : 'sound'}`;
    const meta = text('small', `${origin} · ${KEYSTORE_SHORT[s.keystore] || s.keystore}${s.lastUsedAt ? ` · last used ${when(s.lastUsedAt)}` : ''}${s.pending ? ' · approve to replace the current one' : ''}`);
    const row = document.createElement('div'); row.className = 'row';
    const showing = shownSecret?.id === s.id;
    const reveal = button(showing ? 'Hide' : 'Reveal', async () => {
      if (showing) { hideSecret(); return; }
      try { const r = await api('POST', '/ui/secrets/reveal', { id: s.id }); showSecret(r); } catch (e) { toast(e.message); }
    });
    const copy = button('Copy', async () => {
      try {
        const r = await api('POST', '/ui/secrets/reveal', { id: s.id });
        await navigator.clipboard.writeText(r.value);
        toast(`${s.name} copied. Paste it where it's needed, then copy something else to clear it.`);
      } catch (e) { toast(e.message.includes('clipboard') ? 'Could not copy.' : e.message); }
    });
    const del = button(s.pending ? 'Reject' : 'Delete', () => {
      if (!confirmRemove(s.name)) return;
      if (showing) hideSecret();
      act('POST', '/ui/secrets/delete', { id: s.id });
    });
    const buttons = [reveal, copy, del];
    if (!s.pending) buttons.splice(2, 0, button('Send…', () => openSecretModal('stored', { item: s })));
    if (s.pending) buttons.unshift(button('Approve', () => act('POST', '/ui/secrets/approve', { id: s.id })));
    for (const b of buttons) b.className = 'ghost';
    if (s.pending) buttons[0].className = 'primary small-btn';
    row.append(...buttons);
    li.append(name, row, meta);
    if (showing) { const v = text('code', shownSecret.value); v.className = 'value'; li.append(v); }
    list.append(li);
  }
}

function showSecret(r) {
  shownSecret = r;
  clearTimeout(showSecret.timer);
  showSecret.timer = setTimeout(hideSecret, 30_000); // hide again after 30 s
  renderSecrets(true);
}
function hideSecret() { shownSecret = null; clearTimeout(showSecret.timer); if (state) renderSecrets(true); }

$('secretsNav').onclick = () => { wantSecrets = true; wantPair = false; wantFirewall = false; mobileMain = true; render(state); };
$('secretsBackBtn').onclick = () => { wantSecrets = false; mobileMain = false; hideSecret(); render(state); };

// ---- firewall: requests (intents) from paired devices ---------------------

const FW_LABEL = { pending: 'Waiting for you', blocked: 'Blocked by your firewall', rejected: 'Rejected by you', allowed: 'Allowed by a rule', approved: 'Approved by you' };
const RISK_LABEL = { text: 'Plain messages', info: 'Asks or tells something', read: 'Looks things up', change: 'Creates or changes things', high: 'Changes files or runs commands' };
const INTENT_LABEL = { '@text': 'Plain messages (no intent)' };
const kb = n => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

/** Downloads a shared file (the request needs the page token, so a plain link won't do). */
async function downloadFile(fileId, name) {
  try {
    const r = await fetch(`/ui/file?id=${encodeURIComponent(fileId)}`, { headers: { 'x-ui-token': TOKEN } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) { toast(e.message); }
}
const DECISION_LABEL = { allow: 'Allow', ask: 'Ask me', block: 'Block' };
let fw = null, fwKey = '', fwScope = '*', fwLoading = false;

function openFirewall() { wantFirewall = true; wantSecrets = false; wantPair = false; mobileMain = true; render(state); }
$('firewallNav').onclick = openFirewall;

// ---- overview: the dashboard ------------------------------------------------------

function openOverview() { wantOverview = true; wantFirewall = false; wantSecrets = false; wantPair = false; mobileMain = true; render(state); }
$('overviewNav').onclick = openOverview;
$('overviewBackBtn').onclick = () => { mobileMain = false; render(state); };
$('ovFirewallLink').onclick = openFirewall;
$('ovReceiveBtn').onclick = () => { wantSecrets = true; wantFirewall = false; wantPair = false; mobileMain = true; render(state); openSecretModal('receive'); };
const ICON_PATH = {
  devices: '<rect x="3" y="4" width="13" height="10" rx="1.5"/><path d="M7 18h5M9.5 14v4"/><rect x="17.5" y="8" width="4" height="10" rx="1"/>',
  waiting: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  messages: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  blocked: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z"/><path d="M9 9l6 6M15 9l-6 6"/>',
};
const svgIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON_PATH[name]}</svg>`;

function kpi({ icon, label, value, sub, tone = '', onclick }) {
  const el = document.createElement(onclick ? 'button' : 'div');
  el.className = `kpi${tone ? ` ${tone}` : ''}`;
  if (onclick) { el.type = 'button'; el.onclick = onclick; }
  const ic = document.createElement('span'); ic.className = 'kpi-icon'; ic.innerHTML = svgIcon(icon);
  const v = text('b', String(value)); const l = text('span', label); const s = text('small', sub || '');
  const body = document.createElement('div'); body.className = 'kpi-body'; body.append(l, v, s);
  el.append(ic, body);
  return el;
}

function renderOverview() {
  if (!state) return;
  const s = state, d = s.device;
  const today = new Date().toDateString();
  const online = s.peers.filter(p => p.online === true).length;
  const inToday = s.conversations.reduce((n, c) => n + (c.incoming || []).filter(x => new Date(x.at).toDateString() === today).length, 0);
  const week = Date.now() - 7 * 864e5;
  const reqs = fw?.requests || [];
  const blocked = reqs.filter(r => ['blocked', 'rejected'].includes(r.firewall.status) && new Date(r.receivedAt || r.sentAt) > week).length;
  $('ovSubtitle').textContent = `${d.name} · ${s.peers.length} paired device${s.peers.length === 1 ? '' : 's'}`;

  $('ovKpis').replaceChildren(
    kpi({ icon: 'devices', label: 'Paired devices', value: s.peers.length, sub: `${online} online now` }),
    kpi({ icon: 'waiting', label: 'Waiting for you', value: s.waitingRequests || 0, sub: s.waitingRequests ? 'Review in Firewall' : 'Nothing to approve', tone: s.waitingRequests ? 'warn' : '', onclick: openFirewall }),
    kpi({ icon: 'messages', label: 'Received today', value: inToday, sub: `${s.conversations.reduce((n, c) => n + (c.total || 0), 0)} in history` }),
    kpi({ icon: 'blocked', label: 'Blocked this week', value: blocked, sub: blocked ? 'By your firewall or you' : 'Nothing blocked', tone: blocked ? 'bad' : '', onclick: openFirewall }),
  );

  // Devices
  $('ovDevicesSub').textContent = `${online} of ${s.peers.length} online`;
  const box = $('ovDevices'); box.replaceChildren();
  for (const { peer, c } of sortedConvos()) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'devrow';
    const av = document.createElement('span'); av.className = 'avatar'; avatar(av, peer);
    const info = document.createElement('div'); info.className = 'devrow-text';
    info.append(text('b', peer.name), text('small', `${peer.fingerprint}${peer.address ? ` · ${peer.address}` : ''}`));
    const st = text('span', peer.online === true ? 'Online' : peer.online === false ? 'Offline' : 'Checking'); st.className = `pill ${peer.online === true ? 'ok' : peer.online === false ? '' : 'muted'}`;
    const last = text('small', c?.last ? `Last message ${shortWhen(c.last.sentAt)}` : `Paired ${new Date(peer.pairedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`); last.className = 'devrow-when';
    row.append(av, info, last, st);
    row.onclick = () => select(peer.id);
    box.append(row);
  }

  // This device
  const facts = [
    ['Name', d.name], ['Fingerprint', d.fingerprint], ['Key store', KEYSTORE[d.keystore] || d.keystore],
    ['Network', d.address || 'No local address'], ['Tailscale', d.tailscale || 'Not detected'],
    ['Version', `${d.version || '?'} · protocol v${d.protocol} · intents ${d.logos || '?'}`],
  ];
  $('ovMe').replaceChildren(...facts.flatMap(([k, v]) => { const dt = text('dt', k), dd = text('dd', v); if (k === 'Fingerprint') dd.className = 'mono'; return [dt, dd]; }));

  // Recent activity (requests and held/blocked messages)
  const act = $('ovActivity'); act.replaceChildren();
  if (!reqs.length) act.append(emptyEl('li', 'pulse', 'No requests yet', 'When agents send each other requests, each one and what your firewall did shows up here.'));
  for (const r of reqs.slice(0, 7)) {
    const li = document.createElement('li');
    const st = text('span', FW_LABEL[r.firewall.status]); st.className = `fwtag ${r.firewall.status}`;
    const what = document.createElement('div'); what.className = 'act-text';
    what.append(text('b', r.intent || 'Plain message'), text('small', `${r.peer.name} · ${shortWhen(r.receivedAt || r.sentAt)}`));
    li.append(what, st);
    li.onclick = openFirewall;
    act.append(li);
  }

  // Checklist
  const steps = [
    [s.peers.length > 0, 'Pair a second computer', 'Sound or a typed code; you swap 6-digit codes.', openPair],
    [s.conversations.some(c => c.total > 0), 'Connect an agent and send a first message', 'Run npx vinac-link setup for Claude Code, Codex or OpenClaw.', null],
    [!!fw && fw.intents.some(i => i.all || Object.keys(i.devices).length), 'Set your firewall rules', 'Allow what you trust, keep risky intents blocked.', openFirewall],
    [s.secrets.length > 0, 'Move a key without the chat', 'Secrets → Receive, then send from the other computer.', () => $('ovReceiveBtn').click()],
    [!!d.tailscale, 'Reach your devices from anywhere', 'Install Tailscale on both computers.', null],
  ];
  const ul = $('ovChecklist'); ul.replaceChildren();
  for (const [done, title, hint, go] of steps) {
    const li = document.createElement('li'); li.className = done ? 'done' : '';
    const mark = text('span', done ? '✓' : ''); mark.className = 'check';
    const t = document.createElement('div'); t.append(text('b', title), text('small', hint));
    li.append(mark, t);
    if (go && !done) { const b = button('Start', go); b.className = 'ghost small-btn'; li.append(b); }
    ul.append(li);
  }
}
$('firewallBackBtn').onclick = () => { wantFirewall = false; mobileMain = false; render(state); };

async function loadFirewall(force = false) {
  if (fwLoading) return;
  fwLoading = true;
  try {
    const r = await api('GET', '/ui/firewall');
    const key = JSON.stringify(r);
    if (key !== fwKey || force) { fw = r; fwKey = key; renderFirewall(); if (app.dataset.main === 'overview') renderOverview(); }
  } catch (e) { toast(e.message); } finally { fwLoading = false; }
}

function requestItem(r) {
  const li = document.createElement('li'); li.className = 'secret';
  const name = text('b', r.intent || 'Plain message');
  const risk = text('span', r.risk); risk.className = `fwtag r-${r.risk}`; risk.title = RISK_LABEL[r.risk] || '';
  const st = text('span', FW_LABEL[r.firewall.status]); st.className = `fwtag ${r.firewall.status}`;
  name.append(risk, st);
  const when = new Date(r.receivedAt || r.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const by = r.firewall.decidedAt ? `you, ${new Date(r.firewall.decidedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : r.firewall.rule;
  const meta = text('small', `From ${r.peer.name}${r.by === 'agent' ? ' (its agent)' : ''} · ${when} · decided by ${by}`);
  const row = document.createElement('div'); row.className = 'row';
  if (r.firewall.status === 'pending') {
    const yes = button('Approve', () => decide(r, true)); yes.className = 'primary small-btn';
    const no = button('Reject', () => decide(r, false)); no.className = 'ghost';
    row.append(yes, no);
  }
  li.append(name, row, meta);
  if (r.intent === 'document.file.share' && r.args?.file) {
    // A shared file: show what it is, and let the person look before approving.
    const f = text('small', `File: ${r.args.name} · ${kb(r.args.size)} · ${r.args.mime} · sha256 ${r.args.sha256.slice(0, 12)}…`);
    const dl = button('Download', () => downloadFile(r.args.file, r.args.name)); dl.className = 'ghost';
    row.append(dl); li.append(f);
  } else if (r.intent) {
    const shown = r.args ? JSON.stringify(r.args, null, 2) : '';
    if (shown) { const a = text('pre', shown); a.className = 'args'; li.append(a); }
  }
  const auto = r.intent === 'document.file.share' ? 'Shared file: ' : `Request: ${r.intent}`;
  if (!r.intent && r.text) { const a = text('pre', r.text.length > 1500 ? `${r.text.slice(0, 1500)}…` : r.text); a.className = 'args'; li.append(a); }
  else if (r.text && !r.text.startsWith(auto)) { const n = text('small', `Note: ${r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text}`); li.append(n); }
  return li;
}

async function decide(r, approve) {
  try {
    render(await api('POST', '/ui/firewall/decide', { id: r.id, approve }));
    toast(approve ? `Approved. Your agent can now see ${r.intent || 'the message'} from ${r.peer.name}.` : 'Rejected. Your agent will not see it.');
    loadFirewall(true);
  } catch (e) { toast(e.message); }
}

function renderFirewall() {
  if (!fw) return;
  $('logosVersion').textContent = fw.logos;
  const waiting = fw.requests.filter(r => r.firewall.status === 'pending');
  const recent = fw.requests.filter(r => r.firewall.status !== 'pending').slice(0, 30);
  const fill = (id, list, empty) => {
    const ul = $(id); ul.replaceChildren();
    if (!list.length) { ul.append(emptyEl('li', ...empty)); return; }
    for (const r of list) ul.append(requestItem(r));
  };
  fill('fwWaiting', waiting, ['shield', 'All clear', 'Nothing is waiting. Requests that your rules set to "Ask me" appear here.']);
  fill('fwRecent', recent, ['flow', 'No requests yet', 'Agents on paired devices send them with an intent, like agent.review.request.']);

  const scope = $('fwScope');
  if (fwScope !== '*' && !fw.peers.some(p => p.id === fwScope)) fwScope = '*';
  scope.replaceChildren(new Option('All devices', '*'), ...fw.peers.map(p => new Option(p.name, p.id)));
  scope.value = fwScope;

  renderRules();
  renderAutoReply();
}

// Auto-reply: per device Off / Questions & status, limits, and a log of runs.
// Only this page changes it; agent tools cannot.
async function setAuto(body, done) {
  try { await api('POST', '/ui/autoreply', body); if (done) toast(done); loadFirewall(true); }
  catch (e) { toast(e.message); loadFirewall(true); }
}
function renderAutoReply() {
  const box = $('autoReply'); const a = fw.autoReply;
  if (!box || !a) return;
  box.replaceChildren();
  // One settings row: a title and hint on the left, the control(s) on the right.
  const setting = (title, hint, ...controls) => {
    const row = document.createElement('div'); row.className = 'ar-row';
    const t = document.createElement('div'); t.className = 'ar-label'; t.append(text('b', title));
    if (hint) t.append(text('small', hint));
    const c = document.createElement('div'); c.className = 'ar-control'; c.append(...controls);
    row.append(t, c); return row;
  };
  const sw = (checked, label) => {
    const l = document.createElement('label'); l.className = 'switch';
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = checked; i.setAttribute('role', 'switch'); i.setAttribute('aria-label', label);
    l.append(i, document.createElement('span')); return [l, i];
  };
  const intro = document.createElement('div'); intro.className = 'ar-intro';
  intro.innerHTML = '<span class="ar-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v10H9l-5 4V5Z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/></svg></span>';
  intro.append(text('p', `Answers ${a.intents.join(', ')} from the devices you choose, with a local model or a short agent run that only sees those messages and can only reply. Everything else waits for you as usual.`));
  box.append(intro);

  const devs = document.createElement('div'); devs.className = 'ar-group';
  devs.append(text('h4', 'Devices'));
  if (!a.devices.length) devs.append(setting('No paired devices', 'Pair a device first.'));
  for (const d of a.devices) {
    const [l, i] = sw(d.mode === 'questions', `Auto-reply for ${d.name}`);
    i.onchange = () => setAuto({ device: { id: d.id, mode: i.checked ? 'questions' : 'off' } }, i.checked ? `Auto-reply on for ${d.name}.` : `Auto-reply off for ${d.name}.`);
    devs.append(setting(d.name, d.mode === 'questions' ? 'Questions and status updates get an automatic reply.' : 'Off: messages wait for you and your agent.', l));
  }
  box.append(devs);

  const opts = document.createElement('div'); opts.className = 'ar-group';
  opts.append(text('h4', 'Settings'));
  const per = document.createElement('input'); per.type = 'number'; per.min = '1'; per.max = '30'; per.value = a.maxPerHour; per.setAttribute('aria-label', 'Runs per device per hour');
  per.onchange = () => setAuto({ maxPerHour: Number(per.value) });
  opts.append(setting('Limit', 'Runs per device per hour', per));
  const [ql, quiet] = sw(!!a.quietHours, 'Quiet hours');
  const from = document.createElement('input'); from.type = 'time'; from.value = a.quietHours?.from || '22:00'; from.setAttribute('aria-label', 'Quiet from');
  const to = document.createElement('input'); to.type = 'time'; to.value = a.quietHours?.to || '07:00'; to.setAttribute('aria-label', 'Quiet until');
  const saveQuiet = () => setAuto({ quietHours: quiet.checked ? { from: from.value, to: to.value } : null });
  quiet.onchange = saveQuiet; from.onchange = () => quiet.checked && saveQuiet(); to.onchange = () => quiet.checked && saveQuiet();
  const span = document.createElement('span'); span.className = 'ar-times'; span.append(from, text('span', '–'), to);
  if (!a.quietHours) span.classList.add('off');
  opts.append(setting('Quiet hours', 'No automatic replies during these hours', span, ql));
  // Engine: an agent program (Claude Code) or a local model (Ollama, LM Studio), no internet needed
  const seg = document.createElement('div'); seg.className = 'segmented'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Auto-reply engine');
  for (const [v, label] of [['program', 'Agent program'], ['local', 'Local model']]) {
    const b = button(label, () => { if ((a.engine || 'program') !== v) setAuto({ engine: v }, v === 'local' ? 'Auto-reply uses a local model.' : 'Auto-reply uses the agent program.'); });
    b.setAttribute('aria-pressed', String((a.engine || 'program') === v)); seg.append(b);
  }
  opts.append(setting('Answers by', (a.engine || 'program') === 'local' ? 'Ollama or LM Studio on this computer; works offline' : 'A short Claude Code run that can only reply', seg));
  if ((a.engine || 'program') === 'local') {
    const url = document.createElement('input'); url.type = 'text'; url.value = a.localUrl || ''; url.spellcheck = false; url.setAttribute('aria-label', 'Local model address');
    url.placeholder = 'http://127.0.0.1:11434/v1';
    url.onchange = () => setAuto({ localUrl: url.value }, 'Address saved.');
    const model = document.createElement('input'); model.type = 'text'; model.value = a.localModel || ''; model.spellcheck = false; model.setAttribute('aria-label', 'Model name');
    model.placeholder = 'llama3.1:8b';
    model.onchange = () => setAuto({ localModel: model.value }, 'Model saved.');
    opts.append(setting('Address', 'Ollama: http://127.0.0.1:11434/v1 · LM Studio: http://127.0.0.1:1234/v1', url));
    opts.append(setting('Model', 'The model only writes the reply text; it gets no tools.', model));
  } else {
    const pin = document.createElement('input'); pin.type = 'text'; pin.value = a.program; pin.spellcheck = false; pin.setAttribute('aria-label', 'Agent program');
    pin.onchange = () => setAuto({ program: pin.value }, 'Agent program saved.');
    const found = text('span', a.programFound ? 'Found' : 'Not found'); found.className = `pill ${a.programFound ? 'ok' : 'warn'}`;
    opts.append(setting('Agent program', 'The command that runs your agent', pin, found));
  }
  box.append(opts);
  if (a.running) { const p = text('p', `Running now for ${a.running.peer}…`); p.className = 'auto-note'; box.append(p); }
  // Log
  const ul = document.createElement('ul'); ul.className = 'auto-log';
  const head = text('li', 'Activity'); head.className = 'ar-head'; ul.append(head);
  if (!a.log.length) { const li = text('li', 'No automatic replies yet.'); li.className = 'none'; ul.append(li); }
  for (const e of a.log) {
    const li = document.createElement('li');
    const st = text('span', e.status); st.className = `fwtag ${{ done: 'approved', running: 'pending', skipped: 'r-text', failed: 'rejected' }[e.status] || ''}`;
    const when = new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const what = `${e.peer?.name || '?'} · ${(e.intents || []).join(', ')}`;
    const extra = [e.replies != null ? `${e.replies} repl${e.replies === 1 ? 'y' : 'ies'}` : '', e.ms != null ? `${(e.ms / 1000).toFixed(1)} s` : '', e.reason || ''].filter(Boolean).join(' · ');
    li.append(st, text('span', ` ${when} · ${what}${extra ? ` · ${extra}` : ''}`));
    ul.append(li);
  }
  box.append(ul);
}

// Rules: one collapsible group per area (plain messages first), each intent with its
// risk and a short description; the search box filters by name or description.
const DOMAIN_LABEL = {
  text: 'Plain messages', agent: 'Agent to agent', person: 'The person on the other device', code: 'Code, pull requests and issues',
  ci: 'CI', deploy: 'Deploys', container: 'Containers', cloud: 'Cloud', database: 'Databases', config: 'Configuration',
  monitor: 'Monitoring', security: 'Security', web: 'Web', browser: 'Browser', system: 'This computer', clipboard: 'Clipboard',
  note: 'Notes', reminder: 'Reminders', docs: 'Documentation', model: 'AI models', data: 'Data', calendar: 'Calendar',
  communication: 'Messages for the person', crm: 'CRM', document: 'Files', storage: 'Storage',
};
const fwOpen = new Set(['text', 'agent']);
function renderRules() {
  const box = $('fwRules'); box.replaceChildren();
  const q = $('fwFilter').value.trim().toLowerCase();
  const order = Object.keys(DOMAIN_LABEL);
  const rank = d => (order.includes(d) ? order.indexOf(d) : order.length);
  const domains = [...new Set(fw.intents.map(i => i.domain))].sort((a, b) => rank(a) - rank(b));
  for (const domain of domains) {
    const items = fw.intents.filter(i => i.domain === domain && (!q || i.intent.includes(q) || (i.description || '').toLowerCase().includes(q)));
    if (!items.length) continue;
    const rulesSet = items.filter(i => (fwScope === '*' ? i.all : i.devices[fwScope])).length;
    const group = document.createElement('details'); group.className = 'fw-group';
    group.open = !!q || fwOpen.has(domain) || rulesSet > 0;
    group.ontoggle = () => { if (group.open) fwOpen.add(domain); else fwOpen.delete(domain); };
    const head = document.createElement('summary');
    head.append(text('b', DOMAIN_LABEL[domain] || domain), text('span', `${items.length}${rulesSet ? ` · ${rulesSet} set` : ''}`));
    group.append(head);
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'fw-row';
      const set = fwScope === '*' ? it.all : it.devices[fwScope] || null;
      // Without its own rule, a device follows the rule for all devices, then the default.
      const inherited = fwScope === '*' ? `Default: ${DECISION_LABEL[it.default]}` : `As all devices: ${DECISION_LABEL[it.all || it.default]}`;
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Rule for ${it.intent}`);
      sel.append(new Option(inherited, 'default'), ...['allow', 'ask', 'block'].map(d => new Option(DECISION_LABEL[d], d)));
      sel.value = set || 'default';
      sel.className = set ? 'set' : '';
      sel.onchange = async () => {
        try { await api('POST', '/ui/firewall/rule', { scope: fwScope, intent: it.intent, decision: sel.value }); loadFirewall(true); }
        catch (e) { toast(e.message); sel.value = set || 'default'; }
      };
      const name = document.createElement('div'); name.className = 'fw-name';
      const code = text('code', INTENT_LABEL[it.intent] || it.intent);
      if (it.risk !== 'text') { const r = text('span', it.risk); r.className = `fwtag r-${it.risk}`; r.title = RISK_LABEL[it.risk]; code.append(r); }
      name.append(code, text('small', it.description || ''));
      row.append(name, sel);
      group.append(row);
    }
    box.append(group);
  }
  if (!box.childElementCount) { const p = text('p', 'No intent matches.'); p.className = 'none'; box.append(p); }
}
$('fwScope').onchange = e => { fwScope = e.target.value; renderFirewall(); };
$('fwFilter').oninput = () => { if (fw) renderRules(); };

function renderInfo() {
  const peer = peerById(selected); if (!peer) { $('info').hidden = true; return; }
  const c = convoOf(peer.id);
  avatar($('infoAvatar'), peer);
  $('infoName').textContent = peer.name;
  $('infoStatus').textContent = peer.online === true ? 'Online now' : peer.online === false ? 'Offline' : 'Checking…';
  $('infoFp').textContent = peer.fingerprint;
  $('infoAddr').textContent = peer.address || 'Unknown';
  $('infoPaired').textContent = `${new Date(peer.pairedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · by ${peer.via}`;
  $('infoCount').textContent = `${c?.total || 0}`;
  $('infoAgent').textContent = c?.agentUnread ? `${c.agentUnread} message${c.agentUnread > 1 ? 's' : ''} not yet read` : 'Has read everything';
}

// ---- reading state and notifications -------------------------------------------

function markSeen() {
  if (app.dataset.main !== 'thread' || document.visibilityState !== 'visible' || !selected || (isNarrow() && !mobileMain)) return;
  const latest = convoOf(selected)?.incoming.at(-1)?.at;
  if (latest && latest > (lastSeen[selected] || '')) {
    lastSeen[selected] = latest; LS.set('lastSeen', lastSeen);
    renderConvos();
  }
}

function noticeNew() {
  for (const c of state.conversations) {
    for (const x of c.incoming) {
      if (known.has(x.id)) continue;
      known.add(x.id);
      if (firstLoad || x.at <= (lastSeen[c.peerId] || '')) continue;
      const peer = peerById(c.peerId);
      const watching = document.visibilityState === 'visible' && selected === c.peerId && app.dataset.main === 'thread';
      if (watching) continue;
      const body = c.last?.id === x.id ? c.last.text.slice(0, 140) : 'New message';
      if (notifyOn && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { const n = new Notification(peer?.name || 'VINAC Link', { body, tag: x.id }); n.onclick = () => { window.focus(); select(c.peerId); }; } catch { /* not allowed here */ }
      } else if (document.visibilityState === 'visible') toast(`New message from ${peer?.name || 'a device'}`);
    }
  }
}

function syncNotifyButton() {
  const b = $('notifyBtn');
  const on = notifyOn && 'Notification' in window && Notification.permission === 'granted';
  b.classList.toggle('on', on);
  b.title = on ? 'Notifications on. Click to turn off.' : 'Notify me about new messages';
}

$('notifyBtn').onclick = async () => {
  if (!('Notification' in window)) return toast('This browser cannot show notifications.');
  if (notifyOn) { notifyOn = false; LS.set('notify', false); syncNotifyButton(); return toast('Notifications off.'); }
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm !== 'granted') return toast('Notifications are blocked for this page in the browser settings.');
  notifyOn = true; LS.set('notify', true); syncNotifyButton(); toast('You will be notified about new messages while this page is in the background.');
};

// ---- conversation actions --------------------------------------------------

function select(id) {
  if (id !== selected) { thread = []; threadKey = ''; replyTo = null; search = ''; $('threadSearch').value = ''; $('searchBar').hidden = true; $('replyBox').hidden = true; }
  selected = id; LS.set('selected', id);
  wantPair = false; wantSecrets = false; wantFirewall = false; wantOverview = false; hideSecret(); mobileMain = true; justOpened = true;
  threadKey = ''; // reload and scroll to the newest message, even if it was rendered while hidden
  render(state);
  if (!isNarrow()) $('composeText').focus();
}

function startReply(m) {
  replyTo = m.id;
  $('replyWho').textContent = m.direction === 'sent' ? 'yourself' : m.peer.name;
  $('replyText').textContent = flat(m.text);
  $('replyBox').hidden = false;
  $('composeText').focus();
}
function cancelReply() { replyTo = null; $('replyBox').hidden = true; }

async function sendMessage(body, reply) {
  const peer = peerById(selected); if (!peer) return;
  const tmp = { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, direction: 'sent', by: 'person', peer: { id: peer.id, name: peer.name }, text: body, replyTo: reply, sentAt: new Date().toISOString(), status: 'sending' };
  pending.push(tmp);
  justOpened = true; renderThread();
  try {
    const s = await api('POST', '/ui/send', { to: peer.id, text: body, replyTo: reply || undefined });
    pending = pending.filter(x => x !== tmp);
    justOpened = true;
    render(s);
  } catch (e) {
    tmp.status = 'failed'; tmp.error = e.message;
    renderThread(); toast(e.message);
  }
}

const compose = $('composeText');
function sizeCompose() {
  compose.style.height = 'auto'; compose.style.height = `${Math.min(180, compose.scrollHeight + 2)}px`;
  const n = compose.value.length, counter = $('counter');
  counter.textContent = n > 7000 ? `${n} / 8000` : '';
  counter.classList.toggle('over', n > 8000);
}
compose.addEventListener('input', sizeCompose);
compose.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('composer').onsubmit = e => {
  e.preventDefault();
  const body = compose.value.trim();
  if (!body || compose.disabled) return;
  compose.value = ''; sizeCompose();
  const reply = replyTo; cancelReply();
  sendMessage(body, reply);
};
$('replyCancel').onclick = cancelReply;

// Send a file to the open conversation (up to 64 MB; bigger than 192 KB goes in parts).
$('attachBtn').onclick = () => $('attachInput').click();
$('attachInput').onchange = async () => {
  const f = $('attachInput').files[0]; $('attachInput').value = '';
  const peer = peerById(selected);
  if (!f || !peer) return;
  if (f.size > 64 * 1024 * 1024) { toast('Files are limited to 64 MB.'); return; }
  const btn = $('attachBtn'); btn.disabled = true;
  toast(`Sending ${f.name}…`);
  try {
    const qs = new URLSearchParams({ to: peer.id, name: f.name, ...(f.type ? { mime: f.type } : {}) });
    const r = await fetch(`/ui/send-file?${qs}`, { method: 'POST', headers: { 'x-ui-token': TOKEN, 'content-type': 'application/octet-stream' }, body: f });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    justOpened = true; render(data); toast(`${f.name} sent to ${peer.name}.`);
  } catch (e) { toast(e.message); }
  finally { btn.disabled = !peerById(selected)?.canMessage; }
};

$('convoSearch').oninput = () => renderConvos();
$('searchBtn').onclick = () => {
  const bar = $('searchBar'); bar.hidden = !bar.hidden;
  if (bar.hidden) { search = ''; $('threadSearch').value = ''; renderThread(); } else $('threadSearch').focus();
};
$('threadSearch').oninput = e => { search = e.target.value; renderThread(); };
$('infoBtn').onclick = () => { $('info').hidden = !$('info').hidden; if (!$('info').hidden) renderInfo(); };
$('infoClose').onclick = () => { $('info').hidden = true; };
$('backBtn').onclick = () => { mobileMain = false; render(state); };
$('removeBtn').onclick = () => {
  const peer = peerById(selected);
  if (!peer || !confirmRemove(peer.name)) return;
  $('info').hidden = true; selected = null; LS.set('selected', null);
  api('POST', '/ui/unpair', { id: peer.id }).then(s => {
    render(s);
    toast(s.unpaired?.otherDeviceTold ? `Removed. ${peer.name} removed this pairing too.` : `Removed here. ${peer.name} was not reachable, so remove it there as well.`);
  }, e => toast(e.message));
};

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('secretModal').hidden) closeSecretModal();
  else if (!$('replyBox').hidden) cancelReply();
  else if (!$('searchBar').hidden) $('searchBtn').click();
  else if (!$('info').hidden) $('info').hidden = true;
});
document.addEventListener('visibilitychange', () => { if (state) markSeen(); });

function confirmRemove(name) {
  // A second click within 4 s confirms; avoids a blocking dialog.
  if (confirmRemove.pending === name) { confirmRemove.pending = null; return true; }
  confirmRemove.pending = name; toast(`Click Remove again to stop trusting ${name}.`);
  setTimeout(() => { if (confirmRemove.pending === name) confirmRemove.pending = null; }, 4000);
  return false;
}

// ---- pairing ----------------------------------------------------------------

function renderPairing(p) {
  const view = (p && VIEW_OF[p.state]) || 'idle';
  $('tailscaleRow').hidden = !state?.device?.tailscale;
  card.dataset.viewNow = view;
  $('cancelRow').hidden = view === 'idle';
  $('timeLeft').textContent = p && p.secondsLeft ? `Times out in ${Math.floor(p.secondsLeft / 60)}:${String(p.secondsLeft % 60).padStart(2, '0')}` : '';
  $('speakerCard').hidden = !(view === 'idle' || view === 'announcing');

  if (view === 'announcing') $('beaconCode').textContent = p.beaconCode || '';
  if (view === 'connecting') $('connectText').textContent = p.message;
  if (view === 'comparing') {
    $('digits').textContent = p.showCode ? `${p.showCode.slice(0, 3)} ${p.showCode.slice(3)}` : '--- ---';
    $('peerName').textContent = p.peer?.name || 'the other device';
    $('peerFp').textContent = p.peer?.fingerprint || '';
    $('compareActions').hidden = p.confirmedHere;
    $('waitingThere').hidden = !p.confirmedHere;
    $('attemptsLeft').textContent = p.attemptsLeft < 3 ? `${p.attemptsLeft} ${p.attemptsLeft === 1 ? 'try' : 'tries'} left.` : 'A wrong code 3 times cancels the pairing.';
  } else $('otherCode').value = '';

  const result = $('result');
  const done = p && ['paired', 'failed', 'cancelled', 'expired'].includes(p.state);
  result.hidden = !done;
  $('openNewBtn').hidden = !(done && p.state === 'paired');
  if (done) {
    result.className = `result ${p.state === 'paired' ? 'ok' : 'bad'}`;
    result.textContent = p.state === 'paired' ? `Paired with ${p.peer?.name}. Both devices now trust each other.` : p.message;
    if (p.state === 'paired' && lastPaired !== p.peer?.fingerprint) { if (lastPaired !== null || !firstLoad) toast(`Paired with ${p.peer?.name}`); lastPaired = p.peer?.fingerprint; }
  }
}

$('openNewBtn').onclick = () => {
  const fp = state?.pairing?.peer?.fingerprint;
  const peer = state?.peers.find(x => x.fingerprint === fp);
  if (peer) select(peer.id);
};
function openPair() { wantPair = true; wantSecrets = false; wantFirewall = false; mobileMain = true; render(state); }
$('newPairBtn').onclick = openPair;
$('sidePairBtn').onclick = openPair;
$('ovPairBtn').onclick = openPair;
$('emptyPairBtn').onclick = openPair;
$('pairBackBtn').onclick = () => {
  const p = state?.pairing;
  if (p && VIEW_OF[p.state]) api('POST', '/ui/cancel').catch(() => {});
  wantPair = false; mobileMain = false;
  setTimeout(refresh.once, 50);
};

// ---- sound ----------------------------------------------------------------

const engine = new AudioEngine({ onPcm: pcm => pushPcm(pcm) });
let playing = false, listening = false, micBlocked = false, chunks = [], samples = 0, decodeTimer = null, meterTimer = null;
let listenMode = null; // 'pair' (beacon) or 'secret'

function syncAudio(p) {
  if (p?.state === 'announcing' && !playing) playLoop(p.beaconHex);
  if (listenMode === 'secret') return; // the secret dialog owns the microphone
  if (p?.state === 'listening' && !listening && !micBlocked) startListening('pair');
  if (p?.state !== 'listening') { micBlocked = false; if (listening) stopListening(); }
}

async function playLoop(hex) {
  playing = true;
  let rounds = 0;
  try {
    while (state?.pairing?.state === 'announcing' && state.pairing.beaconHex === hex) {
      rounds++;
      $('announceText').textContent = rounds === 1 ? 'Playing the pairing sound…' : `Playing the pairing sound (round ${rounds})…`;
      await engine.playFrame(fromHex(hex), { rawBps: BEACON_BPS, tones: BEACON_TONES, fec: BEACON_FEC, amplitude: 0.28 });
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (e) { toast(`Could not play sound: ${e.message}`); }
  finally { playing = false; }
}

function pushPcm(pcm) {
  if (!listening) return;
  chunks.push(pcm); samples += pcm.length;
  // A beacon is ~6 s; the longest secret is ~35 s of sound, so keep 45 s for secrets.
  const max = (engine.sampleRate || 48000) * (listenMode === 'secret' ? 45 : 20);
  while (samples > max && chunks.length > 1) samples -= chunks.shift().length;
}

async function startListening(mode) {
  listening = true; listenMode = mode; chunks = []; samples = 0;
  try {
    await engine.startReceiver();
    fillSpeakers();
  } catch (e) {
    listening = false; listenMode = null;
    if (mode === 'secret') { secretFinish('bad', 'The microphone is blocked. Allow it for this page and try again, or ask the sender to use Wi-Fi.'); return; }
    micBlocked = true;
    toast('Microphone blocked. Allow it for this page, or use the code instead.');
    $('listenText').textContent = 'Microphone not available. Use the code below.';
    return;
  }
  if (mode === 'pair') $('listenText').textContent = 'Waiting for the pairing sound…';
  decodeTimer = setInterval(tryDecode, mode === 'secret' ? 1000 : 600);
  meterTimer = setInterval(drawMeter, 120);
}

function stopListening() {
  listening = false; listenMode = null;
  clearInterval(decodeTimer); clearInterval(meterTimer);
  engine.stopReceiver(); chunks = []; samples = 0;
}

let decoding = false, lastDecode = null;
// For troubleshooting from the browser console: what the listener is doing right now.
window.vinacListener = () => ({ listening, listenMode, bufferedSeconds: +(samples / (engine.sampleRate || 48000)).toFixed(1), sampleRate: engine.sampleRate, decoding, lastDecode });
async function tryDecode() {
  if (decoding || !samples) return;
  decoding = true;
  try {
    const pcm = new Float32Array(samples); let o = 0;
    for (const c of chunks) { pcm.set(c, o); o += c.length; }
    const sr = engine.sampleRate;
    const secret = listenMode === 'secret';
    const r = decodeFskFrameV2(pcm, secret
      ? { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: SECRET_MIN_BYTES, maxLength: SECRET_MAX_BYTES, accept: secretFrameLooksValid }
      : { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: BEACON_BYTES, maxLength: BEACON_BYTES, accept: b => decodeBeacon(b).ok });
    lastDecode = { at: Date.now(), seconds: +(pcm.length / sr).toFixed(1), result: r ? (r.ok ? (r.fecFailed ? 'damaged' : 'ok') : r.reason) : 'no training' };
    if (!r?.ok) return;
    const keep = pcm.slice(Math.min(pcm.length, r.endSample));
    chunks = keep.length ? [keep] : []; samples = keep.length;
    if (secret) return await heardSecret(r);
    if (r.fecFailed) { $('listenText').textContent = 'Heard something, but too damaged. Waiting for the next round…'; return; }
    $('listenText').textContent = 'Heard it. Connecting…';
    stopListening();
    await act('POST', '/ui/heard', { hex: toHex(r.frameBytes) });
  } finally { decoding = false; }
}

async function heardSecret(r) {
  if (r.fecFailed) { $('secretStatus').textContent = 'Heard a secret, but it was too damaged. Waiting for the next round…'; return; }
  $('secretStatus').textContent = 'Heard it. Unlocking…';
  try {
    const got = await api('POST', '/ui/secret/heard', { hex: toHex(r.frameBytes) });
    stopListening();
    api('POST', '/ui/secret/receive', { on: false }).catch(() => {}); // close the receive window again
    const where = KEYSTORE_SHORT[got.keystore] ? ` and stored it in ${KEYSTORE_SHORT[got.keystore] === 'Keychain' ? 'the Keychain' : KEYSTORE_SHORT[got.keystore]}` : '';
    secretFinish('ok', got.duplicate ? `${got.name} from ${got.from.name} was already received.`
      : got.pending ? `Received a new ${got.name} from ${got.from.name}. Open Secrets and approve it to replace the current one.`
      : `Received ${got.name} from ${got.from.name}${where}. VINAC Link's agent tools show its name, never its value.`, true);
    refresh.once();
  } catch (e) {
    $('secretStatus').textContent = `${e.message} Still listening…`;
  }
}

function drawMeter() {
  const sp = engine.readSpectrum(); if (!sp) return;
  const bars = $(listenMode === 'secret' ? 'secretMeter' : 'meter').children;
  BEACON_TONES.forEach((f, i) => {
    const db = sp.data[Math.round(f / sp.sampleRate * sp.fftSize)] ?? -120;
    bars[i].style.height = `${Math.max(6, Math.min(100, (db + 110) * 1.6))}%`;
  });
}

async function fillSpeakers() {
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && !['default', 'communications', ''].includes(d.deviceId));
    for (const sel of [$('speaker'), $('secretSpeaker')]) {
      const keep = sel.value;
      sel.length = 1;
      for (const d of outs) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Speaker'; sel.append(o); }
      sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
    }
    if (typeof AudioContext.prototype.setSinkId !== 'function') {
      $('speakerCard').querySelector('label').textContent = 'Speaker: this browser always uses the system speaker';
      $('secretSpeaker').disabled = true;
    }
  } catch { /* keep default */ }
}

async function useSpeaker(id) {
  try { const ctx = await engine.ensureContext(); if (typeof ctx.setSinkId === 'function') await ctx.setSinkId(id); }
  catch (e) { toast(`Speaker not changed: ${e.message}`); }
}
$('speaker').onchange = () => { $('secretSpeaker').value = $('speaker').value; useSpeaker($('speaker').value); };
$('secretSpeaker').onchange = () => { $('speaker').value = $('secretSpeaker').value; useSpeaker($('secretSpeaker').value); };

// ---- secret dialog: send by sound or Wi-Fi, or receive by sound ------------------

let secretRun = null; // { stop } while sending or listening
const ROUNDS = 5;

function secretAirtimeGuess(nameLen, valueLen) {
  const bytes = 21 + 16 + 1 + nameLen + 8 + 4 + valueLen + 2;
  return Math.round((32 + codedLength(bytes, SECRET_FEC) * 4) / (BEACON_BPS / 2));
}
function updateSoundTime() {
  const n = new TextEncoder().encode($('secretName').value.trim()).length || 14;
  const v = new TextEncoder().encode($('secretValue').value).length || 60;
  $('soundTime').textContent = `about ${secretAirtimeGuess(n, v)} s, works without a network`;
}

// The secret dialog: 'send' (type a key and send it), 'stored' (send a key from the vault),
// 'add' (keep a key on this device) or 'receive'.
let secretMode = 'send', storedItem = null;
function secretPeers() { return (state?.peers || []).filter(p => p.canMessage); }
function syncSecretPeer() {
  const p = peerById($('secretPeer').value);
  $('secretTo').textContent = p ? p.name : 'the other device';
  if (secretMode !== 'add') $('secretTitle').textContent = secretMode === 'stored' ? `Send ${storedItem.name}${p ? ` to ${p.name}` : ''}` : `Send a secret${p ? ` to ${p.name}` : ''}`;
}
function openSecretModal(mode, { item = null, fromConversation = false } = {}) {
  const sending = mode === 'send' || mode === 'stored';
  const peers = secretPeers();
  if (sending && !peers.length) return toast('Pair a device first: secrets go only to paired devices.');
  if (sending && fromConversation && !peerById(selected)?.canMessage) return toast('Pair this device again before sending it secrets.');
  secretMode = mode; storedItem = item;
  secretRun = null;
  $('secretModal').hidden = false;
  $('secretForm').hidden = mode === 'receive';
  $('secretProgress').hidden = mode !== 'receive';
  $('secretResult').hidden = true; $('secretDone').hidden = true; $('secretStop').hidden = false;
  $('secretPulse').hidden = false;
  if (mode !== 'receive') {
    $('peerRow').hidden = !sending; $('howBox').hidden = !sending; $('speakerRow').hidden = !sending;
    $('valueRow').hidden = mode === 'stored'; $('storedNote').hidden = mode !== 'stored';
    $('secretName').readOnly = mode === 'stored';
    $('secretName').value = item ? item.name : ''; $('secretValue').value = ''; $('secretValue').type = 'password'; $('secretShow').textContent = 'Show';
    if (sending) {
      $('secretPeer').replaceChildren(...peers.map(p => new Option(p.name, p.id)));
      const pre = fromConversation ? selected : (peers.find(p => p.id === selected) || peers[0]).id;
      $('secretPeer').value = pre;
      $('secretHint').replaceChildren(text('span', 'Sealed so only '), text('b', ''), text('span', ' can open it, then stored in its key store. Its agent tools show the name, never the value. Use test values until VINAC Link has had a security review.'));
      $('secretHint').children[1].id = 'secretTo';
      syncSecretPeer(); updateSoundTime(); syncHow();
    } else {
      $('secretTitle').textContent = 'Add a secret to this device';
      $('secretHint').textContent = 'Kept in this device\'s key store. Agents can ask to use it by name (you approve each run), but never see the value. You can send it to a paired device later.';
      $('secretSend').textContent = 'Save';
    }
    (mode === 'stored' ? $('secretPeer') : $('secretName')).focus();
  } else {
    $('secretTitle').textContent = 'Receive a secret';
    $('secretMeter').hidden = false;
    $('secretStatus').textContent = 'Listening for 3 minutes (sound or Wi-Fi)… Start sending on the other device.';
    secretRun = { stop: false };
    api('POST', '/ui/secret/receive', { on: true }).then(() => refresh.once()).catch(e => toast(e.message));
    startListening('secret');
  }
}

function secretFinish(kind, message, done = true) {
  $('secretForm').hidden = true; $('secretProgress').hidden = false;
  $('secretPulse').hidden = true; $('secretMeter').hidden = true;
  $('secretStatus').textContent = '';
  const r = $('secretResult'); r.hidden = false; r.className = `result ${kind}`; r.textContent = message;
  $('secretStop').hidden = done; $('secretDone').hidden = !done;
  secretRun = null;
}

function closeSecretModal() {
  if (secretRun) secretRun.stop = true;
  if (listenMode === 'secret') stopListening();
  if (state?.receiving) api('POST', '/ui/secret/receive', { on: false }).catch(() => {});
  $('secretValue').value = '';
  $('secretModal').hidden = true;
}

function syncHow() {
  if (secretMode === 'add') return;
  const sound = $('secretForm').how.value === 'sound';
  $('speakerRow').hidden = !sound;
  $('secretSend').textContent = sound ? 'Play it' : 'Send over Wi-Fi';
}

$('secretBtn').onclick = () => openSecretModal('send', { fromConversation: true });
$('receiveBtn').onclick = () => openSecretModal('receive');
$('addSecretBtn').onclick = () => openSecretModal('add');
$('sendSecretBtn').onclick = () => openSecretModal('send');
$('secretPeer').addEventListener('change', syncSecretPeer);
$('secretSearch').addEventListener('input', () => renderSecrets(true));
$('secretClose').onclick = closeSecretModal;
$('secretDone').onclick = closeSecretModal;
$('secretStop').onclick = () => {
  if (listenMode === 'secret') { stopListening(); api('POST', '/ui/secret/receive', { on: false }).catch(() => {}); secretFinish('bad', 'Stopped listening.'); return; }
  if (secretRun) { secretRun.stop = true; $('secretStatus').textContent = 'Stopping after this round…'; }
};
$('secretShow').onclick = () => {
  const v = $('secretValue'); const show = v.type === 'password';
  v.type = show ? 'text' : 'password'; $('secretShow').textContent = show ? 'Hide' : 'Show';
};
$('secretName').addEventListener('input', updateSoundTime);
$('secretValue').addEventListener('input', updateSoundTime);
for (const r of $('secretForm').how) r.addEventListener('change', syncHow);

$('secretForm').onsubmit = async e => {
  e.preventDefault();
  const stored = secretMode === 'stored';
  const name = $('secretName').value.trim(), value = $('secretValue').value, how = $('secretForm').how.value;
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) return toast('Name: letters, digits, _ . - only (for example OPENAI_API_KEY).');
  if (!stored && !value) return toast('Paste the secret first.');
  if (secretMode === 'add') {
    $('secretValue').value = '';
    try {
      const r = await api('POST', '/ui/secrets/add', { name, value });
      secretFinish('ok', `${name} is ${r.added?.replaced ? 'updated' : 'saved'} in this device's key store.`);
      render(r);
    } catch (err) { secretFinish('bad', err.message); }
    return;
  }
  const peer = peerById($('secretPeer').value);
  if (!peer) return;
  if (how === 'sound') engine.ensureContext().catch(() => {}); // while the click still counts as a user gesture
  $('secretValue').value = ''; // the page doesn't keep it
  $('secretForm').hidden = true; $('secretProgress').hidden = false; $('secretMeter').hidden = true;
  $('secretResult').hidden = true; $('secretDone').hidden = true; $('secretStop').hidden = how !== 'sound'; $('secretPulse').hidden = false;
  $('secretStatus').textContent = 'Sealing…';

  if (how === 'wifi') {
    try {
      if (stored) await api('POST', '/ui/secrets/send', { id: storedItem.id, to: peer.id });
      else await api('POST', '/ui/secret/wifi', { to: peer.id, name, value });
      secretFinish('ok', `Sent ${name} to ${peer.name} over Wi-Fi. It is in its key store now.`); refresh.once();
    } catch (err) { secretFinish('bad', err.message); }
    return;
  }

  let sealed;
  try { sealed = stored ? await api('POST', '/ui/secrets/seal', { id: storedItem.id, to: peer.id }) : await api('POST', '/ui/secret/seal', { to: peer.id, name, value }); }
  catch (err) { return secretFinish('bad', err.message); }
  const run = secretRun = { stop: false };
  const acked = async () => { try { return (await api('GET', `/ui/secret/status?id=${sealed.id}`)).acked; } catch { return false; } };
  try {
    await useSpeaker($('secretSpeaker').value);
    playing = true;
    for (let round = 1; round <= ROUNDS && !run.stop; round++) {
      $('secretStatus').textContent = `Playing ${name} for ${peer.name}: round ${round} of ${ROUNDS} (about ${Math.round(sealed.seconds)} s)…`;
      await engine.playFrame(fromHex(sealed.hex), { rawBps: BEACON_BPS, tones: BEACON_TONES, fec: SECRET_FEC, amplitude: 0.28 });
      for (let i = 0; i < 6 && !run.stop; i++) { if (await acked()) break; await new Promise(r => setTimeout(r, 400)); }
      if (await acked()) return secretFinish('ok', `${peer.name} received ${name} and stored it in its key store.`), refresh.once();
    }
    if (run.stop) return secretFinish('bad', 'Stopped.');
    secretFinish('bad', `Played ${ROUNDS} times with no confirmation. If ${peer.name} shows "Received", it worked (the confirmation travels over the network). Otherwise move the devices closer, check the speaker, or send by Wi-Fi.`);
  } catch (err) { secretFinish('bad', `Could not play the sound: ${err.message}`); }
  finally { playing = false; }
};

$('announceBtn').onclick = async () => { await engine.ensureContext().catch(() => {}); act('POST', '/ui/announce'); };
$('listenBtn').onclick = () => act('POST', '/ui/listen');
$('announceTsBtn').onclick = async () => { await engine.ensureContext().catch(() => {}); act('POST', '/ui/announce', { over: 'tailscale' }); };
$('compareActions').onsubmit = async e => {
  e.preventDefault();
  const code = $('otherCode').value.replace(/\D/g, '');
  if (code.length !== 6) return toast('Type the 6 digits shown on the other device.');
  try { render(await api('POST', '/ui/confirm', { code })); $('otherCode').value = ''; } catch (err) { toast(err.message); refresh.once(); }
};
$('rejectBtn').onclick = () => act('POST', '/ui/cancel');
$('cancelBtn').onclick = () => act('POST', '/ui/cancel');
$('codeForm').onsubmit = e => { e.preventDefault(); const code = $('codeInput').value.trim(); if (code) { stopListening(); act('POST', '/ui/heard', { code }); } };

// ---- start ------------------------------------------------------------------

const hint = location.hash.slice(1);
if (hint === 'announce' || hint === 'listen') { wantPair = true; mobileMain = true; $(`${hint}Btn`).classList.add('suggest'); }
if (hint === 'secrets') { wantSecrets = true; wantOverview = false; mobileMain = true; }

async function refresh() {
  await refresh.once();
  setTimeout(refresh, state?.pairing && VIEW_OF[state.pairing.state] ? 700 : 2000);
}
refresh.once = async () => {
  const who = document.querySelector('.whoami');
  try { render(await api('GET', '/ui/state')); who?.classList.remove('down'); }
  catch (e) {
    who?.classList.add('down');
    $('deviceLine').textContent = e.message.includes('Reload') ? 'Session changed: reload this page.' : 'VINAC Link is not running.';
    $('keyPill').textContent = e.message.includes('Reload') ? '' : 'Start it from the VINAC Link shortcut, then reload.';
  }
};
syncNotifyButton();
fillSpeakers();
refresh();
