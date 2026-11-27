// VINAC Link page. Talks only to this device's daemon (same origin).
// Conversations with paired devices, plus the pairing flow (sound or typed code).
import { AudioEngine } from '/lab/js/audio.js';
import { decodeFskFrameV2 } from '/lab/js/modem.js';
import { BEACON_BYTES, BEACON_TONES, BEACON_BPS, BEACON_FEC, decodeBeacon, fromHex, toHex } from '/web/beacon.js';
import { SECRET_FEC, SECRET_MIN_BYTES, SECRET_MAX_BYTES, secretFrameLooksValid } from '/web/secret-frame.js';
import { codedLength } from '/lab/js/fec.js';
import { qrSvg } from '/web/qr.js';
import { parseHello, parseSecretFrame, PHONE_SECRET_MIN, HELLO_MIN, HELLO_MAX } from '/web/phone-frame.js';
import { startI18n, setLang, chosenLang, locale, t } from '/web/i18n.js';

await startI18n(); // French (or English) before the first render

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

// Language: Auto (the browser's), English or Français; remembered in this browser only.
$('langPick').value = chosenLang();
$('langPick').onchange = () => setLang($('langPick').value);

// Help & about: links to the docs, support, terms, privacy and the license (they open in the browser).
const helpModal = $('helpModal');
const closeHelp = () => { helpModal.hidden = true; $('helpBtn').focus(); };
$('helpBtn').onclick = () => { helpModal.hidden = false; $('helpClose').focus(); };
$('helpClose').onclick = closeHelp;
helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !helpModal.hidden) closeHelp(); });

// Optional account (beta): only this page can sign in, link this computer or sign out.
const accountModal = $('accountModal');
let lastAccount = null;
function renderAccount(a) {
  lastAccount = a;
  $('accountEmailForm').hidden = a.signedIn || !!a.pendingEmail;
  $('accountCodeForm').hidden = a.signedIn || !a.pendingEmail;
  $('accountSignedIn').hidden = !a.signedIn;
  $('accountPendingEmail').textContent = a.pendingEmail || '';
  $('accountEmailShown').textContent = a.email || '';
  $('accountLinkState').textContent = a.linked ? `Linked to this account since ${new Date(a.device.linkedAt).toLocaleDateString(locale(), { dateStyle: 'medium' })}` : 'Not linked';
  $('accountLink').hidden = a.linked; $('accountUnlink').hidden = !a.linked;
  $('accountRelayRow').hidden = $('accountRelayHint').hidden = !a.linked;
  $('accountRelay').checked = !!a.relay;
  const rs = a.relayStatus || { state: 'off' };
  $('accountRelayState').textContent = !a.relay ? 'Off' : rs.state === 'connected' ? 'On · connected' : rs.state === 'error' ? `On · ${rs.error || 'not connected'}` : 'On · connecting…';
}
$('accountRelay').onchange = async () => {
  const on = $('accountRelay').checked;
  if (await accountDo('POST', '/ui/account/relay', { on })) {
    toast(on ? 'Relay on.' : 'Relay off.');
    if (on) setTimeout(() => { if (!accountModal.hidden) accountDo('GET', '/ui/account'); }, 2000);
  } else $('accountRelay').checked = !on;
};
async function loadAccountDevices() {
  const ul = $('accountDevices'); ul.replaceChildren();
  try {
    const { devices } = await api('GET', '/ui/account/devices');
    if (!devices.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = 'No computers linked yet.'; ul.append(li); return; }
    for (const d of devices) {
      const li = document.createElement('li'); li.className = 'secret';
      const name = document.createElement('b'); name.textContent = d.name; name.setAttribute('translate', 'no');
      const meta = document.createElement('small');
      meta.textContent = [d.fingerprint, { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[d.platform] || '', d.app_version ? `v${d.app_version}` : ''].filter(Boolean).join(' · ');
      li.append(name, meta); ul.append(li);
    }
  } catch (e) { const li = document.createElement('li'); li.className = 'none'; li.textContent = e.message; ul.append(li); }
}
async function loadAccountTeams(a) {
  const box = $('accountTeams');
  if (!a.linked) { box.hidden = true; return; }
  try {
    const { teams } = await api('GET', '/ui/account/teams');
    box.hidden = false;
    $('shareTeam').replaceChildren(...teams.map(t => new Option(t.name, t.id)));
    $('shareTeam').disabled = $('shareBtn').disabled = !teams.length;
    if (!teams.length) $('shareTeam').replaceChildren(new Option('No teams yet', ''));
    const months = [0, 1].map(k => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
    $('sharePeriod').replaceChildren(...months.map((m, i) => new Option(`${new Date(`${m}-15`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}${i ? '' : ' (so far)'}`, m)));
  } catch { box.hidden = true; }
}
// 0.16 VINAC Web: browsers added as devices of this computer (through the account relay).
let webQrKey = '';
function renderWeb(a) {
  $('accountWeb').hidden = !(a?.signedIn && a?.linked);
  const list = state?.webDevices || [], wp = state?.webPairing;
  const when = iso => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '');
  $('webList').replaceChildren(...list.map(d => {
    const li = document.createElement('li'); li.className = 'secret';
    const row = document.createElement('div'); row.className = 'row';
    const rm = button('Remove', () => { if (confirm(`Remove ${d.name}? It can't reach this computer any more.`)) act('POST', '/ui/web/remove', { id: d.id }); }); rm.className = 'ghost';
    row.append(rm);
    li.append(text('b', d.name), row, text('small', `Added ${when(d.pairedAt)}${d.lastUsedAt ? ` · last used ${when(d.lastUsedAt)}` : ' · not used yet'}`));
    return li;
  }));
  $('webPair').hidden = !wp; $('webAddBtn').hidden = !!wp;
  if (wp) {
    if (webQrKey !== wp.link) { webQrKey = wp.link; $('webQr').innerHTML = qrSvg(wp.link, { scale: 4 }); }
    $('webConfirm').hidden = wp.state !== 'confirm';
    $('webName').textContent = wp.browserName || 'the browser';
    $('webCode').textContent = wp.code ? `${wp.code.slice(0, 3)} ${wp.code.slice(3)}` : '';
  }
}
$('webAddBtn').onclick = async () => { try { render(await api('POST', '/ui/web/start', {})); renderWeb(await api('GET', '/ui/account').then(r => r.account)); } catch (e) { toast(e.message); } };
$('webCopy').onclick = async () => { try { await navigator.clipboard.writeText(state.webPairing.link); toast('Link copied. Open it only in the browser you want to add.'); } catch { toast('Could not copy.'); } };
$('webCancel').onclick = () => act('POST', '/ui/web/cancel', {});
async function allowBrowser() { try { const s = await api('POST', '/ui/web/confirm', { allow: true }); render(s); toast(`${s.webAdded?.name || 'The browser'} added.`); } catch (e) { toast(e.message); } }
$('webAllow').onclick = allowBrowser;
// 0.16.4: "Open in this browser" (a computer adding its own browser, or one next to it).
$('webOpen')?.addEventListener('click', () => { if (state?.webPairing?.link) window.open(state.webPairing.link, '_blank', 'noopener'); });
// 0.16.4: a browser waiting for Allow shows as a banner on every page, not only inside Account.
function renderWebBanner() {
  const wp = state?.webPairing, b = $('webBanner');
  if (!b) return;
  b.hidden = wp?.state !== 'confirm';
  if (b.hidden) return;
  $('webBannerText').textContent = `${wp.browserName || t('A browser')} ${t('wants to be added to this computer. Does it show')} ${wp.code.slice(0, 3)} ${wp.code.slice(3)}?`;
}
$('webBannerAllow')?.addEventListener('click', allowBrowser);

// 0.16.4: Add a device: one screen, three kinds (another computer, a phone or browser, a teammate).
var addKind = 'computer', kindQrKey = '';
function renderAddKind() {
  for (const b of document.querySelectorAll('.add-kind')) b.setAttribute('aria-selected', String(b.dataset.kind === addKind));
  $('kindComputer').hidden = addKind !== 'computer'; $('kindPhone').hidden = addKind !== 'phone'; $('kindTeammate').hidden = addKind !== 'teammate';
  if (addKind !== 'phone') return;
  const box = $('kindPhoneWeb'), a = lastAccount, wp = state?.webPairing;
  if (!a?.signedIn || !a?.linked) {
    if (box.dataset.mode === 'signin') return;
    box.dataset.mode = 'signin'; kindQrKey = '';
    box.replaceChildren(text('p', t('First sign in and link this computer (Account). It takes a minute, once.')), button('Open Account', () => $('accountNav').click()));
    box.lastChild.className = 'ghost small-btn';
    return;
  }
  if (!wp) {
    if (box.dataset.mode === 'start') return;
    box.dataset.mode = 'start'; kindQrKey = '';
    const b = button('Show the code', async () => { try { render(await api('POST', '/ui/web/start', {})); } catch (e) { toast(e.message); } }); b.className = 'primary small-btn';
    box.replaceChildren(b);
    return;
  }
  if (box.dataset.mode === 'qr' && kindQrKey === wp.link + wp.state) return;
  box.dataset.mode = 'qr'; kindQrKey = wp.link + wp.state;
  const qr = document.createElement('div'); qr.className = 'phone-qr'; qr.innerHTML = qrSvg(wp.link, { scale: 4 });
  const row = document.createElement('p');
  const open = button('Open in this browser', () => window.open(wp.link, '_blank', 'noopener')); open.className = 'ghost small-btn';
  const copy = button('Copy the link', async () => { try { await navigator.clipboard.writeText(wp.link); toast('Link copied. Open it only in the browser you want to add.'); } catch { toast('Could not copy.'); } }); copy.className = 'ghost small-btn';
  const cancel = button('Cancel', () => act('POST', '/ui/web/cancel', {})); cancel.className = 'linkish';
  row.append(open, ' ', copy, ' ', cancel);
  box.replaceChildren(qr, row, text('small', wp.state === 'confirm' ? t('The browser is waiting: compare the digits in the banner above and press Allow.') : t('The link works once, for 10 minutes.')));
}
for (const b of document.querySelectorAll('.add-kind')) b.addEventListener('click', async () => {
  addKind = b.dataset.kind;
  if (addKind === 'phone' && !lastAccount) { try { lastAccount = (await api('GET', '/ui/account')).account; } catch { /* older service */ } }
  renderAddKind();
});
$('kindPhoneVault')?.addEventListener('click', () => { $('secretsNav').click(); showSecretTab('devices'); $('phonesBox').open = true; $('phonePairBtn').click(); });
$('kindTeamOpen')?.addEventListener('click', async () => { $('accountNav').click(); setTimeout(() => $('accountTeamDir')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 400); });
$('webBannerDeny')?.addEventListener('click', () => act('POST', '/ui/web/confirm', { allow: false }));
$('webDeny').onclick = () => act('POST', '/ui/web/confirm', { allow: false });

// 0.16 pairing with a teammate's computer over the internet: then the pairing screen (6 digits).
async function startTeamPair(d) {
  if (!confirm(`Send a pairing request to ${d.name}? Its owner accepts it on that computer, then you both compare 6 digits (by phone or chat) and press Allow. The relay must be on, on both computers.`)) return;
  try { const s = await api('POST', '/ui/team/pair', { fingerprint: d.fingerprint }); accountModal.hidden = true; wantPair = true; mobileMain = true; render(s); }
  catch (e) { toast(e.message); }
}
async function acceptTeamPair(from) {
  try { const s = await api('POST', '/ui/team/pair/accept', { from }); accountModal.hidden = true; closeNeedsPop?.(); wantPair = true; mobileMain = true; render(s); }
  catch (e) { toast(e.message); }
}
// 0.16 team directory: teammates' linked computers and whether this one is paired with each.
async function loadTeamDirectory(a) {
  const box = $('accountTeamDir'), list = $('teamDirList');
  if (!a.signedIn) { box.hidden = true; return; }
  let teams, offers;
  try { ({ teams, offers = [] } = await api('GET', '/ui/account/team')); } catch { box.hidden = true; return; }
  box.hidden = !teams.length;
  const OS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  // Requests from teammates' computers to pair with this one (both people act; then 6 digits to compare).
  const offerEls = offers.map(o => {
    const d = document.createElement('div'); d.className = 'td-offer';
    d.append(text('span', `${o.email || 'A teammate'} wants to pair ${o.name} with this computer.`));
    const yes = button('Accept', () => acceptTeamPair(o.from)); yes.className = 'primary small-btn';
    const no = button('Ignore', async () => { try { render(await api('POST', '/ui/team/pair/ignore', { from: o.from })); loadTeamDirectory(a); } catch (e) { toast(e.message); } }); no.className = 'ghost small-btn';
    d.append(yes, no); return d;
  });
  list.replaceChildren(...offerEls, ...teams.map(t => {
    const card = document.createElement('section'); card.className = 'td-team';
    const h = document.createElement('div'); h.className = 'td-head';
    h.append(text('b', t.name), Object.assign(text('span', t.role), { className: 'rc-tag' }));
    card.append(h);
    for (const m of t.members) {
      const row = document.createElement('div'); row.className = 'td-member';
      row.append(text('b', `${m.name || m.email || 'A teammate'}${m.you ? ' (you)' : ''}`), Object.assign(text('small', m.role), { className: 'td-role' }));
      const ul = document.createElement('ul'); ul.className = 'td-devices';
      if (!m.devices.length) { const li = text('li', 'No computer linked yet.'); li.className = 'td-none'; ul.append(li); }
      for (const d of m.devices) {
        const li = document.createElement('li'); li.className = 'td-device';
        const nm = text('span', d.name); nm.className = 'td-name'; nm.setAttribute('translate', 'no');
        const meta = text('small', [OS[d.platform], d.version ? `v${d.version}` : '', d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}` : ''].filter(Boolean).join(' · '));
        meta.title = d.fingerprint;
        const st = d.keyMismatch ? ['Key does not match: check this pairing', 'warn'] : d.thisDevice ? ['This computer', 'me'] : d.paired ? [d.online ? 'Paired · online' : 'Paired', 'ok'] : ['Not paired', 'dim'];
        const chip = text('span', st[0]); chip.className = `td-chip ${st[1]}`;
        li.append(nm, chip, meta);
        if (!m.you && !d.thisDevice && !d.paired) {
          const go = button('Pair over the internet', () => startTeamPair(d)); go.className = 'ghost small-btn td-pair';
          li.append(go);
        }
        ul.append(li);
      }
      row.append(ul); card.append(row);
    }
    return card;
  }));
}
$('shareBtn').onclick = async () => {
  try {
    const r = await api('POST', '/ui/account/share', { team: $('shareTeam').value, period: $('sharePeriod').value });
    toast(`Shared with ${r.team}: ${r.summary.total} events counted.`);
  } catch (e) { toast(e.message); }
};
async function accountDo(method, path, body) {
  try { const { account } = await api(method, path, body); renderAccount(account); if (account.signedIn) { loadAccountDevices(); loadAccountTeams(account); loadTeamDirectory(account); } renderWeb(account); return account; }
  catch (e) { toast(e.message); return null; }
}
$('accountNav').onclick = async () => { accountModal.hidden = false; const a = await accountDo('GET', '/ui/account'); if (a && !a.signedIn && !a.pendingEmail) $('accountEmail').focus(); };
$('accountClose').onclick = () => { accountModal.hidden = true; };
accountModal.addEventListener('click', e => { if (e.target === accountModal) accountModal.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !accountModal.hidden) accountModal.hidden = true; });
$('accountEmailForm').onsubmit = async e => { e.preventDefault(); const a = await accountDo('POST', '/ui/account/start', { email: $('accountEmail').value }); if (a?.pendingEmail) { toast('Code sent. Check your email.'); $('accountCode').focus(); } };
$('accountCodeForm').onsubmit = async e => { e.preventDefault(); const code = $('accountCode').value; $('accountCode').value = ''; const a = await accountDo('POST', '/ui/account/verify', { code }); if (a?.signedIn) toast('Signed in.'); };
$('accountOtherEmail').onclick = () => { $('accountCodeForm').hidden = true; $('accountEmailForm').hidden = false; $('accountEmail').focus(); };
$('accountLink').onclick = async () => { if (await accountDo('POST', '/ui/account/link', {})) toast('This computer is linked to your account.'); };
$('accountUnlink').onclick = async () => { if (await accountDo('POST', '/ui/account/unlink', {})) toast('Unlinked.'); };
$('accountSignOut').onclick = async () => { if (await accountDo('POST', '/ui/account/signout', {})) toast('Signed out on this computer.'); };

let state = null, lastPaired = null, firstLoad = true;
let selected = LS.get('selected', null), wantPair = false, wantSecrets = false, wantFirewall = false, wantActivity = false, wantProjects = false, wantRooms = false, wantAgents = false, wantOverview = true, mobileMain = false;
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
const clock = iso => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
function dayLabel(iso) {
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(locale(), { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function shortWhen(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(iso);
  if ((now - d) < 6 * 864e5) return d.toLocaleDateString(locale(), { weekday: 'short' });
  return d.toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
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

  // A pairing in progress keeps the pairing screen open; merely waiting to be picked doesn't.
  const pairing = !!(p && VIEW_OF[p.state] && !isWaitingToBePicked(p));
  if (roomOpen && !roomById(roomOpen)) roomOpen = null;
  const main = pairing || wantPair ? 'pair' : wantSecrets ? 'secrets' : wantFirewall ? 'firewall' : wantActivity ? 'activity' : wantProjects ? 'projects' : wantRooms ? 'rooms' : wantAgents ? 'agents'
    : roomOpen ? 'room' : selected && !wantOverview ? 'thread' : s.peers.length ? 'overview' : 'empty';
  // Left the pairing screen: stop telling the network this device waits to be picked.
  if (main !== 'pair' && isWaitingToBePicked(p) && !render.stopping) {
    render.stopping = true;
    api('POST', '/ui/cancel').catch(() => {}).finally(() => { render.stopping = false; });
  }
  app.dataset.main = main;
  app.dataset.pane = main === 'pair' || main === 'secrets' || main === 'firewall' || main === 'activity' || main === 'projects' || main === 'rooms' || main === 'agents' || ((main === 'thread' || main === 'overview' || main === 'room') && mobileMain) || (main === 'empty' && !s.peers.length) ? 'main' : 'list';
  $('overviewNav').setAttribute('aria-current', String(main === 'overview'));
  const needs = s.needsMe || [];
  renderNeeds();
  renderWebBanner();
  renderAddKind();

  renderPairing(p);
  if (typeof accountModal !== 'undefined' && !accountModal.hidden && lastAccount) renderWeb(lastAccount);
  renderConvos();
  renderRooms();
  if (main === 'room') { renderRoomHead(); loadRoom(); markRoomSeen(); }
  const uses = s.secretUses || [];
  $('secretsCount').textContent = uses.length ? `${uses.length} waiting` : s.secrets.length || '';
  for (const u of uses) if (!seenUses.has(u.id)) { seenUses.add(u.id); toast(`A program asks to use ${u.names.join(', ')}. Open Secrets to approve or deny.`); }
  $('secretsNav').setAttribute('aria-current', String(main === 'secrets'));
  $('firewallCount').textContent = s.waitingRequests || '';
  $('firewallCount').title = s.waitingRequests ? `${s.waitingRequests} request(s) waiting for you` : '';
  $('firewallNav').setAttribute('aria-current', String(main === 'firewall'));
  $('activityNav').setAttribute('aria-current', String(main === 'activity'));
  $('projectsNav').setAttribute('aria-current', String(main === 'projects'));
  $('projectsCount').textContent = (s.projects || []).length || '';
  if (main === 'projects') renderWorkspaces();
  $('roomsNav').setAttribute('aria-current', String(main === 'rooms'));
  $('roomsCount').textContent = (state.rooms || []).filter(r => !r.archived).length || '';
  if (main === 'rooms') renderRoomsPage();
  $('agentsNav').setAttribute('aria-current', String(main === 'agents'));
  agentSummary();
  if (main === 'agents') renderAgentsPage();
  if (main === 'activity' && !render.activityShown) loadActivity();
  render.activityShown = main === 'activity';
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
    prev.textContent = last ? `${last.direction === 'sent' ? (last.by === 'agent' ? `${last.agent?.name || 'Your agent'}: ` : 'You: ') : ''}${flat(last.text)}`
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
  $('headStatus').textContent = `${peer.online === true ? (peer.reachedVia === 'relay' ? 'Online via relay' : 'Online') :peer.online === false ? 'Offline' : 'Checking…'} · ${peer.fingerprint}`;
  const banner = $('banner');
  if (!peer.canMessage) { banner.hidden = false; banner.textContent = 'This device was paired before messaging existed. Remove it and pair again to send messages.'; }
  else if (peer.online === false) { banner.hidden = false; banner.textContent = `${peer.name} seems to be offline. Messages and requests wait here and go out by themselves when it's back (up to 24 hours). Files and secrets need it online. `; const w = button('Why?', () => explain('peer', peer.id)); w.className = 'linkish'; banner.append(w); }
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
    thread = r.messages; cardMap = new Map((r.cards || []).map(c => [c.id, c]));
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
    const cont = prev && prev.direction === m.direction && prev.by === m.by && (prev.agent?.name || '') === (m.agent?.name || '') && new Date(m.sentAt) - new Date(prev.sentAt) < GROUP_MS && !q;
    box.append(messageEl(m, cont, q));
    prev = m;
  }
  if (justOpened || atBottom) box.scrollTop = box.scrollHeight;
  justOpened = false;
}

const KEY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/></svg>';

// ---- cards: tasks, statuses, decisions, key requests, files, links (state worked out by the service) ----
let cardMap = new Map();
const CARD_LABEL = { task: 'Task', status: 'Status', decision: 'Decision', key: 'Key request', file: 'File', link: 'Link' };
const STATE_LABEL = { open: 'Open', claimed: 'Claimed', done: 'Done', answered: 'Answered', posted: '' };
async function cardAction(card, action, option) {
  const where = app.dataset.main === 'room' && roomOpen ? { room: roomOpen } : { to: selected };
  try {
    const s = await api('POST', '/ui/card', { ...where, cardUpdate: { card: card.id, action, ...(option ? { option } : {}) } });
    if (where.room) { roomKey = ''; roomJustOpened = true; } else threadKey = '';
    render(s);
  } catch (e) { toast(e.message); }
}
function cardEl(c0, m = null) {
  const c = cardMap.get(c0.id) || c0;
  const box = document.createElement('div'); box.className = `card card-${c.type}${c.state ? ` st-${c.state}` : ''}${c.level ? ` lv-${c.level}` : ''}`;
  const head = document.createElement('div'); head.className = 'card-head';
  head.append(text('span', c.review ? 'Review' : CARD_LABEL[c.type] || 'Card'));
  if (STATE_LABEL[c.state]) { const s = text('span', STATE_LABEL[c.state]); s.className = 'card-state'; head.append(s); }
  box.append(head, text('b', c.title));
  if (c.body) { const b = document.createElement('div'); b.className = 'card-body'; rich(b, c.body, ''); box.append(b); }
  const info = [];
  if (c.type === 'key') info.push(`${c.name}${c.project ? ` · ${c.project}` : ''}${c.env ? ` · ${c.env}` : ''}`);
  if (c.type === 'file') info.push(`${c.name}${c.size ? ` · ${kb(c.size)}` : ''}`);
  if (c.type === 'link') info.push(c.url);
  if (c.branch || c.path) info.push([c.branch && `branch ${c.branch}`, c.path].filter(Boolean).join(' · '));
  const you = w => (w === 'me' ? 'you' : String(w).replace(/^me › /, ''));
  if (c.claimedBy && c.state === 'claimed') info.push(`Claimed by ${you(c.claimedBy)}`);
  if (c.doneBy) info.push(`Done by ${you(c.doneBy)}`);
  if (c.answer) info.push(`Answer: ${c.answer} (${you(c.answeredBy)})`);
  for (const i of info) { const p = text('small', i); p.className = 'card-info'; box.append(p); }
  const acts = document.createElement('div'); acts.className = 'card-acts';
  if (c.type === 'task') {
    if (c.state === 'open') acts.append(button('Claim', () => cardAction(c, 'claim')));
    if (c.state !== 'done') acts.append(button('Mark done', () => cardAction(c, 'done')));
    if (c.state === 'claimed' && c.claimedBy === 'me') acts.append(button('Release', () => cardAction(c, 'release')));
    if (c.state === 'done') acts.append(button('Reopen', () => cardAction(c, 'reopen')));
  }
  if (c.type === 'decision' && c.state === 'open') for (const o of c.options) acts.append(button(o, () => cardAction(c, 'answer', o)));
  if (c.type === 'key' && c.state !== 'done' && m?.direction === 'received') acts.append(button('Send', async () => {
    if (!confirm(`Send your ${c.name}${c.project ? ` (${c.project}${c.env ? `, ${c.env}` : ''})` : ''} to ${m.peer.name}? It goes sealed to that device only, never to the room.`)) return;
    try { const s = await api('POST', '/ui/card/send-key', { card: c.id }); toast(`Sent ${c.name} to ${m.peer.name}.`); roomKey = ''; threadKey = ''; render(s); } catch (e) { toast(e.message); }
  }));
  if (c.type === 'key' && c.state !== 'done') acts.append(button('Mark sent', () => cardAction(c, 'done')));
  if (c.type === 'file') {
    if (c.localFile) acts.append(button('Download', () => downloadFile(c.localFile, c.name)));
    else if (m?.direction === 'received') acts.append(button('Get file', async () => {
      try { const s = await api('POST', '/ui/card/fetch', { card: c.id }); toast(s.fetched?.note || 'Asked for the file.'); render(s); } catch (e) { toast(e.message); }
    }));
  }
  if (c.type === 'link') acts.append(button('Open link', () => { if (confirm(`Open this link from another device?\n${c.url}`)) window.open(c.url, '_blank', 'noopener,noreferrer'); }));
  for (const b of acts.children) b.className = 'ghost small';
  const why = button('?', () => explain('card', c.id)); why.title = 'What is this card?'; acts.append(why);
  for (const b of acts.children) b.className = 'ghost small';
  if (acts.childElementCount) box.append(acts);
  return box;
}
function cardUpdateEl(m) {
  const el = document.createElement('div'); el.className = 'note card-note'; el.dataset.id = m.id;
  const who = m.direction === 'sent' ? (m.agent ? m.agent.name : 'You') : `${m.peer.name}${m.agent ? ` › ${m.agent.name}` : ''}`;
  const t = document.createElement('span'); t.textContent = `${who}: ${m.text}`;
  const time = document.createElement('small'); time.textContent = clock(m.sentAt);
  el.append(t, time);
  return el;
}

function messageEl(m, cont, q, { room = false } = {}) {
  if (m.args?.cardUpdate) return cardUpdateEl(m);
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
  if (m.by) {
    const tag = document.createElement('span'); tag.className = `tag${m.by === 'person' ? ' person' : ''}`;
    // A named agent: its name, with its fingerprint on hover (as the sending device says).
    tag.textContent = m.by === 'agent' ? (m.agent ? m.agent.name : 'Agent') : out ? 'You' : 'Person';
    if (m.agent) tag.title = `Agent ${m.agent.name} · ${m.agent.fp}${out ? '' : `, as ${m.peer.name} says`}`;
    who.append(tag);
  }
  if (m.via === 'relay') { const v = document.createElement('span'); v.className = 'tag relay'; v.textContent = 'via relay'; v.title = 'Sealed end to end; passed through the account service because no direct link worked.'; who.append(v); }
  if (who.childElementCount) el.append(who);

  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (m.intent && !room && !m.args?.card) {
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
  if (m.args?.card) { bubble.classList.add('has-card'); bubble.append(cardEl(m.args.card, m)); }
  else rich(bubble, m.text, q);
  el.append(bubble);

  const meta = document.createElement('div'); meta.className = 'meta';
  const time = document.createElement('span'); time.textContent = clock(m.sentAt); time.title = new Date(m.sentAt).toLocaleString(locale());
  meta.append(time);
  if (m.status === 'sending') meta.append(text('span', '· Sending…'));
  else if (m.status === 'failed') {
    const f = text('span', '· Not delivered'); f.className = 'fail'; f.title = m.error || ''; meta.append(f);
    meta.append(button('Retry', () => { pending = pending.filter(x => x !== m); sendMessage(m.text, m.replyTo); }));
    meta.append(button('Discard', () => { pending = pending.filter(x => x !== m); renderThread(); }));
  } else if (out && m.queued) {
    const q = text('span', '· Waiting to send: device offline'); q.className = 'queued'; q.title = 'Sent automatically when the device is back, for up to 24 hours.';
    meta.append(q, button('Cancel', async () => { try { render(await api('POST', '/ui/outbox/cancel', { id: m.id })); loadThread?.(); } catch (e) { toast(e.message); } }), button('Why?', () => explain('message', m.id)));
  } else if (out && m.undelivered) { const f = text('span', '· Not delivered'); f.className = 'fail'; f.title = m.undelivered; meta.append(f, button('Why?', () => explain('message', m.id))); }
  else if (out && room && m.to) meta.append(text('span', m.to.length ? `· Delivered to ${m.to.join(', ')}` : '· On this computer'));
  else if (out) meta.append(text('span', '· Delivered'));
  else if (m.firewall && !['allowed', 'approved'].includes(m.firewall.status)) {
    meta.append(button('Why?', () => explain('request', m.id)));
    const f = button(`· ${FW_LABEL[m.firewall.status]}`, () => openFirewall());
    f.className = `linkish fw-${m.firewall.status}`; meta.append(f);
  } else meta.append(text('span', m.read ? '· Your agent read this' : '· Not yet read by your agent'));
  el.append(meta);

  if (!m.status) {
    const tools = document.createElement('div'); tools.className = 'tools';
    const copy = iconButton('copy', 'Copy text', async () => {
      try { await navigator.clipboard.writeText(m.text); toast('Copied.'); } catch { toast('Could not copy.'); }
    });
    if (room) tools.append(copy); else tools.append(iconButton('reply', 'Reply', () => startReply(m)), copy);
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
    li.append(text('b', `${u.agent ? `${u.agent}: ` : ''}use ${u.names.join(', ')}?`));
    const cmd = text('code', u.command); cmd.className = 'use-cmd';
    const row = document.createElement('div'); row.className = 'row';
    // Approve once, or also allow this exact command in this folder for a while (a standing grant).
    const how = document.createElement('select'); how.className = 'use-how'; how.setAttribute('aria-label', 'How long to allow');
    how.append(new Option('Approve once', ''));
    if (u.canAllow) for (const [h, label] of [[1, 'Allow for 1 hour'], [8, 'Allow for 8 hours'], [24, 'Allow for 24 hours'], [168, 'Allow for 7 days']]) how.append(new Option(label, String(h)));
    const more = document.createElement('label'); more.className = 'use-more'; more.hidden = true;
    const moreBox = document.createElement('input'); moreBox.type = 'checkbox';
    more.append(moreBox, ' also with more arguments after this command');
    how.addEventListener('change', () => { more.hidden = !how.value; yes.textContent = how.value ? 'Approve and allow' : 'Approve this run'; });
    const yes = button('Approve this run', () => act('POST', '/ui/secret-use/decide', { id: u.id, approve: true, ...(how.value ? { allowHours: Number(how.value), prefix: moreBox.checked } : {}) }));
    const no = button('Deny', () => act('POST', '/ui/secret-use/decide', { id: u.id, approve: false }));
    yes.className = 'primary small-btn'; no.className = 'ghost';
    row.append(yes, how, no);
    li.append(row, more, cmd, text('small', `In ${u.cwd || 'an unknown folder'} · expires in ${u.expiresIn} s · Approve once: the values go to the program that asked (vinac run${u.agent ? `, started by ${u.agent}` : ''}), which then starts this command with them. Check that you or your agent started it.${u.canAllow ? ' Allowing it instead lets this agent run this exact command (the same arguments) in this folder and its subfolders with these keys, without asking, until it expires; VINAC Link starts it itself and the values never reach the agent.' : ''}`));
    list.append(li);
  }
}

// Standing grants ("Allowed runs") and agent identities.
let newAgentShown = null;
function renderGrants() {
  const grants = state.grants || [];
  $('grantBox').hidden = !grants.length;
  const list = $('grantList'); list.replaceChildren();
  const when = iso => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  for (const g of grants) {
    const li = document.createElement('li'); li.className = 'secret';
    li.append(text('b', `${g.agentName}: ${g.names.join(', ')}`));
    const row = document.createElement('div'); row.className = 'row';
    const rev = button('Revoke', () => act('POST', '/ui/grants/revoke', { id: g.id })); rev.className = 'ghost';
    row.append(rev);
    const cmd = text('code', `${g.command}${g.prefix ? ' …' : ''}`); cmd.className = 'use-cmd';
    li.append(row, cmd, text('small', `In ${g.cwd} and its subfolders · until ${when(g.expiresAt)} · used ${g.uses} time${g.uses === 1 ? '' : 's'}${g.lastUsedAt ? `, last ${when(g.lastUsedAt)}` : ''}${g.needsNewApproval ? ' · made before 0.16.3, no longer used: the next run asks you again' : ''}`));
    list.append(li);
  }
  const agents = state.agents || [];
  $('agentsCount').textContent = agents.length ? `(${agents.length})` : '';
  const al = $('agentList'); al.replaceChildren();
  for (const a of agents) {
    const li = document.createElement('li'); li.className = 'secret';
    const head = document.createElement('div'); head.className = 'app-card-head'; head.append(appMark(appFor(a.name), a.name), text('b', a.name));
    li.append(head);
    const row = document.createElement('div'); row.className = 'row';
    const del = button('Remove', () => { if (confirm(t(`Remove "${a.name}"? Its token stops working and its allowed runs end.`))) act('POST', '/ui/agents/remove', { id: a.id }); }); del.className = 'ghost';
    row.append(del);
    li.append(row, text('small', `Added ${when(a.createdAt)}${a.lastSeenAt ? ` · last seen ${when(a.lastSeenAt)}` : ' · not used yet'}`));
    al.append(li);
  }
  const box = $('agentToken');
  box.hidden = !newAgentShown;
  if (newAgentShown) {
    box.replaceChildren(
      text('b', `${newAgentShown.name}: copy this line now. It is shown only once.`),
      Object.assign(text('code', newAgentShown.env), { className: 'use-cmd' }),
      text('small', 'Codex: codex mcp add vinac --env VINAC_AGENT_TOKEN=… -- node …/connector/bin/vinac.mjs mcp · Other MCP apps: add it to the vinac server\'s environment · Terminal: set it before vinac run.'),
    );
    const copy = button('Copy', async () => { try { await navigator.clipboard.writeText(newAgentShown.env); toast('Copied.'); } catch { toast('Could not copy.'); } });
    const done = button('Done', () => { newAgentShown = null; renderGrants(); });
    copy.className = 'primary small-btn'; done.className = 'ghost';
    const row = document.createElement('div'); row.className = 'row'; row.append(copy, done);
    box.append(row);
  }
}

// ---- Activity log (compliance): search, who did what, CSV, signed report, retention --------
const EVENT_TEXT = {
  'pair': f => `Paired with ${f.peer?.name || 'a device'}`, 'unpair': f => `Unpaired ${f.peer?.name || 'a device'}`,
  'invite.created': () => 'Made an invite', 'phone.paired': f => `Paired the phone ${f.phone}`, 'phone.removed': f => `Removed the phone ${f.phone}`,
  'msg.in': f => `${f.intent ? `Request ${f.intent}` : 'Message'} from ${f.peer?.name || 'a device'}${f.agent ? ` (agent ${f.agent} there)` : ''}${f.firewall ? ` (${f.firewall})` : ''}`,
  'msg.out': f => `${f.intent ? `Request ${f.intent}` : 'Message'} to ${f.peer?.name || 'a device'}`,
  'msg.queued': f => `Message to ${f.peer?.name || 'a device'} waits (device offline)`, 'msg.cancelled': () => 'Waiting message cancelled',
  'request.decided': f => `Request ${f.intent || ''} from ${f.peer?.name || 'a device'}: ${f.status}`, 'request.expired': f => `Request ${f.intent || ''} expired`,
  'secret.in': f => `Received key ${f.name} from ${f.peer?.name || f.phone || 'a device'}${f.offered ? ' (offered)' : ''}`, 'secret.out': f => `Sent key ${f.name} to ${f.peer?.name || 'a device'}`,
  'secret.added': f => `Added key ${f.name}`, 'secret.accepted': f => `Accepted key ${f.name}`, 'secret.revealed': f => `Revealed key ${f.name} on the page`,
  'secret.used': f => `${(f.names || []).join(', ')} used by ${f.command || 'a program'}${f.via === 'grant' ? ' (allowed run)' : ' (approved once)'}`,
  'secret.use.denied': f => `Denied ${(f.names || []).join(', ')} for ${f.command || 'a program'}`,
  'grant.created': f => `Allowed ${f.agent || 'an agent'} to run ${f.command} with ${(f.names || []).join(', ')} for ${f.hours} h`,
  'grant.revoked': f => `Revoked the allowed run ${f.command}`, 'agent.added': f => `Added agent ${f.agent}`, 'agent.removed': f => `Removed agent ${f.agent}`,
  'file.saved': f => `Saved file ${f.name}`, 'mode.changed': f => `Firewall mode: ${f.mode || ''}`, 'rule.changed': f => `Firewall rule changed${f.intent ? `: ${f.intent}` : ''}`,
  'vault.locked': () => 'Vault locked', 'vault.unlocked': () => 'Vault unlocked', 'vault.passphrase.set': () => 'Vault passphrase set', 'vault.passphrase.removed': () => 'Vault passphrase removed',
  'retention.changed': f => `Log kept ${f.keepDays ? `${f.keepDays} days` : 'always'}${f.legalHold ? ', legal hold on' : ''}`,
  // 0.16.3: say what changed in a project.
  'project.changed': f => ({ workspace: `Set up project ${f.project}`, folders: `Changed project ${f.project}'s folder`, brief: `Edited project ${f.project}'s brief`, agents: `Updated who may post in project ${f.project}` }[f.what] || `Changed project ${f.project}`),
  'project.removed': f => `Deleted project ${f.project}`, 'room.created': f => `Made room ${f.room}`, 'room.left': f => `Left room ${f.room}`, 'room.rules': f => `Changed room rules in ${f.room}`,
  'agentapp.connected': f => `Connected ${f.app}`, 'agentapp.disconnected': f => `Disconnected ${f.app}`,
  'audit.exported': f => `Log exported (${f.entries} entries)`, 'report.created': f => `Signed report made (${f.entries} entries)`, 'audit.pruned': f => `${f.entries} old entries removed (retention)`,
};
const WHO_ICON = { person: '●', agent: '◆', device: '▲', service: '○' };
let auditOffset = 0, auditTimer = null;
function auditFilters() {
  const f = { q: $('auditQ').value.trim(), category: $('auditCategory').value, who: $('auditWho').value, agent: $('auditAgent').value, from: $('auditFrom').value, to: $('auditTo').value };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
}
async function loadActivity(more = false) {
  auditOffset = more ? auditOffset + 200 : 0;
  const qs = new URLSearchParams({ ...auditFilters(), limit: '200', offset: String(auditOffset) });
  let r;
  try { r = await api('GET', `/ui/audit?${qs}`); } catch (e) { toast(e.message); return; }
  const cat = $('auditCategory');
  if (cat.options.length === 1) for (const [k, label] of Object.entries(r.categories)) cat.append(new Option(label, k));
  const ag = $('auditAgent'), keepAg = ag.value;
  ag.replaceChildren(new Option('Any agent', '')); for (const a of r.agents) ag.append(new Option(a, a)); ag.value = keepAg;
  const c = r.chain;
  $('auditChain').className = `audit-chain ${c.ok ? 'ok' : 'bad'}`;
  $('auditChain').replaceChildren(
    text('b', c.ok ? `${c.count.toLocaleString(locale())} retained ${c.count === 1 ? 'entry' : 'entries'} verified` : 'Chain broken: an entry was changed or removed'),
    text('small', c.ok ? `Latest fingerprint ${c.head.slice(0, 16)}… · this device ${r.device.fingerprint}${r.retention.anchor ? ` · ${r.retention.anchor.removedEntries} older entries removed by retention` : ''}. This checks the entries against each other; to notice entries cut from the end, compare the latest fingerprint with one you noted earlier (or a signed report).` : c.problem));
  $('auditTotal').textContent = `${r.total.toLocaleString(locale())} matching ${r.total === 1 ? 'entry' : 'entries'}${r.total > auditOffset + r.entries.length ? `, showing ${auditOffset + r.entries.length}` : ''}`;
  const list = $('auditList');
  if (!more) list.replaceChildren();
  const when = iso => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'medium' });
  for (const e of r.entries) {
    const li = document.createElement('li');
    if (e.damaged) { li.append(text('b', 'A damaged line')); list.append(li); continue; }
    const who = text('span', `${WHO_ICON[e.who.kind] || '•'} ${e.who.name}`); who.className = `who who-${e.who.kind}`;
    const what = text('b', (EVENT_TEXT[e.type] || (() => e.type))(e.fields));
    const meta = text('small', `${when(e.at)} · ${e.type}${e.fields.agentFp ? ` · ${e.fields.agentFp}` : ''}${e.device ? ` · ${e.device}` : ''}`);
    li.append(what, who, meta);
    list.append(li);
  }
  if (!r.entries.length && !more) list.append(emptyEl('li', 'key', 'Nothing matches', 'Change the filters, or clear the search.'));
  $('auditMore').hidden = r.total <= auditOffset + r.entries.length;
  $('auditKeep').textContent = `· ${r.retention.legalHold ? 'legal hold' : r.retention.keepDays ? `${Math.round(r.retention.keepDays / 30.4)} months` : 'always'}`;
  $('auditKeepSel').value = String(r.retention.keepDays); $('auditHold').checked = r.retention.legalHold;
}
function openActivity() { roomOpen = null; wantActivity = true; wantProjects = false; wantRooms = false; wantAgents = false; wantFirewall = false; wantSecrets = false; wantPair = false; mobileMain = true; render(state); }
$('activityNav').onclick = openActivity;
$('activityBackBtn').onclick = () => { wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; mobileMain = false; render(state); };
$('auditFilters').addEventListener('input', () => { clearTimeout(auditTimer); auditTimer = setTimeout(() => loadActivity(), 250); });
$('auditFilters').addEventListener('submit', e => e.preventDefault());
$('auditMore').onclick = () => loadActivity(true);
function download(name, type, data) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('auditCsvBtn').onclick = async () => {
  try {
    const r = await fetch('/ui/audit/export', { method: 'POST', headers: { 'x-ui-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ filters: auditFilters() }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    download(`vinac-audit-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', await r.text());
    loadActivity();
  } catch (e) { toast(e.message); }
};
$('auditReportBtn').onclick = async () => {
  const w = window.open('about:blank', '_blank'); // opened now, so it isn't blocked as a pop-up
  try {
    const r = await api('POST', '/ui/audit/report', { filters: auditFilters() });
    download(`vinac-audit-report-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(r.report, null, 1));
    if (w) { w.location.href = r.page; toast('Signed report saved (JSON). The printable page opened in a new tab.'); }
    else {
      // A pop-up blocker stopped the new tab: offer the link instead (it works once, for 2 minutes).
      const a = Object.assign(document.createElement('a'), { href: r.page, target: '_blank', rel: 'noopener', textContent: 'Open the printable report' });
      $('auditTotal').replaceChildren(text('span', 'Signed report saved (JSON). '), a);
    }
    loadActivity();
  } catch (e) { w?.close(); toast(e.message); }
};
$('auditKeepSave').onclick = async () => {
  try { await api('POST', '/ui/audit/retention', { keepDays: Number($('auditKeepSel').value), legalHold: $('auditHold').checked }); toast('Saved.'); loadActivity(); } catch (e) { toast(e.message); }
};

// Phone vault: paired phones, and pairing one (QR code out, its sound back, Allow here).
let phoneKey = '';
function renderPhones() {
  const phones = state.phones || [];
  $('phonesCount').textContent = phones.length ? `(${phones.length})` : '';
  const when = iso => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const pl = $('phoneList'); pl.replaceChildren();
  for (const p of phones) {
    const li = document.createElement('li'); li.className = 'secret';
    li.append(text('b', p.name));
    const row = document.createElement('div'); row.className = 'row';
    const del = button('Remove', () => { if (confirm(t(`Remove "${p.name}"? Keys it sends will no longer open here.`))) act('POST', '/ui/phones/remove', { id: p.id }); }); del.className = 'ghost';
    row.append(del);
    li.append(row, text('small', `Paired ${when(p.pairedAt)}${p.lastUsedAt ? ` · last key ${when(p.lastUsedAt)}` : ''}`));
    pl.append(li);
  }
  const pp = state.phonePairing;
  $('phonePair').hidden = !pp; $('phonePairBtn').hidden = !!pp;
  if (!pp) { if (listenMode === 'phone') stopListening(); phoneKey = ''; return; }
  $('phonesBox').open = true;
  if (phoneKey !== pp.link) { phoneKey = pp.link; $('phoneQr').innerHTML = qrSvg(pp.link, { scale: 5 }); }
  const confirmNow = pp.state === 'confirm';
  $('phoneConfirm').hidden = !confirmNow; $('phoneMeter').hidden = confirmNow;
  if (confirmNow) {
    $('phoneName').textContent = pp.phoneName; $('phoneCode').textContent = pp.code;
    $('phoneStatus').textContent = 'Heard the phone.';
  } else if (listenMode !== 'phone' && !listening) {
    $('phoneStatus').textContent = 'Listening for the phone…';
    startListening('phone');
  }
}
$('phonePairBtn')?.addEventListener('click', async () => {
  try { Object.assign(state, await api('POST', '/ui/phone/start', {})); renderPhones(); } catch (e) { toast(e.message); }
});
$('phoneCancel')?.addEventListener('click', async () => { stopListening(); await act('POST', '/ui/phone/cancel', {}); });
$('phoneCopy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.phonePairing.link); toast('Link copied. Open it on the phone only.'); } catch { toast('Could not copy.'); } });
$('phoneAllow')?.addEventListener('click', async () => {
  try { const r = await api('POST', '/ui/phone/confirm', { allow: true }); Object.assign(state, r); toast(`Paired with ${r.pairedPhone.name}. To get a key from it: Receive… › From your phone here, then Send on the phone.`); renderPhones(); } catch (e) { toast(e.message); }
});
$('phoneDeny')?.addEventListener('click', async () => { await act('POST', '/ui/phone/confirm', { allow: false }); });

// Phone vault 2.0: one of this computer's keys to a paired phone, as a sealed code (or its sound).
let toPhone = null;
function openToPhone(s) {
  toPhone = { secret: s.id, frame: null };
  $('toPhoneKey').textContent = s.name;
  const sel = $('toPhoneSel'); sel.replaceChildren();
  for (const p of state.phones || []) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.append(o); }
  $('toPhoneSel').hidden = $('toPhoneSelLabel').hidden = (state.phones || []).length < 2;
  $('toPhoneOut').hidden = true; $('toPhoneMake').hidden = false; $('toPhoneQr').replaceChildren();
  $('toPhoneModal').hidden = false;
}
function closeToPhone() { $('toPhoneModal').hidden = true; toPhone = null; $('toPhoneQr').replaceChildren(); }
$('toPhoneClose').onclick = closeToPhone;
$('toPhoneModal').addEventListener('click', e => { if (e.target === $('toPhoneModal')) closeToPhone(); });
$('toPhoneSel').onchange = () => { if (toPhone) { toPhone.frame = null; $('toPhoneOut').hidden = true; $('toPhoneMake').hidden = false; } };
$('toPhoneMake').onclick = async () => {
  try {
    const r = await api('POST', '/ui/phones/send', { phone: $('toPhoneSel').value, secret: toPhone.secret });
    toPhone.frame = fromHex(r.hex);
    $('toPhoneQr').innerHTML = qrSvg(r.link, { scale: 4 });
    $('toPhoneOut').hidden = false; $('toPhoneMake').hidden = true;
  } catch (e) { toast(e.message); }
};
$('toPhonePlay').onclick = async () => {
  if (!toPhone?.frame) return;
  try { await engine.playFrame(toPhone.frame, { rawBps: BEACON_BPS, tones: BEACON_TONES, fec: SECRET_FEC, amplitude: 0.3 }); toast('Played. The phone shows the key when it heard it.'); }
  catch (e) { toast(`Could not play sound: ${e.message}`); }
};

// 0.16.3: a small mark for each agent app (our own monograms, not the vendors' logos), and a
// generic one for anything else. Used on the Agents page and wherever an app is named.
const APP_MARKS = {
  claude: ['CC', '#d97757'], codex: ['Cx', '#10a37f'], openclaw: ['OC', '#e5484d'], cursor: ['Cu', '#3b82f6'],
  lmstudio: ['LM', '#7c5cff'], goose: ['Gs', '#f59e0b'], ollama: ['Ol', '#64748b'], webui: ['UI', '#0ea5e9'],
};
function appMark(app, label) {
  const [letters, color] = APP_MARKS[app] || [String(label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '•', '#8b8fa3'];
  const s = document.createElement('span'); s.className = 'app-mark'; s.setAttribute('aria-hidden', 'true');
  s.textContent = letters; s.style.background = color;
  return s;
}
const appFor = name => { const n = String(name || '').toLowerCase(); return /claude/.test(n) ? 'claude' : /codex/.test(n) ? 'codex' : /openclaw/.test(n) ? 'openclaw' : /cursor/.test(n) ? 'cursor' : /lm ?studio/.test(n) ? 'lmstudio' : /goose/.test(n) ? 'goose' : /ollama/.test(n) ? 'ollama' : null; };
for (const el of document.querySelectorAll('.app-mark[data-app]')) el.replaceWith(appMark(el.dataset.app));

// 0.16.3: connected apps and named identities are different counts; say both.
const appsOn = { claude: false, codex: false, openclaw: false };
let claudeMode = null;
function agentSummary() {
  const apps = Object.values(appsOn).filter(Boolean).length, named = (state?.agents || []).length;
  const line = `${apps} connected app${apps === 1 ? '' : 's'} · ${named} named identit${named === 1 ? 'y' : 'ies'}`;
  if ($('agentsNavCount')) { $('agentsNavCount').textContent = apps || named || ''; $('agentsNav').title = line; $('agentsNav').setAttribute('aria-label', `${t('Agents')}: ${line}`); }
  if ($('agentsSummary')) $('agentsSummary').textContent = line;
}
// Claude Code on this computer: connect it from here (the service backs up its settings first).
function renderClaude(c) {
  if (!c || !$('claudeText')) return;
  const connected = c.mode === 'direct' || c.mode === 'plugin';
  appsOn.claude = connected; claudeMode = c.mode; agentSummary();
  const tidy = c.mode === 'plugin' && (c.manual || c.direct?.server);
  $('claudeText').textContent = c.copyProblem && !connected ? c.copyProblem : c.text;
  $('claudeText').className = `claude-line ${connected && !tidy ? 'ok' : c.present ? 'warn' : ''}`;
  $('claudeState').textContent = !c.present ? '' : connected ? '· connected' : '· not connected';
  $('claudeConnect').textContent = connected ? (tidy ? 'Tidy up' : 'Connect again') : 'Connect Claude Code';
  if (c.mode === 'plugin') $('claudeConnect').textContent = 'Connect with its own identity';
  $('claudeConnect').hidden = !!(c.copyProblem && !connected);
  $('claudeRemove').hidden = c.mode !== 'direct' && !c.direct?.server;
  $('claudeBanner').hidden = !c.present || connected || c.dismissed || !!c.copyProblem;
  if (c.mode === 'partial') $('claudeBannerText').textContent = 'It was added by hand, without wake-ups. Connect it again to fix that.';
}
async function refreshClaude() { try { renderClaude(await api('GET', '/ui/connect/claude')); } catch { /* older service */ } }
async function connectClaudeNow(body = {}) {
  try {
    const r = await api('POST', '/ui/connect/claude', body);
    if (!body.dismiss) toast(r.message);
  } catch (e) { toast(e.message); }
  refreshClaude();
}
$('claudeConnect')?.addEventListener('click', () => {
  const plugin = claudeMode === 'plugin';
  if (plugin && !confirm('Turn off the VINAC Link plugin in Claude Code and connect directly instead? Claude Code gets its own identity and the current tools; its skills (/vinac-link:…) go away. You can turn the plugin back on in Claude Code.')) return;
  connectClaudeNow(plugin ? { replacePlugin: true } : {});
});
$('claudeBannerConnect')?.addEventListener('click', () => connectClaudeNow());
$('claudeBannerLater')?.addEventListener('click', () => { $('claudeBanner').hidden = true; connectClaudeNow({ dismiss: true }); });
$('claudeRemove')?.addEventListener('click', () => { if (confirm('Disconnect Claude Code from VINAC Link? Its agents lose the VINAC Link tools after their next start.')) connectClaudeNow({ remove: true }); });
refreshClaude();
window.addEventListener('focus', refreshClaude);

// Codex on this computer (0.15): same idea, no wake-ups (Codex has no hooks yet).
function renderCodex(c) {
  if (!c || !$('codexText')) return;
  const connected = c.mode === 'direct';
  appsOn.codex = connected; agentSummary();
  $('codexText').textContent = c.copyProblem && !connected ? c.copyProblem : c.text;
  $('codexText').className = `claude-line ${connected ? 'ok' : c.present ? 'warn' : ''}`;
  $('codexState').textContent = !c.present ? '' : connected ? '· connected' : '· not connected';
  $('codexConnect').textContent = connected ? 'Connect again' : 'Connect Codex';
  $('codexConnect').hidden = !!(c.copyProblem && !connected);
  $('codexRemove').hidden = c.mode === 'none';
}
async function refreshCodex() { try { renderCodex(await api('GET', '/ui/connect/codex')); } catch { /* older service */ } refreshOpenclaw(); }

// OpenClaw (0.16.3): its plugins connect it; here the person gives it its own identity.
function renderOpenclaw(c) {
  if (!c || !$('openclawBox')) return;
  $('openclawBox').hidden = !c.present;
  appsOn.openclaw = c.mode !== 'none' && c.present; agentSummary();
  $('openclawText').textContent = c.text;
  $('openclawText').className = `claude-line ${c.mode === 'own' ? 'ok' : c.present ? 'warn' : ''}`;
  $('openclawState').textContent = !c.present ? '' : c.mode === 'none' ? '· not connected' : '· connected';
  $('openclawConnect').hidden = c.mode !== 'plugin';
  $('openclawRemove').hidden = c.mode !== 'own';
  $('openclawGuide').hidden = c.mode !== 'none';
  $('openclawSeen').textContent = c.lastSeenAt ? `Last used VINAC Link: ${new Date(c.lastSeenAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}
async function refreshOpenclaw() { try { renderOpenclaw(await api('GET', '/ui/connect/openclaw')); } catch { /* older service */ } }
async function connectOpenclawNow(body = {}) {
  try { toast((await api('POST', '/ui/connect/openclaw', body)).message); } catch (e) { toast(e.message); }
  refreshOpenclaw(); act('GET', '/ui/state');
}
$('openclawConnect')?.addEventListener('click', () => connectOpenclawNow());
$('openclawRemove')?.addEventListener('click', () => { if (confirm('Remove OpenClaw\'s own identity? It keeps working through its plugins as this computer\'s default agent.')) connectOpenclawNow({ remove: true }); });
async function connectCodexNow(body = {}) {
  try { toast((await api('POST', '/ui/connect/codex', body)).message); } catch (e) { toast(e.message); }
  refreshCodex(); act('GET', '/ui/state');
}
$('codexConnect')?.addEventListener('click', () => connectCodexNow());
$('codexRemove')?.addEventListener('click', () => { if (confirm('Disconnect Codex from VINAC Link? It loses the VINAC Link tools after its next start.')) connectCodexNow({ remove: true }); });
refreshCodex();
window.addEventListener('focus', refreshCodex);

// ---- Projects (0.15): a workspace per project for the agents on this computer ----
let projOpen = LS.get('projOpen', null), projData = null;
$('projectsNav').onclick = () => { roomOpen = null; wantAgents = false; wantProjects = true; wantRooms = false; wantAgents = false; wantSecrets = false; wantFirewall = false; wantActivity = false; wantPair = false; mobileMain = true; render(state); };
$('projectsBackBtn').onclick = () => { wantProjects = false; wantRooms = false; wantAgents = false; mobileMain = false; render(state); };
function checks(box, items, picked = []) {
  box.replaceChildren(...items.map(x => {
    const l = document.createElement('label'); l.className = 'proj-check';
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = x.id; c.checked = picked.includes(x.id);
    l.append(c, ` ${x.name}`); return l;
  }));
}
const picked = box => [...box.querySelectorAll('input:checked')].map(c => c.value);
$('projNewBtn').onclick = () => {
  const f = $('projNewForm'); f.hidden = !f.hidden;
  checks($('projNewAgents'), [...(state.agents || []), { id: 'default', name: 'This computer\'s default agent (plugins, terminals)' }], (state.agents || []).filter(a => /claude|codex/i.test(a.name)).map(a => a.id));
  const has = re => (state.agents || []).some(a => re.test(a.name));
  $('projConnectClaude').hidden = has(/claude/i); $('projConnectCodex').hidden = has(/codex/i);
  $('projNewAgentsNote').hidden = has(/claude/i) && has(/codex/i);
  nameTouched = false; $('projFolderFacts').textContent = ''; $('folderBrowser').hidden = true;
  checks($('projNewDevices'), state.peers || []);
  $('projNewDevices').closest('fieldset').hidden = !(state.peers || []).length;
  if (!f.hidden) $('projNewName').focus();
};
$('projNewCancel').onclick = () => { $('projNewForm').hidden = true; $('folderBrowser').hidden = true; };

// Folder: the system's folder window (the service opens it on this computer), else the page's own browser.
let nameTouched = false;
$('projNewName').addEventListener('input', () => { nameTouched = !!$('projNewName').value.trim(); });
async function setFolder(p) {
  $('projNewFolder').value = p;
  await showFolderFacts();
}
async function showFolderFacts() {
  const p = $('projNewFolder').value.trim(), out = $('projFolderFacts');
  if (!p) { out.textContent = ''; out.className = 'folder-facts'; return; }
  try {
    const f = await api('GET', `/ui/folders/facts?path=${encodeURIComponent(p)}`);
    if (!f.exists) { out.textContent = 'This folder doesn\'t exist on this computer.'; out.className = 'folder-facts warn'; return; }
    out.textContent = [f.git ? `Git repository${f.branch ? `, on ${f.branch}` : ''}` : 'Not a git repository', f.manifest ? 'vinac.keys.json found' : 'no vinac.keys.json (optional)'].join(' · ');
    out.className = 'folder-facts ok';
    if (!nameTouched && f.name) $('projNewName').value = f.name.slice(0, 40);
  } catch { out.textContent = ''; }
}
$('projNewFolder').addEventListener('change', showFolderFacts);
$('projBrowse').onclick = async () => {
  const b = $('projBrowse'); b.disabled = true; b.textContent = 'Choose in the window…';
  try {
    const r = await api('POST', '/ui/folders/pick', { start: $('projNewFolder').value.trim() || undefined });
    if (r.path) await setFolder(r.path);
    else if (r.unavailable) openFolderBrowser($('projNewFolder').value.trim());
  } catch (e) { toast(e.message); openFolderBrowser($('projNewFolder').value.trim()); }
  finally { b.disabled = false; b.textContent = 'Browse…'; }
};
let fbAt = null;
async function openFolderBrowser(start) {
  try {
    const r = await api('GET', `/ui/folders${start ? `?path=${encodeURIComponent(start)}` : ''}`);
    fbAt = r; $('folderBrowser').hidden = false;
    $('fbPath').textContent = r.path + (r.git ? `  ·  git${r.branch ? ` (${r.branch})` : ''}` : '');
    $('fbUp').disabled = !r.parent;
    const items = r.dirs.map(name => { const li = document.createElement('li'); li.append(button(`📁 ${name}`, () => openFolderBrowser(`${r.path}${/[\\/]$/.test(r.path) ? '' : r.path.includes('\\') ? '\\' : '/'}${name}`))); return li; });
    if (!r.parent) for (const root of r.roots || []) if (root !== r.path) { const li = document.createElement('li'); li.append(button(`💽 ${root}`, () => openFolderBrowser(root))); items.unshift(li); }
    $('fbList').replaceChildren(...items);
    if (!items.length) $('fbList').append(text('li', 'No folders inside.'));
  } catch (e) { toast(e.message); }
}
$('projBrowseHere').onclick = () => openFolderBrowser($('projNewFolder').value.trim());
$('fbUp').onclick =() => fbAt?.parent && openFolderBrowser(fbAt.parent);
$('fbHome').onclick = () => openFolderBrowser(fbAt?.home || '');
$('fbClose').onclick = () => { $('folderBrowser').hidden = true; };
$('fbUse').onclick = async () => { if (fbAt) { await setFolder(fbAt.path); $('folderBrowser').hidden = true; } };
async function connectFromProject(app) {
  try { toast((await api('POST', `/ui/connect/${app}`, {})).message); } catch (e) { toast(e.message); }
  const s = await api('GET', '/ui/state'); render(s);
  checks($('projNewAgents'), [...(s.agents || []), { id: 'default', name: 'This computer\'s default agent (plugins, terminals)' }], [...picked($('projNewAgents')), ...(s.agents || []).filter(a => /claude|codex/i.test(a.name)).map(a => a.id)]);
  const has = re => (s.agents || []).some(a => re.test(a.name));
  $('projConnectClaude').hidden = has(/claude/i); $('projConnectCodex').hidden = has(/codex/i);
  $('projNewAgentsNote').hidden = has(/claude/i) && has(/codex/i);
  refreshClaude(); refreshCodex();
}
$('projConnectClaude').onclick = () => connectFromProject('claude');
$('projConnectCodex').onclick = () => connectFromProject('codex');
$('projNewForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const r = await api('POST', '/ui/projects/workspace', { name: $('projNewName').value.trim(), about: $('projNewAbout').value.trim(), folder: $('projNewFolder').value.trim(), agents: picked($('projNewAgents')), devices: picked($('projNewDevices')) });
    $('projNewForm').hidden = true; $('projNewName').value = ''; $('projNewFolder').value = ''; $('projNewAbout').value = '';
    projOpen = r.project.id; LS.set('projOpen', projOpen); projData = r;
    render(r); renderWorkspaces(true); toast(`Project ${r.project.name} created, with its room.`);
  } catch (err) { toast(err.message); }
});
let wsKey = '';
$('projSearch').addEventListener('input', () => renderWorkspaces(true));
function renderWorkspaces(force = false) {
  const all = state.projects || [];
  const pq = $('projSearch').value.trim().toLowerCase();
  $('projSearch').hidden = all.length < 4 && !pq;
  const list = pq ? all.filter(p => p.name.toLowerCase().includes(pq) || (p.about || '').toLowerCase().includes(pq) || (p.folders || []).some(f => f.toLowerCase().includes(pq))) : all;
  // Redraw only when something changed, and never under the person's typing.
  const room = projOpen && list.find(p => p.id === projOpen)?.room;
  const key = JSON.stringify([list, pq, state.agents || [], projOpen, (state.rooms || []).find(r => r.id === room)?.last?.id || null, (state.grants || []).length]);
  const busy = $('projDetail').contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON' || [...$('projDetail').querySelectorAll('input:not([type=checkbox])')].some(i => i.value);
  if (!force && (key === wsKey || busy)) return;
  wsKey = key;
  $('projEmpty').hidden = all.length > 0;
  if (projOpen && !list.some(p => p.id === projOpen)) projOpen = null;
  if (!projOpen && list.length) projOpen = list[0].id;
  $('projList').replaceChildren(...list.map(p => {
    const li = document.createElement('li'); li.className = `proj-item${p.id === projOpen ? ' on' : ''}`;
    const b = button(p.name, () => { projOpen = p.id; LS.set('projOpen', p.id); renderWorkspaces(true); });
    const n = (p.agents || []).length;
    const small = document.createElement('small'); small.textContent = `${p.folders?.[0] || 'no folder'} · ${n} agent${n === 1 ? '' : 's'}`;
    li.append(b, small); return li;
  }));
  if (projOpen) loadProject(projOpen); else $('projDetail').hidden = true;
}
async function loadProject(id) {
  try { projData = await api('GET', `/ui/project?id=${encodeURIComponent(id)}`); drawProject(); } catch (e) { $('projDetail').hidden = true; }
}
function sec(title, ...kids) { const s = document.createElement('section'); s.className = 'proj-sec'; const h = document.createElement('h3'); h.className = 'fw-h'; h.textContent = title; s.append(h, ...kids); return s; }
function note(text) { const p = document.createElement('p'); p.className = 'fw-note'; p.textContent = text; return p; }
function cardLine(c) {
  const li = document.createElement('li'); li.className = 'proj-card';
  const t = document.createElement('b'); t.textContent = `${c.review ? 'Review: ' : ''}${c.title}`;
  const m = document.createElement('small');
  m.textContent = [c.branch && `branch ${c.branch}`, c.path, c.claimedBy && `claimed by ${c.claimedBy}`, c.doneBy && `done by ${c.doneBy}`, !c.claimedBy && !c.doneBy && `from ${c.from}`].filter(Boolean).join(' · ');
  li.append(t, m); return li;
}
function drawProject() {
  const d = projData, box = $('projDetail');
  if (!d) return;
  box.hidden = false;
  const small = (cls, label, fn) => { const b = button(label, fn); b.className = cls; return b; };

  // Header: name, open the room, the folder (with its own picker), the brief.
  const head = document.createElement('div'); head.className = 'proj-head';
  const titleRow = document.createElement('div'); titleRow.className = 'proj-title-row';
  const h = document.createElement('h2'); h.textContent = d.project.name;
  titleRow.append(h);
  if (d.room) titleRow.append(small('primary', `Open room #${d.room.name}`, () => openRoom(d.room.id)));
  const folderRow = document.createElement('div'); folderRow.className = 'proj-folder-row';
  const fp = text('span', d.project.folders[0] || 'No folder yet'); fp.className = `proj-folder${d.project.folders[0] ? '' : ' none'}`;
  const chooseFolder = small('ghost', d.project.folders[0] ? 'Change folder…' : 'Choose folder…', async () => {
    let p = null;
    try {
      const r = await api('POST', '/ui/folders/pick', { start: d.project.folders[0] || undefined });
      p = r.path || (r.unavailable ? prompt('The project\'s folder on this computer (full path):', d.project.folders[0] || '') : null);
    } catch (e) { toast(e.message); return; }
    if (!p) return;
    try { const s = await api('POST', '/ui/projects', { id: d.project.id, name: d.project.name, folders: [p], prodAsks: d.project.prodAsks }); render(s); loadProject(d.project.id); toast('Folder saved.'); } catch (e) { toast(e.message); }
  });
  folderRow.append(fp, chooseFolder);
  const about = document.createElement('textarea'); about.className = 'proj-about'; about.maxLength = 600; about.rows = 2; about.value = d.project.about || '';
  about.placeholder = 'What are you building? The project\'s agents read this as their brief.'; about.setAttribute('aria-label', 'What are you building?');
  const saveAbout = small('ghost', 'Save', async () => { try { projData = await api('POST', '/ui/projects/about', { id: d.project.id, about: about.value }); about.blur(); toast('Saved. The project\'s agents see it in vinac_peers.'); } catch (e) { toast(e.message); } });
  const aboutRow = document.createElement('div'); aboutRow.className = 'proj-about-row'; aboutRow.append(about, saveAbout);
  head.append(titleRow, folderRow, aboutRow);

  // Board (full width)
  const roomNote = note(d.room ? (d.room.members.length ? `Room shared with ${d.room.members.join(', ')} and the agents here.` : 'Room on this computer only: its agents and you.') : 'No room.');
  const cols = document.createElement('div'); cols.className = 'proj-board';
  for (const [label, items, cls] of [['Open', d.board.open, 'open'], ['Claimed', d.board.claimed, 'claimed'], ['Done', d.board.done, 'done']]) {
    const col = document.createElement('div'); col.className = `proj-col col-${cls}`;
    const hh = document.createElement('h4'); hh.append(text('span', label), text('span', String(items.length)));
    const ul = document.createElement('ul');
    if (items.length) ul.append(...items.map(cardLine)); else { const e = text('li', 'Nothing here'); e.className = 'proj-empty'; ul.append(e); }
    col.append(hh, ul); cols.append(col);
  }
  const addTask = document.createElement('form'); addTask.className = 'proj-inline';
  const ti = document.createElement('input'); ti.placeholder = 'New task for the agents'; ti.maxLength = 200; ti.setAttribute('aria-label', 'New task');
  const tb = document.createElement('button'); tb.className = 'primary'; tb.type = 'submit'; tb.textContent = 'Add task';
  addTask.append(ti, tb);
  addTask.onsubmit = async e => { e.preventDefault(); if (!ti.value.trim() || !d.room) return; try { await api('POST', '/ui/card', { room: d.room.id, card: { type: 'task', title: ti.value.trim() } }); ti.value = ''; ti.blur(); loadProject(d.project.id); } catch (err) { toast(err.message); } };
  // 0.16 team projects: add a paired computer (your own, or a teammate's) to the project room.
  const addDev = document.createElement('form'); addDev.className = 'proj-inline';
  const others = (state.peers || []).filter(x => d.room && !d.room.members.includes(x.name));
  if (d.room && others.length) {
    const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Computer to add');
    for (const x of others) sel.append(new Option(x.name, x.id));
    const ab = document.createElement('button'); ab.type = 'submit'; ab.className = 'ghost'; ab.textContent = 'Add to the room';
    addDev.append(sel, ab);
    addDev.onsubmit = async e => {
      e.preventDefault();
      try { render(await api('POST', '/ui/rooms/members', { id: d.room.id, add: [sel.value] })); loadProject(d.project.id); toast('Added. Its agents see the project\'s posts from now on, through its own firewall.'); } catch (err) { toast(err.message); }
    };
  }
  const boardSec = sec('Task board', roomNote, cols, ...(d.room ? [addTask] : []), ...(addDev.childElementCount ? [addDev] : []),
    ...(d.board.decisions.length ? [note(`${d.board.decisions.length} decision(s) wait for you in the room.`)] : []));
  boardSec.classList.add('wide');

  // Agents
  let agentsSec;
  const named = d.agents.filter(a => a.id !== 'default');
  const hasApp = re => named.some(a => re.test(a.name));
  if (true) {
    // 0.16.3: who may post is an explicit choice; "none ticked" no longer silently means "everyone".
    const ag = document.createElement('div'); ag.className = 'proj-checks';
    checks(ag, d.agents, d.project.agents);
    const mode = document.createElement('div'); mode.className = 'proj-checks';
    const radio = (value, label, on) => { const l = document.createElement('label'); const r = document.createElement('input'); r.type = 'radio'; r.name = `postMode-${d.project.id}`; r.value = value; r.checked = on; l.append(r, ` ${t(label)}`); return l; };
    const all = !d.project.agents.length;
    mode.append(radio('selected', 'Only the agents ticked below', !all), radio('all', 'Every agent on this computer (named or not)', all));
    const effective = document.createElement('p'); effective.className = 'note';
    const showEffective = () => {
      const sel = mode.querySelector('input:checked').value === 'selected';
      ag.hidden = !sel;
      const names = d.agents.filter(a => picked(ag).includes(a.id)).map(a => a.name);
      effective.textContent = sel ? (names.length ? `${t('Can post in the project room:')} ${names.join(', ')}. ${t('Every other agent here is refused there.')}` : t('Tick at least one agent, or choose "Every agent".')) : t('Can post in the project room: every agent on this computer. (To stop all agents for a while, use Pause agents in the room.)');
    };
    mode.addEventListener('change', showEffective); ag.addEventListener('change', showEffective); showEffective();
    const saveAgents = small('ghost', 'Save who may post', async () => {
      const sel = mode.querySelector('input:checked').value === 'selected';
      const list = sel ? picked(ag) : [];
      if (sel && !list.length) return toast(t('Tick at least one agent, or choose "Every agent".'));
      try { projData = await api('POST', '/ui/projects/agents', { id: d.project.id, agents: list }); drawProject(); toast('Saved.'); } catch (e) { toast(e.message); }
    });
    const connectRow = document.createElement('div'); connectRow.className = 'row';
    for (const [app, label, re] of [['claude', 'Give Claude Code its own identity', /claude/i], ['codex', 'Give Codex its own identity', /codex/i]]) if (!hasApp(re)) connectRow.append(small('ghost', label, async () => {
      try { toast((await api('POST', `/ui/connect/${app}`, {})).message); } catch (e) { toast(e.message); }
      render(await api('GET', '/ui/state')); refreshClaude(); refreshCodex(); loadProject(d.project.id);
    }));
    agentsSec = sec('Who may post', mode, ag, effective, saveAgents, note('"Default agent" is anything without its own identity: a plugin, a terminal, OpenClaw.'), ...(connectRow.childElementCount ? [note('Without an identity of their own here (they act as the default agent):'), connectRow] : []));
  } else {
    const row = document.createElement('div'); row.className = 'row';
    for (const [app, label] of [['claude', 'Connect Claude Code'], ['codex', 'Connect Codex']]) row.append(small('ghost', label, async () => {
      try { toast((await api('POST', `/ui/connect/${app}`, {})).message); } catch (e) { toast(e.message); }
      render(await api('GET', '/ui/state')); refreshClaude(); refreshCodex(); loadProject(d.project.id);
    }));
    agentsSec = sec('Agents', note('Connect the agent apps on this computer; each gets its own identity, then tick them here.'), row);
  }

  // Keys and allowed runs
  const kv = document.createElement('div'); kv.className = 'proj-keys';
  const missing = d.manifest ? (d.manifest.dev || []).filter(n => !d.keys.dev.includes(n)) : [];
  const chip = (t, cls = '') => { const c = text('span', t); c.className = `rc-tag ${cls}`; return c; };
  kv.append(text('b', 'Dev'), ...(d.keys.dev.length ? d.keys.dev.map(n => chip(n)) : [chip('none', 'dim')]));
  const kv2 = document.createElement('div'); kv2.className = 'proj-keys';
  kv2.append(text('b', 'Prod'), ...(d.keys.prod.length ? d.keys.prod.map(n => chip(n)) : [chip('none', 'dim')]));
  const keyKids = [kv, kv2];
  if (missing.length) { const kv3 = document.createElement('div'); kv3.className = 'proj-keys'; kv3.append(text('b', 'Missing'), ...missing.map(n => chip(n, 'warn'))); keyKids.push(kv3); }
  const addKeys = small('ghost', 'Add keys…', () => { $('secretsNav').click(); });
  const gl = document.createElement('ul'); gl.className = 'proj-files';
  gl.append(...d.grants.map(g => { const li = document.createElement('li'); li.textContent = `${g.agentName}: ${g.command}${g.prefix ? ' …' : ''} with ${g.names.join(', ')} until ${new Date(g.expiresAt).toLocaleString()}${g.needsNewApproval ? ' (made before 0.16.3: no longer used; allow it again)' : ''}`; return li; }));
  const gf = document.createElement('form'); gf.className = 'proj-inline';
  const gc = document.createElement('input'); gc.placeholder = 'Command, e.g. npm run dev'; gc.maxLength = 400; gc.setAttribute('aria-label', 'Command');
  const gh = document.createElement('select'); gh.setAttribute('aria-label', 'For how long');
  for (const hr of [1, 8, 24]) { const o = document.createElement('option'); o.value = hr; o.textContent = `${hr} h`; if (hr === 8) o.selected = true; gh.append(o); }
  const gb = document.createElement('button'); gb.className = 'ghost'; gb.type = 'submit'; gb.textContent = 'Allow';
  const gm = document.createElement('label'); gm.className = 'use-more';
  const gmBox = document.createElement('input'); gmBox.type = 'checkbox';
  gm.append(gmBox, ' also with more arguments after it');
  gf.append(gc, gh, gb, gm);
  gf.onsubmit = async e => {
    e.preventDefault(); if (!gc.value.trim()) return;
    const more = gmBox.checked;
    if (!confirm(`Let this project's agents run exactly "${gc.value.trim()}"${more ? ' or that command followed by ANY further arguments' : ' (these arguments only)'} in its folder with its dev keys for ${gh.value} h? Whatever that command runs gets the keys.`)) return;
    try { const r = await api('POST', '/ui/projects/grant', { id: d.project.id, command: gc.value.trim(), hours: Number(gh.value), prefix: more }); projData = r; drawProject(); toast(r.note); } catch (err) { toast(err.message); }
  };
  const canAllow = d.project.folders[0] && d.keys.dev.length;
  const keysSec = sec('Keys and allowed runs', ...keyKids, addKeys,
    note(canAllow ? 'Agent tools never return values. An allowed command is started by VINAC Link itself, so the values never reach the agent (a run you approve once gives them to the program that asked). Allow one command for the project\'s agents with its DEV keys, without asking each time. Prod keys always ask.' : 'Agent tools never return values. Give the project a folder and dev keys, then you can allow one command with them. Prod keys always ask.'),
    gl, ...(canAllow ? [gf] : []));

  // Files
  const fl = document.createElement('ul'); fl.className = 'proj-files';
  fl.append(...d.files.map(c => { const li = document.createElement('li'); li.textContent = c.type === 'link' ? `${c.title} · ${c.url}` : `${c.name} · ${Math.max(1, Math.round((c.size || 0) / 1024))} KB · from ${c.from}`; return li; }));
  const filesSec = sec('Files', note(d.files.length ? 'Posted in the room. Other devices in the room get them on request.' : 'Agents here share the project folder, so they hand work over by branch or path. Files posted in the room show here.'), fl);

  const grid = document.createElement('div'); grid.className = 'proj-grid';
  grid.append(boardSec, agentsSec, keysSec, filesSec);
  const foot = document.createElement('div'); foot.className = 'proj-foot';
  const del = small('danger-link', 'Delete project…', () => {
    if (!confirm(`Delete the project "${d.project.name}"? Its keys stay, in "No project". Its room stays too.`)) return;
    act('POST', '/ui/projects/remove', { id: d.project.id }); projOpen = null; projData = null; $('projDetail').hidden = true;
  });
  foot.append(del);
  box.replaceChildren(head, grid, foot);
}

$('agentAddForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('agentName').value.trim();
  if (!name) return;
  try {
    const r = await api('POST', '/ui/agents/add', { name });
    newAgentShown = r.newAgent; $('agentName').value = '';
    Object.assign(state, r); renderGrants();
  } catch (err) { toast(err.message); }
});

// Projects: keys grouped per project and environment. The folder an agent works in picks the project.
function renderProjects() {
  const box = $('projectsBox'); if (!box) return;
  box.replaceChildren();
  // 0.15: keys below are grouped by project; projects are made and changed on the Projects page.
  box.className = 'projects-line';
  const n = (state.projects || []).length;
  box.append(text('span', n ? `Keys are grouped by project (${n}). Agents working in a project's folder see only its keys.` : 'Group keys by project (dev and prod), so agents in a project\'s folder see only its keys.'));
  const go = button(n ? 'Manage projects' : 'New project', () => { $('projectsNav').click(); if (!n) setTimeout(() => $('projNewBtn').click(), 50); });
  go.className = 'ghost small-btn'; box.append(go);
  return;
  const head = document.createElement('div'); head.className = 'proj-head';
  head.append(text('b', 'Projects'));
  const add = button('New project', () => editProject(null)); add.className = 'ghost small-btn';
  head.append(add); box.append(head);
  const list = state.projects || [];
  if (!list.length) { const p = text('p', 'Group keys per project (dev and prod), so the same name can exist in several projects. Agents in a project\'s folder see only that project\'s keys.'); p.className = 'hint small'; box.append(p); return; }
  for (const p of list) {
    const row = document.createElement('div'); row.className = 'proj-row';
    const n = (state.secrets || []).filter(s => s.projectId === p.id).length;
    const t = document.createElement('div'); t.append(text('b', p.name), text('small', `${p.folders.join(' · ') || 'No folder yet'} · ${n} key${n === 1 ? '' : 's'}${p.prodAsks ? ' · prod keys ask every time' : ''}`));
    const edit = button('Edit', () => editProject(p)); edit.className = 'ghost small-btn';
    const del = button('Delete', () => { if (confirm(`Delete the project "${p.name}"? Its keys stay, in "No project".`)) act('POST', '/ui/projects/remove', { id: p.id }); }); del.className = 'ghost small-btn';
    row.append(t, edit, del); box.append(row);
  }
}
async function editProject(p) {
  const name = prompt('Project name', p?.name || ''); if (!name) return;
  const folder = prompt('The project\'s folder on this computer (full path; agents working there use this project\'s keys)', p?.folders?.[0] || '');
  if (folder === null) return;
  const prodAsks = confirm('Should production (prod) keys ask you every time they are used? (Recommended: OK)');
  try { const s = await api('POST', '/ui/projects', { id: p?.id, name, folders: folder ? [folder] : [], prodAsks }); render(s); toast(`Project ${name} saved.`); } catch (e) { toast(e.message); }
}

function renderSecrets(force = false) {
  const q = ($('secretSearch').value || '').trim().toLowerCase();
  const key = JSON.stringify(state.secrets) + JSON.stringify(state.projects || []) + shownSecret?.id + JSON.stringify((state.secretUses || []).map(u => u.id)) + q + JSON.stringify(state.vaultLock) + JSON.stringify(state.secretRequests || []) + JSON.stringify(state.grants || []) + JSON.stringify(state.agents || []) + JSON.stringify(state.phones || []) + JSON.stringify(state.phonePairing || null);
  if (key === secretsKey && !force) return;
  secretsKey = key;
  renderVaultLock();
  renderSecretRequests();
  renderUses();
  renderGrants();
  renderPhones();
  renderSecretTabs();
  renderProjects();
  const list = $('secretList'); list.replaceChildren();
  $('secretSearch').hidden = state.secrets.length < 4 && !q;
  if (!state.secrets.length) {
    list.append(emptyEl('li', 'key', 'Your vault is empty', 'Add a key you have, or receive one from a paired device. Values stay in this computer\'s key store, never in a chat, and agents see only their names.'));
    return;
  }
  const shown = [...state.secrets].reverse().filter(s => !q || s.name.toLowerCase().includes(q) || (s.from?.name || '').toLowerCase().includes(q));
  if (!shown.length) { const li = text('li', 'No secret matches.'); li.className = 'none'; list.append(li); return; }
  const day = iso => new Date(iso).toLocaleDateString(locale(), { dateStyle: 'medium' });
  const when = iso => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const projects = state.projects || [];

  // Groups: what waits for you first, then each project (dev, then prod), then keys in no project.
  const groups = [];
  const waiting = shown.filter(s => s.pending || s.offered);
  if (waiting.length) groups.push({ title: 'Waiting for you', tone: 'warn', items: waiting });
  for (const p of projects) for (const env of ['dev', 'prod']) {
    const items = shown.filter(s => !s.pending && !s.offered && s.projectId === p.id && (s.env || 'dev') === env);
    if (items.length || (env === 'dev' && !q && !shown.some(s => s.projectId === p.id))) groups.push({ title: p.name, env, tone: env, items, project: p });
  }
  const loose = shown.filter(s => !s.pending && !s.offered && !projects.some(p => p.id === s.projectId));
  if (loose.length) groups.push({ title: projects.length ? 'No project' : 'Keys', tone: 'none', items: loose });

  for (const g of groups) {
    const sec = document.createElement('li'); sec.className = `key-group tone-${g.tone}`;
    const head = document.createElement('div'); head.className = 'kg-head';
    head.append(text('b', g.title));
    if (g.env) { const e = text('span', g.env); e.className = `env-chip env-${g.env}`; head.append(e); }
    const n = text('span', String(g.items.length)); n.className = 'kg-count'; head.append(n);
    if (g.env === 'prod') { const h = text('small', 'asks you every time'); h.className = 'kg-note'; head.append(h); }
    sec.append(head);
    const ul = document.createElement('ul'); ul.className = 'key-rows';
    if (!g.items.length) { const e = text('li', 'No keys in this project yet. Add one, or move a key here from its ⋯ menu.'); e.className = 'kg-empty'; ul.append(e); }
    for (const s of g.items) ul.append(keyRow(s));
    sec.append(ul); list.append(sec);
  }

  function keyRow(s) {
    const li = document.createElement('li'); li.className = `key-row${s.pending || s.offered ? ' attention' : ''}`;
    const tile = document.createElement('span'); tile.className = `key-tile env-${s.offered || s.pending ? 'warn' : s.projectId ? (s.env || 'dev') : 'none'}`; tile.innerHTML = KEY_SVG;
    const main = document.createElement('div'); main.className = 'key-main';
    const name = text('b', s.name); name.className = 'key-name';
    if (s.pending) { const t = text('span', 'Replacement waiting'); t.className = 'pendingtag'; name.append(t); }
    if (s.offered) { const t = text('span', 'Offered: accept?'); t.className = 'pendingtag'; name.append(t); }
    const origin = s.own ? `This device · ${day(s.receivedAt)}` : `From ${s.from.name} · ${day(s.receivedAt)}`;
    const meta = text('small', `${origin}${s.lastUsedAt ? ` · used ${when(s.lastUsedAt)}` : ''}${s.pending ? ' · approve to replace the current one' : ''}${s.offered ? ' · nothing can use it until you accept it' : ''}`);
    meta.title = `${s.own ? `Added on this device ${when(s.receivedAt)}` : `From ${s.from.name}, ${when(s.receivedAt)}, by ${s.via === 'wifi' ? 'Wi-Fi' : 'sound'}`} · ${KEYSTORE_SHORT[s.keystore] || s.keystore}`;
    main.append(name, meta);
    const acts = document.createElement('div'); acts.className = 'key-acts';
    const showing = shownSecret?.id === s.id;
    if (s.offered) {
      const ok = button('Accept', () => act('POST', '/ui/secrets/accept', { id: s.id })); ok.className = 'primary small-btn';
      const no = button('Decline', () => act('POST', '/ui/secrets/decline', { id: s.id })); no.className = 'ghost';
      acts.append(ok, no);
    } else {
      if (s.pending) { const ap = button('Approve', () => act('POST', '/ui/secrets/approve', { id: s.id })); ap.className = 'primary small-btn'; acts.append(ap); }
      const reveal = button(showing ? 'Hide' : 'Reveal', async () => {
        if (showing) { hideSecret(); return; }
        try { const r = await api('POST', '/ui/secrets/reveal', { id: s.id }); showSecret(r); } catch (e) { toast(e.message); }
      });
      const copy = button('Copy', async () => {
        try {
          const r = await api('POST', '/ui/secrets/reveal', { id: s.id });
          let value = r.value;
          await navigator.clipboard.writeText(value);
          toast(`${s.name} copied. It is cleared from the clipboard in 30 seconds.`);
          // Clear it after 30 s, but only if it is still what's on the clipboard.
          setTimeout(async () => {
            try { if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText(''); }
            catch { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}); }
            value = null;
          }, 30_000);
        } catch (e) { toast(e.message.includes('clipboard') ? 'Could not copy.' : e.message); }
      });
      reveal.className = 'ghost'; copy.className = 'ghost';
      acts.append(reveal, copy);
      // The rest under ⋯: send, move to a project, delete.
      const more = document.createElement('details'); more.className = 'key-more';
      const sum = document.createElement('summary'); sum.textContent = '⋯'; sum.title = 'More'; sum.setAttribute('aria-label', `More for ${s.name}`);
      const menu = document.createElement('div'); menu.className = 'key-menu';
      if (!s.pending) menu.append(button('Send to a device…', () => { more.open = false; openSecretModal('stored', { item: s }); }));
      if (!s.pending && (state.phones || []).length) menu.append(button('Send to a phone…', () => { more.open = false; openToPhone(s); }));
      if (projects.length) {
        const lab = document.createElement('label'); lab.className = 'key-move'; lab.append(text('span', 'Project'));
        const sel = document.createElement('select'); sel.setAttribute('aria-label', `Project for ${s.name}`);
        const opt = (v, l) => { const o = document.createElement('option'); o.value = v; o.textContent = l; return o; };
        sel.append(opt('', 'No project'));
        for (const p of projects) for (const env of ['dev', 'prod']) sel.append(opt(`${p.id}|${env}`, `${p.name} · ${env}`));
        sel.value = s.projectId ? `${s.projectId}|${s.env || 'dev'}` : '';
        sel.onchange = () => { const [project, env] = sel.value.split('|'); act('POST', '/ui/secrets/assign', { id: s.id, project: project || null, env }); };
        lab.append(sel); menu.append(lab);
      }
      const del = button(s.pending ? 'Reject the replacement' : 'Delete…', () => {
        if (!confirmRemove(s.name)) return;
        if (showing) hideSecret();
        act('POST', '/ui/secrets/delete', { id: s.id });
      });
      del.className = 'danger-link';
      menu.append(del);
      more.append(sum, menu);
      acts.append(more);
    }
    li.append(tile, main, acts);
    if (showing) { const v = text('code', shownSecret.value); v.className = 'value'; li.append(v); }
    return li;
  }
}

// Paired devices asking for a secret by name (person.secret.request): one click sends it from the vault.
function renderSecretRequests() {
  const box = $('askBox'); const list = $('askList'); const reqs = state?.secretRequests || [];
  box.hidden = !reqs.length; list.replaceChildren();
  for (const r of reqs) {
    const li = document.createElement('li'); li.className = 'secret';
    li.append(text('b', r.name));
    const row = document.createElement('div'); row.className = 'row';
    const answer = async (dismiss) => {
      try {
        const s = await api('POST', '/ui/secret-requests/answer', { id: r.id, ...(dismiss ? { dismiss: true } : {}) });
        render(s);
        if (!dismiss) toast(s.answer?.offered ? `Sent ${r.name} to ${r.peer.name}; its person accepts it there.` : `Sent ${r.name} to ${r.peer.name}. It is in its key store now.`);
      } catch (e) { toast(e.message); }
    };
    if (r.have) { const send = button('Send', () => answer(false)); send.className = 'primary small-btn'; row.append(send); }
    else { const add = button('Add it', () => openSecretModal('add', { name: r.name })); add.className = 'primary small-btn'; row.append(add); }
    const no = button('Dismiss', () => answer(true)); no.className = 'ghost'; row.append(no);
    li.append(row, text('small', `${r.peer.name} asks for it${r.reason ? `: "${r.reason}"` : ''} · ${new Date(r.at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}${r.have ? '' : ' · not on this device yet: add it, then Send'}`));
    list.append(li);
  }
}

function showSecret(r) {
  shownSecret = r;
  clearTimeout(showSecret.timer);
  showSecret.timer = setTimeout(hideSecret, 30_000); // hide again after 30 s
  renderSecrets(true);
}
// The vault lock: an optional passphrase. Locked, nothing can read the values, not even programs running as you.
async function vaultDo(action, passphrase) {
  try {
    render(await api('POST', `/ui/vault/${action}`, passphrase ? { passphrase } : {}));
    toast({ setup: 'Passphrase set. Your secrets are sealed; the vault locks itself after 15 minutes.', unlock: 'Vault unlocked for 15 minutes.', lock: 'Vault locked.', remove: 'Passphrase removed. Secrets are in the key store only.' }[action]);
    renderSecrets(true);
    return true;
  } catch (e) { toast(e.message); return false; }
}
function vaultForm(label, button1, action, hint) {
  const f = document.createElement('form'); f.className = 'vault-form';
  const i = document.createElement('input'); i.type = 'password'; i.autocomplete = action === 'setup' ? 'new-password' : 'current-password'; i.placeholder = label; i.setAttribute('aria-label', label);
  const b = document.createElement('button'); b.className = 'primary small-btn'; b.textContent = button1;
  f.append(i, b);
  f.onsubmit = async e => {
    e.preventDefault();
    const v = i.value; i.value = '';
    if (action === 'setup') {
      if ([...v].length < 8) return toast('Choose at least 8 characters.');
      const again = prompt(t('Type the passphrase again to confirm. If you forget it, the values are lost (send them again from another device).'));
      if (again !== v) return toast('The two passphrases differ. Nothing changed.');
    }
    await vaultDo(action, v);
  };
  if (hint) f.append(text('small', hint));
  return f;
}
function renderVaultLock() {
  const box = $('vaultLock'); const v = state?.vaultLock;
  if (!box || !v) return;
  box.replaceChildren(); box.className = `vault-lock vl-banner ${!v.protected ? 'off' : v.locked ? 'locked' : 'open'}`;
  // A lock icon: open (no passphrase, or unlocked for now) or closed (locked).
  const icon = document.createElement('span'); icon.className = 'vl-icon'; icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = v.protected && v.locked
    ? '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>'
    : '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/><path d="M12 14.5v2.5"/></svg>';
  box.append(icon);
  const head = document.createElement('div'); head.className = 'vl-head';
  if (!v.protected) {
    // Slim by default: one line and a button; the field opens when the person asks for it.
    // 0.16.3: three distinct states (No passphrase set / Unlocked / Locked).
    head.append(text('b', 'No passphrase set'), text('small', 'Values are protected by this computer\'s key store only. Recommended: a passphrase, so no other program can read them while the vault is locked.'));
    const open = button(renderVaultLock.open ? 'Cancel' : 'Set passphrase…', () => { renderVaultLock.open = !renderVaultLock.open; renderVaultLock(); });
    open.className = renderVaultLock.open ? 'ghost small-btn' : 'primary small-btn';
    const line = document.createElement('div'); line.className = 'vl-line'; line.append(head, open);
    box.append(line);
    if (renderVaultLock.open) box.append(vaultForm('New passphrase (8+ characters)', 'Set passphrase', 'setup'));
  } else if (v.locked) {
    head.append(text('b', 'Locked'), text('small', 'Unlock to reveal, copy or send a secret, or to approve a program run. New secrets still arrive.'));
    box.append(head, vaultForm('Passphrase', 'Unlock', 'unlock'));
  } else {
    const until = new Date(v.unlockedUntil).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
    head.append(text('b', `Unlocked until ${until}`), text('small', 'Passphrase set. It locks itself after 15 minutes.'));
    const row = document.createElement('div'); row.className = 'row';
    const lock = button('Lock now', () => vaultDo('lock')); lock.className = 'ghost small-btn';
    const off = button('Remove passphrase…', () => { const p = prompt(t('Type your passphrase to remove it. Secrets then rely on the OS key store only.')); if (p) vaultDo('remove', p); }); off.className = 'linkish';
    row.append(lock, off);
    box.append(head, row);
  }
}
function hideSecret() { shownSecret = null; clearTimeout(showSecret.timer); if (state) renderSecrets(true); }

$('secretsNav').onclick = () => { roomOpen = null; wantSecrets = true; wantPair = false; wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; mobileMain = true; render(state); };
$('secretsBackBtn').onclick = () => { wantSecrets = false; mobileMain = false; hideSecret(); render(state); };

// ---- firewall: requests (intents) from paired devices ---------------------

const FW_LABEL = { pending: 'Waiting for you', blocked: 'Blocked by your firewall', rejected: 'Rejected by you', allowed: 'Allowed by your firewall', approved: 'Approved by you', expired: 'Expired: nobody decided' };
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

function openFirewall() { roomOpen = null; wantFirewall = true; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; wantSecrets = false; wantPair = false; mobileMain = true; render(state); }
$('firewallNav').onclick = openFirewall;

// ---- overview: the dashboard ------------------------------------------------------

function openOverview() { roomOpen = null; wantOverview = true; wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; wantSecrets = false; wantPair = false; mobileMain = true; render(state); }
$('overviewNav').onclick = openOverview;
$('overviewBackBtn').onclick = () => { mobileMain = false; render(state); };
$('ovFirewallLink').onclick = openFirewall;
$('ovReceiveBtn').onclick = () => { roomOpen = null; wantSecrets = true; wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; wantPair = false; mobileMain = true; render(state); openSecretModal('choose'); };
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
    // 0.16.3: identifiers live in the conversation's details; here, what a person needs: name, last activity, online.
    const unread = c?.unread || 0;
    info.append(text('b', peer.name), text('small', c?.last ? `Last message ${shortWhen(c.last.sentAt)}${unread ? ` · ${unread} unread` : ''}` : `Paired ${new Date(peer.pairedAt).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}`));
    const st = text('span', peer.online === true ? (peer.reachedVia === 'relay' ? 'Online via relay' : 'Online') : peer.online === false ? 'Offline' : 'Checking'); st.className = `pill ${peer.online === true ? 'ok' : peer.online === false ? '' : 'muted'}`;
    row.append(av, info);
    if (peer.online === false) { const why = document.createElement('span'); why.className = 'linkish devrow-why'; why.textContent = t('Why?'); why.setAttribute('role', 'button'); why.tabIndex = 0; why.onclick = e => { e.stopPropagation(); explain('peer', peer.id); }; row.append(why); }
    row.append(st);
    row.onclick = () => select(peer.id);
    box.append(row);
  }

  // This device
  const facts = [
    ['Name', d.name], ['Fingerprint', d.fingerprint], ['Key store', KEYSTORE[d.keystore] || d.keystore],
    ['Network', d.address || 'No local address'], ['Tailscale', d.tailscale || 'Not detected'],
    ['Version', `${d.version || '?'} · protocol v${d.protocol} · intents ${d.logos || '?'}`],
  ];
  // 0.16.3: name and version up front; fingerprint, key store, addresses and protocol under Device details.
  const [first, ...rest] = facts;
  const dl = document.createElement('dl'); dl.className = 'facts';
  dl.append(...rest.flatMap(([k, v]) => { const dt = text('dt', k), dd = text('dd', v); if (k === 'Fingerprint') dd.className = 'mono'; return [dt, dd]; }));
  const more = document.createElement('details'); more.className = 'tech'; more.open = !!renderOverview.detailsOpen;
  more.ontoggle = () => { renderOverview.detailsOpen = more.open; };
  more.append(text('summary', 'Device details'), dl);
  const top = [text('dt', first[0]), text('dd', first[1]), text('dt', 'Version'), text('dd', d.version || '?')];
  const wrap = document.createElement('dd'); wrap.className = 'facts-more'; wrap.append(more);
  $('ovMe').replaceChildren(...top, wrap);

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
    [s.peers.length > 0, 'Pair a second computer', 'Pick it on the same network (or use an invite, a code or sound); compare 6 digits and press Allow on both.', openPair],
    [s.conversations.some(c => c.total > 0), 'Connect an agent and send a first message', 'One click for Claude Code or Codex: Agents › Connect.', null],
    [!!fw && fw.intents.some(i => i.all || Object.keys(i.devices).length), 'Set your firewall rules', 'Allow what you trust, keep risky intents blocked.', openFirewall],
    [s.secrets.length > 0, 'Move a key without the chat', 'Secrets → Receive…, then send it from the other computer.', () => $('ovReceiveBtn').click()],
    [!!d.tailscale, 'Reach your devices from anywhere', 'Install Tailscale on both computers.', null],
  ];
  const ul = $('ovChecklist'); ul.replaceChildren();
  // 0.16.3: finished steps fold away; when all are done the panel says so in one line.
  const open = steps.filter(x => !x[0]);
  ul.closest('.ov-start').classList.toggle('all-done', !open.length);
  if (!open.length) { const li = document.createElement('li'); li.className = 'done'; const m = text('span', '✓'); m.className = 'check'; li.append(m, text('b', 'All set up.')); ul.append(li); return; }
  const shown = open;
  const doneCount = steps.length - open.length;
  for (const [done, title, hint, go] of shown) {
    const li = document.createElement('li'); li.className = done ? 'done' : '';
    const mark = text('span', done ? '✓' : ''); mark.className = 'check';
    const t = document.createElement('div'); t.append(text('b', title), text('small', hint));
    li.append(mark, t);
    if (go && !done) { const b = button('Start', go); b.className = 'ghost small-btn'; li.append(b); }
    ul.append(li);
  }
  if (doneCount) { const li = document.createElement('li'); li.className = 'done'; li.append(text('small', `${doneCount} done`)); ul.append(li); }
}
$('firewallBackBtn').onclick = () => { wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; mobileMain = false; render(state); };

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
  // 0.16.3: in plain language first (the catalog's description), the intent name and raw data under Technical details.
  const what = r.intent ? (fw?.intents?.find(i => i.intent === r.intent)?.description || r.intent) : 'A plain message';
  const name = text('b', `${r.peer.name}: ${what.replace(/\.$/, '')}`);
  const risk = text('span', r.risk); risk.className = `fwtag r-${r.risk}`; risk.title = RISK_LABEL[r.risk] || '';
  const st = text('span', FW_LABEL[r.firewall.status]); st.className = `fwtag ${r.firewall.status}`;
  name.append(risk, st);
  const when = new Date(r.receivedAt || r.sentAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const by = r.firewall.decidedAt ? `you, ${new Date(r.firewall.decidedAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}` : `the rule at the time (${r.firewall.rule})`;
  const meta = text('small', `${r.agent ? `Sent by agent ${r.agent.name} (${r.agent.fp}) · ` : r.by === 'agent' ? 'Sent by its agent · ' : ''}${when} · decided by ${by}`);
  const row = document.createElement('div'); row.className = 'row';
  if (r.firewall.status === 'pending') {
    const yes = button('Approve', () => decide(r, true)); yes.className = 'primary small-btn';
    const no = button('Reject', () => decide(r, false)); no.className = 'ghost';
    row.append(yes);
    // Approve, and let the same kind of request from this device through for an hour (never high risk).
    if (r.risk !== 'high') { const hour = button('Approve for 1 hour', () => decide(r, true, 60)); hour.className = 'ghost'; hour.title = `Also allow ${r.intent || 'plain messages'} from ${r.peer.name} for the next hour`; row.append(hour); }
    row.append(no);
  }
  if (r.firewall.allowedUntil) meta.textContent += ` · allowed until ${new Date(r.firewall.allowedUntil).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}`;
  li.append(name, row, meta);
  if (r.intent === 'document.file.share' && r.args?.file) {
    // A shared file: show what it is, and let the person look before approving.
    const f = text('small', `File: ${r.args.name} · ${kb(r.args.size)} · ${r.args.mime} · sha256 ${r.args.sha256.slice(0, 12)}…`);
    const dl = button('Download', () => downloadFile(r.args.file, r.args.name)); dl.className = 'ghost';
    row.append(dl); li.append(f);
  } else if (r.intent) {
    const tech = document.createElement('details'); tech.className = 'tech';
    tech.append(text('summary', 'Technical details'), text('small', `Intent ${r.intent}`));
    const shown = r.args ? JSON.stringify(r.args, null, 2) : '';
    if (shown) { const a = text('pre', shown); a.className = 'args'; tech.append(a); }
    li.append(tech);
  }
  const auto = r.intent === 'document.file.share' ? 'Shared file: ' : `Request: ${r.intent}`;
  if (!r.intent && r.text) { const a = text('pre', r.text.length > 1500 ? `${r.text.slice(0, 1500)}…` : r.text); a.className = 'args'; li.append(a); }
  else if (r.text && !r.text.startsWith(auto)) { const n = text('small', `Note: ${r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text}`); li.append(n); }
  return li;
}

async function decide(r, approve, forMinutes) {
  try {
    render(await api('POST', '/ui/firewall/decide', { id: r.id, approve, ...(forMinutes ? { forMinutes } : {}) }));
    toast(!approve ? 'Rejected. Your agent will not see it.' : forMinutes
      ? `Approved. ${r.intent || 'Plain messages'} from ${r.peer.name} also go straight through for the next hour.`
      : `Approved. Your agent can now see ${r.intent || 'the message'} from ${r.peer.name}.`);
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

  renderModes();
  renderRules();
  renderNotify();
  renderAutoReply();
}

// Modes: the defaults by risk, for all devices or one device. Rules the person set still win.
const MODE_INFO = {
  restricted: ['Restricted', 'Everything waits for you, even questions and plain messages. Changes and high-risk requests are blocked.'],
  standard: ['Standard', 'Questions, status and messages go through. Reads and changes wait for you. High risk is blocked.'],
  auto: ['Auto', 'For your own trusted devices: questions, messages and reads go through. Changes wait for you. High risk is still blocked.'],
};
function renderModes() {
  const box = $('fwModes'); const m = fw.modes;
  if (!box || !m) return;
  box.replaceChildren();
  const cur = fwScope === '*' ? m.all : (m.devices[fwScope] || 'default');
  const who = fwScope === '*' ? 'all devices' : (fw.peers.find(p => p.id === fwScope)?.name || 'this device');
  const seg = document.createElement('div'); seg.className = 'mode-cards'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', `Mode for ${who}`);
  const opts = fwScope === '*' ? Object.keys(MODE_INFO) : ['default', ...Object.keys(MODE_INFO)];
  const SHORT = { restricted: 'Everything waits for you', standard: 'Questions go through, changes wait', auto: 'Trusted devices: more goes through', default: 'Follow the mode for all devices' };
  const ICON = {
    restricted: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
    standard: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
    auto: '<svg viewBox="0 0 24 24"><path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z"/></svg>',
    default: '<svg viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  };
  for (const k of opts) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === cur));
    b.className = `mode-card m-${k}${k === cur ? ' on' : ''}`;
    const ico = document.createElement('span'); ico.className = 'mc-icon'; ico.setAttribute('aria-hidden', 'true'); ico.innerHTML = ICON[k];
    const name = text('b', k === 'default' ? `Same as all (${MODE_INFO[m.all][0]})` : MODE_INFO[k][0]);
    const sub = text('small', SHORT[k]);
    const tick = document.createElement('span'); tick.className = 'mc-tick'; tick.setAttribute('aria-hidden', 'true'); tick.textContent = '✓';
    b.append(ico, name, sub, tick);
    b.onclick = async () => {
      if (k === cur) return;
      try { await api('POST', '/ui/firewall/mode', { scope: fwScope, mode: k }); toast(`${k === 'default' ? 'Follows the mode for all devices' : `${MODE_INFO[k][0]} mode`} for ${who}.`); loadFirewall(true); }
      catch (e) { toast(e.message); }
    };
    seg.append(b);
  }
  const eff = cur === 'default' ? m.all : cur;
  const hint = text('p', `${MODE_INFO[eff][1]} Rules you set below still win. Applies to ${who}; change "Rules for" to set one device.`); hint.className = 'hint small';
  box.append(seg, hint);
  const temp = fwScope === '*' ? Object.entries(m.temporary) : Object.entries(m.temporary).filter(([p]) => p === fwScope);
  if (temp.length) {
    const names = temp.flatMap(([p, x]) => Object.entries(x).map(([k, u]) => `${k === '@text' ? 'plain messages' : k} from ${fw.peers.find(q => q.id === p)?.name || p} until ${new Date(u).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}`));
    const t = text('p', `Allowed for a while: ${names.join('; ')}. `); t.className = 'hint small';
    const end = button('End now', async () => { try { await api('POST', '/ui/firewall/temporary/clear', fwScope === '*' ? {} : { peer: fwScope }); loadFirewall(true); } catch (e) { toast(e.message); } });
    end.className = 'linkish'; t.append(end); box.append(t);
  }
}

// Notifications and waking agents: only this page changes them; agent tools cannot.
async function setNotify(body, done) {
  try { await api('POST', '/ui/notify', body); if (done) toast(done); loadFirewall(true); }
  catch (e) { toast(e.message); loadFirewall(true); }
}
function renderNotify() {
  const box = $('notifyBox'); const n = fw.notify;
  if (!box || !n) return;
  box.replaceChildren();
  const row = (title, hint, ...controls) => {
    const r = document.createElement('div'); r.className = 'ar-row';
    const t = document.createElement('div'); t.className = 'ar-label'; t.append(text('b', title));
    if (hint) t.append(text('small', hint));
    const c = document.createElement('div'); c.className = 'ar-control'; c.append(...controls);
    r.append(t, c); return r;
  };
  const sw = (checked, label) => {
    const l = document.createElement('label'); l.className = 'switch';
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = checked; i.setAttribute('role', 'switch'); i.setAttribute('aria-label', label);
    l.append(i, document.createElement('span')); return [l, i];
  };
  const g = document.createElement('div'); g.className = 'ar-group';
  const [dl, desk] = sw(n.desktop, 'Desktop notifications');
  desk.onchange = () => setNotify({ desktop: desk.checked }, desk.checked ? 'Desktop notifications on.' : 'Desktop notifications off.');
  const testBtn = button('Test', async () => { try { await api('POST', '/ui/notify/test', {}); } catch (e) { toast(e.message); } });
  testBtn.className = 'ghost small';
  g.append(row('Desktop notifications', 'New messages, room posts and requests waiting for you. Shows the device, never the text.', testBtn, dl));
  const [wl, wake] = sw(n.wakeAgents, 'Wake my agents');
  wake.onchange = () => setNotify({ wakeAgents: wake.checked }, wake.checked ? 'Agents are woken when something arrives.' : 'Agents are no longer woken; they see new items at their next step.');
  g.append(row('Wake my agents', 'An idle Claude Code session is woken when a message or room post arrives, so it can read it. Off: it sees new items at its next step.', wl));
  const per = document.createElement('input'); per.type = 'number'; per.min = '1'; per.max = '60'; per.value = n.wakesPerHour; per.setAttribute('aria-label', 'Wake-ups per session per hour');
  per.onchange = () => setNotify({ wakesPerHour: Number(per.value) });
  g.append(row('Limit', 'Wake-ups per session per hour (stops two agents from waking each other all day)', per));
  box.append(g);
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
    const when = new Date(e.at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
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
  $('infoStatus').textContent = peer.online === true ? (peer.reachedVia === 'relay' ? 'Online now, via relay' : 'Online now') : peer.online === false ? 'Offline' : 'Checking…';
  $('infoFp').textContent = peer.fingerprint;
  $('infoAddr').textContent = peer.address || 'Unknown';
  $('infoPaired').textContent = `${new Date(peer.pairedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })} · by ${peer.via}`;
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
      // The service shows desktop notifications itself when they are on; the browser one would be a duplicate.
      if (state.desktopNotify && document.visibilityState !== 'visible') continue;
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
  b.textContent = on ? 'Browser notifications: on' : 'Browser notifications: off';
  b.title = on ? 'Click to turn browser notifications off.' : 'Notify me in this browser about new messages while the page is in the background.';
}

$('notifyBtn').onclick = async () => {
  if (!('Notification' in window)) return toast('This browser cannot show notifications.');
  if (notifyOn) { notifyOn = false; LS.set('notify', false); syncNotifyButton(); return toast('Notifications off.'); }
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm !== 'granted') return toast('Notifications are blocked for this page in the browser settings.');
  notifyOn = true; LS.set('notify', true); syncNotifyButton(); toast('You will be notified about new messages while this page is in the background.');
};

// ---- shared project rooms: one thread for a project across several paired devices ----------
let roomOpen = null, roomMsgs = [], roomKey = '', roomJustOpened = false, showArchived = false;
const roomById = id => (state?.rooms || []).find(r => r.id === id);
const roomUnread = r => r.incoming.filter(x => x.at > (lastSeen[`room:${r.id}`] || '')).length;

function renderRooms() {
  const nav = $('roomList'); nav.replaceChildren();
  // Pinned first, then by last activity; archived rooms hide behind a toggle (a new post brings one back).
  const all = [...(state.rooms || [])].sort((a, b) => (!!b.pinned - !!a.pinned) || (b.last?.sentAt || b.createdAt).localeCompare(a.last?.sentAt || a.createdAt));
  const archived = all.filter(r => r.archived);
  const rooms = showArchived ? all : all.filter(r => !r.archived || r.id === roomOpen);
  if (!rooms.length) {
    const none = document.createElement('p'); none.className = 'none';
    none.textContent = state.peers.length > 1 ? 'No rooms yet. A room is one thread for a project across several devices.' : 'Pair two or more devices to make a room.';
    nav.append(none); return;
  }
  for (const r of rooms) {
    const unread = r.muted ? 0 : roomUnread(r), last = r.last;
    const b = document.createElement('button');
    b.className = `convo${unread ? ' unread' : ''}`;
    b.setAttribute('aria-current', String(r.id === roomOpen && app.dataset.main === 'room'));
    const av = document.createElement('span'); av.className = 'avatar room-av'; av.textContent = '#';
    const name = document.createElement('b'); name.textContent = r.name; name.setAttribute('translate', 'no');
    const when = document.createElement('time'); when.textContent = last ? shortWhen(last.sentAt) : '';
    const prev = document.createElement('span'); prev.className = 'preview';
    prev.textContent = last ? `${last.direction === 'sent' ? (last.by === 'agent' ? `${last.agent?.name || 'Your agent'}: ` : 'You: ') : `${last.peer.name}: `}${flat(last.text)}` : r.members.length ? `${r.members.length + 1} devices in this room` : 'This computer only';
    if (r.pinned) { const pi = text('span', ' · pinned'); pi.className = 'muted-tag'; name.append(pi); }
    if (r.muted) { const mu = text('span', ' · muted'); mu.className = 'muted-tag'; name.append(mu); }
    b.append(av, name, when, prev);
    if (r.mentions) { const at = document.createElement('span'); at.className = 'badge mention'; at.textContent = '@'; at.title = 'Mentions you'; b.append(at); }
    else if (unread) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = unread > 99 ? '99+' : unread; b.append(badge); }
    b.onclick = () => openRoom(r.id);
    nav.append(b);
  }
  if (archived.length) {
    const tg = button(showArchived ? 'Hide archived rooms' : `Archived (${archived.length})`, () => { showArchived = !showArchived; renderRooms(); });
    tg.className = 'linkish archived-toggle'; nav.append(tg);
  }
}

// ---- Agents page (0.15): the agent apps on this computer and their identities ----
$('agentsNav').onclick = () => { roomOpen = null; wantAgents = true; wantRooms = false; wantProjects = false; wantSecrets = false; wantFirewall = false; wantActivity = false; wantPair = false; mobileMain = true; render(state); refreshClaude(); refreshCodex(); };
$('agentsBackBtn').onclick = () => { wantAgents = false; mobileMain = false; render(state); };
let agentSetup = null;
function renderAgentsPage() {
  renderGrants();
  // Each app card says when this app last used VINAC Link (its identity's "last seen").
  // 0.16.3: and which identity it acts as, and the projects whose rooms it may post in.
  const projects = state.projects || [];
  const mayPostIn = id => projects.filter(p => !(p.agents || []).length || (p.agents || []).includes(id)).map(p => p.name);
  for (const [box, re] of [['claudeBox', /claude/i], ['codexBox', /codex/i], ['openclawBox', /openclaw/i]]) {
    if (!$(box)) continue;
    const a = (state.agents || []).find(x => re.test(x.name));
    let seen = $(box).querySelector('.app-seen');
    if (!seen) { seen = document.createElement('p'); seen.className = 'app-seen'; $(box).append(seen); }
    const when = a?.lastSeenAt ? `Last used VINAC Link: ${new Date(a.lastSeenAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}` : a ? 'Its identity is ready; not used yet (start a new session in the app).' : '';
    const id = a ? a.id : 'default';
    const where = projects.length ? (mayPostIn(id).length ? `Can post in: ${mayPostIn(id).join(', ')}.` : 'Can\'t post in any project room (not ticked in Who may post).') : '';
    seen.textContent = [a ? `Acts as "${a.name}" (${a.fingerprint}).` : 'Acts as this computer\'s default agent.', when, where].filter(Boolean).join(' ');
  }
  if (!agentSetup) { api('GET', '/ui/setup').then(s => { agentSetup = s; drawAgentOthers(); }).catch(() => {}); return; }
  if (!$('agentOthers').childElementCount) drawAgentOthers();
}
function drawAgentOthers() {
  const s = agentSetup; if (!s) return;
  const copyBox = (label, value) => {
    const wrap = document.createElement('div'); wrap.className = 'setup-snip';
    const head = document.createElement('div'); head.className = 'snip-head'; head.append(text('small', label));
    const c = button('Copy', async () => { try { await navigator.clipboard.writeText(value); toast('Copied.'); } catch { toast('Could not copy.'); } }); c.className = 'ghost small-btn';
    head.append(c);
    const pre = document.createElement('pre'); pre.textContent = value;
    wrap.append(head, pre); return wrap;
  };
  const card = (app, name, what, ...kids) => { const d = document.createElement('div'); d.className = 'other-app'; const h = document.createElement('div'); h.className = 'app-card-head'; h.append(appMark(app, name), text('b', name)); d.append(h, Object.assign(text('p', what), { className: 'fw-note' }), ...kids); return d; };
  $('agentOthers').replaceChildren(
    card('cursor', 'Cursor, Continue, LibreChat and other MCP apps', 'Add an MCP server (stdio) in the app\'s settings with this JSON.', copyBox('MCP settings (JSON)', s.mcpJson)),
    card('lmstudio', 'LM Studio and small local models', 'Program tab › Install › Edit mcp.json, and add this. "--simple" gives small models just send, inbox and peers.', copyBox('mcp.json', s.mcpJsonSimple)),
    card('goose', 'Goose', 'goose configure › Add Extension › Command-line Extension, named vinac, with this command.', copyBox('Command', s.commandLineSimple)),
    card('openclaw', 'OpenClaw', 'Two small plugins (node host and gateway). The guide is in the VINAC Link folder. Once they are in, give OpenClaw its own identity in its card above.', copyBox('Guide', s.openclaw)),
    card(null, 'Any other app or a terminal', 'The agent tools over stdio. To act as a named agent, add VINAC_AGENT_TOKEN from "Add agent" above to its environment.', copyBox('Command', s.commandLine)),
  );
}

// ---- Rooms page (0.15): every room in one list, with filters and quick pin / mute / archive ----
let roomsFilter = 'active', roomsPageKey = '';
$('roomsNav').onclick = () => { roomOpen = null; wantAgents = false; wantRooms = true; wantProjects = false; wantSecrets = false; wantFirewall = false; wantActivity = false; wantPair = false; mobileMain = true; render(state); };
$('roomsBackBtn').onclick = () => { wantRooms = false; wantAgents = false; mobileMain = false; render(state); };
$('roomsNewBtn').onclick = () => $('newRoomBtn').click();
$('roomsFilter').addEventListener('input', () => renderRoomsPage(true));
for (const b of document.querySelectorAll('[data-rf]')) b.onclick = () => {
  roomsFilter = b.dataset.rf;
  for (const x of document.querySelectorAll('[data-rf]')) x.setAttribute('aria-pressed', String(x === b));
  renderRoomsPage(true);
};
function renderRoomsPage(force = false) {
  const q = $('roomsFilter').value.trim().toLowerCase();
  const key = JSON.stringify([state.rooms || [], roomsFilter, q, state.projects?.length]);
  if (!force && key === roomsPageKey) return;
  roomsPageKey = key;
  const all = [...(state.rooms || [])].sort((a, b) => (!!b.pinned - !!a.pinned) || (b.last?.sentAt || b.createdAt).localeCompare(a.last?.sentAt || a.createdAt));
  const shown = all.filter(r => (roomsFilter === 'archived' ? r.archived : roomsFilter === 'pinned' ? r.pinned && !r.archived : !r.archived))
    .filter(r => !q || r.name.toLowerCase().includes(q) || (r.project || '').toLowerCase().includes(q) || r.members.some(m => m.name.toLowerCase().includes(q)));
  $('roomsEmpty').hidden = shown.length > 0;
  $('roomsEmpty').textContent = q ? 'No room matches.' : roomsFilter === 'archived' ? 'No archived rooms.' : roomsFilter === 'pinned' ? 'No pinned rooms. Pin the ones you use most.'
    : 'No rooms yet. Make one with other devices (New room), or make a project: its room is on this computer for its agents.';
  $('roomsGrid').replaceChildren(...shown.map(r => {
    const li = document.createElement('li'); li.className = `room-card${r.archived ? ' archived' : ''}`;
    const open = document.createElement('button'); open.type = 'button'; open.className = 'room-open'; open.onclick = () => openRoom(r.id);
    const top = document.createElement('div'); top.className = 'rc-top';
    const name = document.createElement('b'); name.textContent = `# ${r.name}`; name.setAttribute('translate', 'no');
    top.append(name);
    const unread = r.muted ? 0 : roomUnread(r);
    if (r.mentions) { const at = text('span', '@'); at.className = 'badge mention'; top.append(at); }
    else if (unread) { const n = text('span', unread > 99 ? '99+' : String(unread)); n.className = 'badge'; top.append(n); }
    const tags = document.createElement('div'); tags.className = 'rc-tags';
    if (r.project) { const p = text('span', r.project); p.className = 'rc-tag proj'; tags.append(p); }
    const where = text('span', r.members.length ? `You, ${r.members.map(m => m.name).join(', ')}` : 'This computer only'); where.className = 'rc-tag'; tags.append(where);
    if (r.pinned) { const x = text('span', 'pinned'); x.className = 'rc-tag'; tags.append(x); }
    if (r.muted) { const x = text('span', 'muted'); x.className = 'rc-tag'; tags.append(x); }
    if (r.policy?.paused) { const x = text('span', 'agents paused'); x.className = 'rc-tag warn'; tags.append(x); }
    const last = r.last;
    const prev = text('p', last ? `${last.direction === 'sent' ? (last.by === 'agent' ? `${last.agent?.name || 'Your agent'}: ` : 'You: ') : `${last.peer.name}: `}${flat(last.text)}` : 'No posts yet.');
    prev.className = 'rc-last';
    const when = text('small', last ? shortWhen(last.sentAt) : '');
    open.append(top, tags, prev, when);
    const acts = document.createElement('div'); acts.className = 'rc-acts';
    const pref = (k, on, off) => { const b = button(r[k] ? off : on, () => act('POST', '/ui/rooms/prefs', { id: r.id, [k]: !r[k] })); b.className = 'ghost small-btn'; return b; };
    acts.append(pref('pinned', 'Pin', 'Unpin'), pref('muted', 'Mute', 'Unmute'), pref('archived', 'Archive', 'Unarchive'));
    li.append(open, acts); return li;
  }));
}

function openRoom(id) {
  if (id !== roomOpen) { roomMsgs = []; roomKey = ''; }
  roomOpen = id; wantPair = false; wantSecrets = false; wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; wantOverview = false; mobileMain = true; roomJustOpened = true;
  render(state);
  if (!isNarrow()) $('roomText').focus();
}

function renderRoomHead() {
  const r = roomById(roomOpen); if (!r) return;
  $('roomName').textContent = r.name;
  $('roomMembers').textContent = r.members.length ? `You, ${r.members.map(m => m.name).join(', ')}` : 'You and the agents on this computer';
  const hint = document.querySelector('section[data-main="room"] .composer-hint');
  if (hint) {
    // 0.16.3: who here may post (agents on this computer) and who receives a post (other devices), apart.
    const proj = (state.projects || []).find(p => p.id === r.projectId);
    const ids = proj?.agents || [];
    const names = ids.map(id => (id === 'default' ? t('the default agent') : (state.agents || []).find(a => a.id === id)?.name)).filter(Boolean);
    const here = r.policy?.paused ? t('Agents here: paused.') : ids.length ? `${t('Agents here that may post:')} ${names.join(', ')}.` : t('Agents here: every agent on this computer may post.');
    const there = r.members.length ? `${t('Each post goes to:')} ${r.members.map(m => m.name).join(', ')} ${t('(encrypted, through each one\'s firewall; no server keeps it).')}` : t('No other device: this room stays on this computer.');
    hint.textContent = `${here} ${there}`;
  }
  // Room rules on this computer: pause agents, card types, limits. Only ever stricter.
  const pol = r.policy || {};
  const pb = $('roomPauseBtn');
  pb.textContent = pol.paused ? 'Resume agents' : 'Pause agents';
  pb.classList.toggle('on', !!pol.paused);
  pb.onclick = () => act('POST', '/ui/rooms/policy', { id: r.id, paused: !pol.paused });
  $('roomRulesBtn').onclick = () => { $('roomRules').hidden = !$('roomRules').hidden; renderRoomRules(); };
  if (pol.paused) { banner.hidden = false; banner.textContent = 'Agents are paused in this room on this computer: your agents can\'t post here, and other devices\' agent posts don\'t reach your agent.'; }
  renderRoomRules();
  // The room's project (on this computer): key requests posted here name it.
  const ps = $('roomProject'); const projects = state.projects || [];
  ps.hidden = !projects.length;
  if (projects.length) {
    ps.replaceChildren();
    const o = (v, l) => { const x = document.createElement('option'); x.value = v; x.textContent = l; return x; };
    ps.append(o('', 'No project'), ...projects.map(p => o(p.id, p.name)));
    ps.value = r.projectId || '';
    ps.onchange = () => act('POST', '/ui/rooms/project', { id: r.id, project: ps.value || null });
  }
  const banner = $('roomBanner');
  const missing = r.notPairedHere?.length || 0;
  banner.hidden = !missing;
  banner.textContent = missing ? `${missing} member${missing > 1 ? 's' : ''} of this room ${missing > 1 ? 'are' : 'is'} not paired with this computer: your posts don't reach ${missing > 1 ? 'them' : 'it'}.` : '';
}

// "Why?": an explanation built from this computer's own data, with buttons for the steps the person takes.
async function explain(topic, ref) {
  try {
    const x = await api('GET', `/ui/explain?topic=${encodeURIComponent(topic)}&ref=${encodeURIComponent(ref)}`);
    $('explainTitle').textContent = x.title || 'Why?';
    const body = $('explainBody'); body.replaceChildren();
    const ul = document.createElement('ul'); ul.className = 'explain-facts';
    for (const f of x.facts || []) ul.append(text('li', f));
    body.append(ul);
    if ((x.steps || []).length) {
      body.append(text('b', 'What you can do'));
      const ol = document.createElement('ol'); ol.className = 'explain-steps';
      const ACT = {
        openFirewall: () => { close(); openFirewall(); }, openSecrets: () => { close(); $('secretsNav').click(); },
        openAccount: () => { close(); $('accountNav').click(); }, ping: () => { act('POST', '/ui/ping'); toast('Checking…'); },
        cancelQueued: s => { act('POST', '/ui/outbox/cancel', { id: s.id }); close(); },
      };
      for (const s of x.steps) {
        const li = text('li', s.text);
        if (s.action && ACT[s.action]) { const b = button({ openFirewall: 'Open Firewall', openSecrets: 'Open Secrets', openAccount: 'Open Account', ping: 'Check now', cancelQueued: 'Cancel it' }[s.action], () => ACT[s.action](s)); b.className = 'ghost small'; li.append(' ', b); }
        ol.append(li);
      }
      body.append(ol);
    }
    $('explainModal').hidden = false;
  } catch (e) { toast(e.message); }
  function close() { $('explainModal').hidden = true; }
}
$('explainClose').onclick = () => { $('explainModal').hidden = true; };
$('explainModal').addEventListener('click', e => { if (e.target === $('explainModal')) $('explainModal').hidden = true; });

// "Needs me": everything waiting for the person, across rooms and conversations, with the action at hand.
const t_ = s => t(s); // `t` is shadowed inside fillNeeds
const NEED_LABEL = { browserAdd: 'Add a browser', pairOffer: 'Pairing request', request: 'Held request', decision: 'Decision', key: 'Key request', task: 'Open task', keyOffer: 'Key to accept', run: 'Program asks', keyAsk: 'Key asked for', mention: 'Mention' };
// It lives in two places: the panel at the top of the Overview, and the bell (count + dropdown).
function renderNeeds() {
  const needs = state.needsMe || [];
  const n = needs.length;
  $('needsCount').hidden = !n; $('needsCount').textContent = n > 99 ? '99+' : String(n);
  $('bellBtn').classList.toggle('has', !!n);
  $('bellBtn').title = n ? `Needs me: ${n} waiting` : 'Needs me: all clear';
  $('needsPanel').hidden = false;
  $('needsPanel').classList.toggle('has', !!n);
  $('needsSub').textContent = n ? `${n} waiting` : 'All clear';
  $('needsPopSub').textContent = n ? `${n} waiting` : 'All clear';
  $('needsPopAll').hidden = !(state.peers || []).length;
  const key = JSON.stringify([needs, (state.peers || []).length]);
  if (key === renderNeeds.key) return;
  renderNeeds.key = key;
  fillNeeds($('needsList'), needs, 30);
  fillNeeds($('needsPopList'), needs, 8);
}
function fillNeeds(list, needs, max) {
  if (!list) return;
  list.replaceChildren();
  if (!needs.length) {
    const li = document.createElement('li'); li.className = 'need-empty';
    li.append(text('b', 'Nothing needs you right now.'), text('span', 'Requests your firewall holds, decisions, key requests, open tasks and @mentions show up here, with the button to act on them.'));
    list.append(li);
  }
  for (const n of needs.slice(0, max)) {
    const li = document.createElement('li'); li.className = `need need-${n.kind}`;
    const t = document.createElement('div');
    t.append(text('small', `${NEED_LABEL[n.kind] || n.kind}${n.room ? ` · # ${n.room}` : n.with ? ` · ${n.with}` : ''}`), text('b', n.title));
    const acts = document.createElement('div'); acts.className = 'card-acts';
    const go = () => { closeNeedsPop(); if (n.roomId) openRoom(n.roomId); else if (n.peerId) { wantOverview = false; select(n.peerId); } };
    if (n.kind === 'decision') for (const o of n.options || []) acts.append(button(o, () => act('POST', '/ui/card', { room: n.roomId, to: n.peerId, cardUpdate: { card: n.card, action: 'answer', option: o } })));
    else if (n.kind === 'request' || n.kind === 'run' || n.kind === 'keyAsk') acts.append(button('Open', () => { closeNeedsPop(); if (n.kind === 'request') openFirewall(); else $('secretsNav').click(); }));
    else if (n.kind === 'keyOffer') acts.append(button('Open', () => { closeNeedsPop(); $('secretsNav').click(); }));
    else if (n.kind === 'pairOffer') acts.append(button('Accept', () => acceptTeamPair(n.from)), button('Ignore', () => act('POST', '/ui/team/pair/ignore', { from: n.from })));
    else if (n.kind === 'browserAdd') { t.append(text('span', `${t_('Does it show')} ${n.code.slice(0, 3)} ${n.code.slice(3)}?`)); acts.append(button('Same code: Allow', allowBrowser), button('Different: cancel', () => act('POST', '/ui/web/confirm', { allow: false }))); }
    else if (n.kind === 'key' && n.local) acts.append(button('Add key', () => { closeNeedsPop(); $('secretsNav').click(); }), button('Open', go));
    else if (n.kind === 'key') acts.append(button('Send', async () => { if (!confirm(`Send this key to ${n.from}? It goes sealed to that device only.`)) return; try { render(await api('POST', '/ui/card/send-key', { card: n.card })); toast('Sent.'); } catch (e) { toast(e.message); } }), button('Open', go));
    else if (n.kind === 'task') acts.append(button('Claim', () => act('POST', '/ui/card', { room: n.roomId, to: n.peerId, cardUpdate: { card: n.card, action: 'claim' } })), button('Open', go));
    else acts.append(button('Open', go));
    for (const b of acts.children) b.className = 'ghost small';
    li.append(t, acts); list.append(li);
  }
  if (needs.length > max) { const more = text('li', `and ${needs.length - max} more on the Overview`); more.className = 'need-more'; list.append(more); }
}
function closeNeedsPop() { $('needsPop').hidden = true; $('bellBtn').setAttribute('aria-expanded', 'false'); }
$('bellBtn').onclick = e => {
  e.stopPropagation();
  const open = $('needsPop').hidden;
  $('needsPop').hidden = !open; $('bellBtn').setAttribute('aria-expanded', String(open));
  if (open) syncNotifyButton();
};
$('needsPop').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => { if (!$('needsPop').hidden) closeNeedsPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('needsPop').hidden) { closeNeedsPop(); $('bellBtn').focus(); } });
$('needsPopAll').onclick = () => {
  closeNeedsPop(); openOverview();
  setTimeout(() => { const p = $('needsPanel'); p.scrollIntoView({ block: 'start', behavior: 'smooth' }); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }, 100);
};

function renderRoomRules() {
  const box = $('roomRules'); const r = roomById(roomOpen);
  if (!r || box.hidden) return;
  const pol = r.policy || {};
  // This room on this computer: pin, mute (no badge or notification unless it mentions you), archive.
  const prefs = document.createElement('div'); prefs.className = 'rules-types';
  for (const [k, label] of [['pinned', 'Pinned'], ['muted', 'Muted'], ['archived', 'Archived']]) {
    const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!r[k];
    i.onchange = () => act('POST', '/ui/rooms/prefs', { id: r.id, [k]: i.checked });
    l.append(i, text('span', label)); prefs.append(l);
  }
  box.replaceChildren(text('b', 'This room'), prefs, text('b', 'Room rules for agents on this computer'));
  const types = document.createElement('div'); types.className = 'rules-types';
  types.append(text('span', 'Agents may post:'));
  for (const t of ['task', 'status', 'decision', 'key', 'file', 'link']) {
    const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = (pol.agentCards || []).includes(t);
    i.onchange = () => { const cur = new Set(pol.agentCards || []); i.checked ? cur.add(t) : cur.delete(t); act('POST', '/ui/rooms/policy', { id: r.id, agentCards: [...cur] }); };
    l.append(i, text('span', CARD_LABEL[t])); types.append(l);
  }
  const num = (label, key, min, max) => {
    const l = document.createElement('label'); l.className = 'rules-num';
    const i = document.createElement('input'); i.type = 'number'; i.min = String(min); i.max = String(max); i.value = pol[key];
    i.onchange = () => act('POST', '/ui/rooms/policy', { id: r.id, [key]: Number(i.value) });
    l.append(text('span', label), i); return l;
  };
  const hint = text('small', 'Plain messages are always allowed. Limits stop agents from talking to each other without end; a person\'s post resets the count.');
  box.append(types, num('Agent posts per minute', 'postsPerMinute', 1, 60), num('Agent posts in a row before a person must post', 'maxAgentRun', 2, 200), hint);
}

async function loadRoom() {
  const r = roomById(roomOpen); if (!r) return;
  const key = `${r.id}:${r.last?.id}:${r.incoming.length}`;
  if (key === roomKey) return;
  roomKey = key;
  try {
    const { messages, cards } = await api('GET', `/ui/rooms/messages?id=${encodeURIComponent(r.id)}`);
    if (roomOpen !== r.id) return;
    roomMsgs = messages; cardMap = new Map((cards || []).map(c => [c.id, c])); renderRoomThread();
  } catch (e) { roomKey = ''; toast(e.message); }
}

function renderRoomThread() {
  const box = $('roomThread');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.replaceChildren();
  const r = roomById(roomOpen);
  if (!roomMsgs.length) box.append(emptyEl('div', 'bubbles', 'Start the room', `Write the first post below, or ask an agent to post with vinac_send and room "${r?.name || ''}".`));
  let prev = null;
  for (const m of roomMsgs) {
    if (!prev || !sameDay(prev.sentAt, m.sentAt)) { const day = document.createElement('div'); day.className = 'day'; day.textContent = dayLabel(m.sentAt); box.append(day); prev = null; }
    const cont = prev && !prev.args?.cardUpdate && prev.direction === m.direction && prev.peer.id === m.peer.id && prev.by === m.by && (prev.agent?.name || '') === (m.agent?.name || '') && new Date(m.sentAt) - new Date(prev.sentAt) < GROUP_MS;
    box.append(messageEl(m, cont, '', { room: true }));
    prev = m;
  }
  if (roomJustOpened || atBottom) box.scrollTop = box.scrollHeight;
  roomJustOpened = false;
}

function markRoomSeen() {
  const r = roomById(roomOpen);
  if (!r || document.visibilityState !== 'visible' || (isNarrow() && !mobileMain)) return;
  const latest = r.incoming.at(-1)?.at;
  if (latest && latest > (lastSeen[`room:${r.id}`] || '')) { lastSeen[`room:${r.id}`] = latest; LS.set('lastSeen', lastSeen); renderRooms(); }
}

const roomText = $('roomText');
roomText.addEventListener('input', () => { roomText.style.height = 'auto'; roomText.style.height = `${Math.min(180, roomText.scrollHeight + 2)}px`; });
roomText.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('roomComposer').requestSubmit(); } });
$('roomComposer').onsubmit = async e => {
  e.preventDefault();
  const body = roomText.value.trim(), r = roomById(roomOpen);
  if (!body || !r) return;
  // Post as a card: the first line is the title; for a decision, lines starting with "-" are the options.
  const kind = $('roomKind').value;
  let card = null;
  if (kind !== 'post') {
    const lines = body.split('\n').map(s => s.trim()).filter(Boolean);
    const options = lines.slice(1).filter(s => s.startsWith('-')).map(s => s.replace(/^-\s*/, ''));
    const rest = lines.slice(1).filter(s => !s.startsWith('-')).join('\n');
    if (kind === 'decision' && (options.length < 2 || options.length > 4)) return toast('A decision: the question on the first line, then 2 to 4 options, each on a line starting with "-".');
    card = { type: kind, title: lines[0], ...(rest ? { body: rest } : {}), ...(kind === 'decision' ? { options } : {}), ...(kind === 'status' ? { level: 'info' } : {}) };
  }
  roomText.value = ''; roomText.style.height = 'auto'; $('roomKind').value = 'post';
  try {
    const s = await api('POST', '/ui/send', card ? { room: r.id, card } : { room: r.id, text: body });
    const res = s.sent;
    const failed = res.results.filter(x => !x.sent && !x.queued);
    if (failed.length) toast(`Not delivered to ${failed.map(x => x.to).join(', ')}.`);
    roomJustOpened = true; roomKey = ''; render(s);
  } catch (err) { roomText.value = body; toast(err.message); }
};
$('roomBackBtn').onclick = () => { mobileMain = false; render(state); };
$('roomLeaveBtn').onclick = async () => {
  const r = roomById(roomOpen); if (!r) return;
  if (!confirm(`Leave "${r.name}" on this computer? Its posts stay in your history; other devices aren't told.`)) return;
  try { const s = await api('POST', '/ui/rooms/leave', { id: r.id }); roomOpen = null; render(s); toast('You left the room.'); } catch (e) { toast(e.message); }
};

// New room: a name and the paired devices in it (only the person makes rooms).
const roomModal = $('roomModal');
$('newRoomBtn').onclick = () => {
  const peers = (state?.peers || []).filter(p => p.canMessage);
  if (!peers.length) { toast('Pair a device first.'); return; }
  $('roomPick').replaceChildren(...peers.map(p => {
    const l = document.createElement('label'); l.className = 'room-pick-item';
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = p.id; c.checked = peers.length <= 3;
    const n = document.createElement('span'); n.textContent = p.name; n.setAttribute('translate', 'no');
    l.append(c, n); return l;
  }));
  $('roomNameInput').value = '';
  roomModal.hidden = false; $('roomNameInput').focus();
};
$('roomModalClose').onclick = () => { roomModal.hidden = true; };
roomModal.addEventListener('click', e => { if (e.target === roomModal) roomModal.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !roomModal.hidden) roomModal.hidden = true; });
$('roomForm').onsubmit = async e => {
  e.preventDefault();
  const members = [...$('roomPick').querySelectorAll('input:checked')].map(c => c.value);
  if (!members.length) { toast('Pick at least one device.'); return; }
  try {
    const s = await api('POST', '/ui/rooms', { name: $('roomNameInput').value, members });
    roomModal.hidden = true; state = s; toast(`Room ${s.room.name} created.`); openRoom(s.room.id);
  } catch (err) { toast(err.message); }
};

// ---- conversation actions --------------------------------------------------

function select(id) {
  if (id !== selected) { thread = []; threadKey = ''; replyTo = null; search = ''; $('threadSearch').value = ''; $('searchBar').hidden = true; $('replyBox').hidden = true; }
  selected = id; LS.set('selected', id); roomOpen = null;
  wantPair = false; wantSecrets = false; wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; wantOverview = false; hideSecret(); mobileMain = true; justOpened = true;
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

// Post a file in the open room: stored once here; members get it when they press Get.
async function postRoomFile(f) {
  const r = roomById(roomOpen);
  if (!f || !r) return;
  if (f.size > 64 * 1024 * 1024) { toast('Files are limited to 64 MB.'); return; }
  toast(`Posting ${f.name}…`);
  try {
    const qs = new URLSearchParams({ room: r.id, name: f.name, ...(f.type ? { mime: f.type } : {}) });
    const res = await fetch(`/ui/send-file?${qs}`, { method: 'POST', headers: { 'x-ui-token': TOKEN, 'content-type': 'application/octet-stream' }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    roomJustOpened = true; roomKey = ''; render(data); toast(`${f.name} posted in ${r.name}.`);
  } catch (e) { toast(e.message); }
}
$('roomAttachBtn').onclick = () => $('roomAttachInput').click();
$('roomAttachInput').onchange = () => { const f = $('roomAttachInput').files[0]; $('roomAttachInput').value = ''; postRoomFile(f); };
for (const el of [$('roomThread'), $('roomComposer')]) {
  el.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); $('roomThread').classList.add('drop'); } });
  el.addEventListener('dragleave', () => $('roomThread').classList.remove('drop'));
  el.addEventListener('drop', e => { $('roomThread').classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); postRoomFile(f); } });
}

// Search everything on this computer (messages, room posts, cards, files, key names) from the sidebar box.
let searchTimer = null, searchSeq = 0;
async function runSearch() {
  const q = $('convoSearch').value.trim(), box = $('searchResults');
  const seq = ++searchSeq;
  if (q.length < 2) { box.hidden = true; box.replaceChildren(); return; }
  try {
    const r = await api('GET', `/ui/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;
    box.replaceChildren(text('small', r.results.length ? `${r.results.length} found on this computer` : 'Nothing found in messages, rooms, cards or key names.'));
    for (const x of r.results.slice(0, 40)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'search-hit';
      const where = x.kind === 'secret' ? `Key${x.project ? ` · ${x.project} · ${x.env}` : ''}` : x.room ? `# ${x.room}` : x.with;
      const what = x.kind === 'secret' ? x.name : x.card ? `${CARD_LABEL[x.card.type] || 'Card'}: ${x.card.title}` : x.file ? `File: ${x.file}` : x.text;
      b.append(text('b', where || ''), text('span', what || ''));
      if (x.at) b.append(text('small', new Date(x.at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })));
      b.onclick = () => {
        if (x.kind === 'secret') { location.hash = '#secrets'; return; }
        if (x.roomId) openRoom(x.roomId); else if (x.peerId) select(x.peerId);
        setTimeout(() => {
          const el = $(x.roomId ? 'roomThread' : 'thread').querySelector(`[data-id="${CSS.escape(x.id)}"]`);
          if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
        }, 700);
      };
      box.append(b);
    }
    box.hidden = false;
  } catch (e) { if (seq === searchSeq) { box.hidden = false; box.replaceChildren(text('small', e.message)); } }
}
$('convoSearch').oninput = () => { renderConvos(); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); };
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

// "Pair a device" open: this device waits to be picked by others (no sound, nothing to type) and lists
// the devices that wait too. The last result stays on screen while it waits again.
const isWaitingToBePicked = p => !!(p && p.discover && p.state === 'announcing');
let lastResult = null, discoverAsked = 0;
function ensureDiscover() {
  if (Date.now() - discoverAsked < 3000) return;
  discoverAsked = Date.now();
  api('POST', '/ui/discover').then(() => refresh.once()).catch(() => {});
}
function renderNearby() {
  const list = $('nearbyList'); const items = state?.nearby || [];
  list.replaceChildren();
  $('nearbyEmpty').hidden = items.length > 0;
  for (const n of items) {
    const li = document.createElement('li');
    const who = document.createElement('div'); who.className = 'nb-who';
    who.append(text('b', n.name), text('small', n.paired ? `Already paired · ${n.fingerprint}` : n.fingerprint));
    const go = button(n.paired ? 'Pair again' : 'Pair', () => act('POST', '/ui/nearby/pair', { id: n.id }));
    go.className = n.paired ? 'ghost small-btn' : 'primary small-btn';
    li.append(who, go); list.append(li);
  }
}

function renderPairing(p) {
  const view = !p ? 'idle' : isWaitingToBePicked(p) ? 'idle' : p.state === 'announcing' && p.invite ? 'invite' : p.state === 'announcing' && p.team ? 'connecting' : VIEW_OF[p.state] || 'idle';
  $('tailscaleRow').hidden = !state?.device?.tailscale;
  $('inviteTsRow').hidden = !state?.device?.tailscale;
  card.dataset.viewNow = view;
  $('cancelRow').hidden = view === 'idle';
  $('timeLeft').textContent = p && p.secondsLeft ? `Times out in ${Math.floor(p.secondsLeft / 60)}:${String(p.secondsLeft % 60).padStart(2, '0')}` : '';
  $('speakerCard').hidden = !((view === 'idle' && $('pairMore').open) || (view === 'announcing' && !p?.quiet));
  if (view !== 'idle') $('idleCodeForm').hidden = true;
  if (view === 'idle') {
    renderNearby();
    // Keep waiting to be picked while the screen is open (also after a pairing finished or timed out).
    if (app.dataset.main === 'pair' && (!p || ['paired', 'failed', 'cancelled', 'expired'].includes(p.state))) ensureDiscover();
  }
  if (view === 'invite') {
    $('inviteCmd').textContent = `vinac join ${p.beaconCode || ''}`;
    $('inviteCode').textContent = p.beaconCode || '';
    $('inviteModeText').textContent = { restricted: 'Restricted', standard: 'Standard', auto: 'Auto' }[p.invite.mode] || p.invite.mode;
  }

  if (view === 'announcing') {
    $('beaconCode').textContent = p.beaconCode || '';
    // Pairing by code: no sound, the code is the main thing on screen.
    $('announceTitle').textContent = p.quiet ? 'Your pairing code' : 'Playing the sound';
    $('announceText').textContent = p.quiet ? 'Waiting for the other device…' : 'Playing the pairing sound…';
    $('announceHint').innerHTML = p.quiet
      ? 'On the other device, open VINAC Link, press <b>Pair a device</b>, then <b>Enter a code</b>, and type this:'
      : 'On the other device, open VINAC Link, press <b>Pair a device</b>, then <b>Listen for it</b>. The sound repeats until it is heard.';
    $('codeBox').classList.toggle('plain', !!p.quiet);
    if (p.quiet) $('codeBox').open = true;
  }
  if (view === 'connecting') $('connectText').textContent = p.team && p.state === 'announcing'
    ? `Request sent. Waiting for ${p.team.email || 'your teammate'} to accept it on ${p.team.name}…`
    : p.team ? `Connecting to ${p.team.name} through your team's channel…` : p.message;
  if (view === 'comparing') {
    const six = c => (c ? `${c.slice(0, 3)} ${c.slice(3)}` : '--- ---');
    $('digits').textContent = six(p.matchCode || p.showCode);
    $('myCode').textContent = six(p.showCode);
    $('peerName').textContent = p.team ? `${p.peer?.name || p.team.name} (${p.team.email || 'your teammate'}; compare the digits by phone or chat)` : p.peer?.name || 'the other device';
    $('peerFp').textContent = p.peer?.fingerprint || '';
    $('matchActions').hidden = p.confirmedHere;
    $('olderBox').hidden = p.confirmedHere || !!p.join || !!p.invite;
    $('waitingThere').hidden = !p.confirmedHere;
    $('attemptsLeft').textContent = p.attemptsLeft < 3 ? `${p.attemptsLeft} ${p.attemptsLeft === 1 ? 'try' : 'tries'} left.` : 'A wrong code 3 times cancels the pairing.';
  } else $('otherCode').value = '';

  const result = $('result');
  const done = p && ['paired', 'failed', 'cancelled', 'expired'].includes(p.state);
  // A discovery wait that ran out or was replaced is not news; a real pairing's result is.
  if (done && !(p.discover && p.state !== 'paired')) lastResult = { state: p.state, message: p.message, peer: p.peer };
  if (!wantPair && !done) lastResult = null;
  const shown = done && !(p.discover && p.state !== 'paired') ? lastResult : (view === 'idle' ? lastResult : null);
  result.hidden = !shown;
  $('openNewBtn').hidden = !(shown && shown.state === 'paired');
  if (shown) {
    result.className = `result ${shown.state === 'paired' ? 'ok' : 'bad'}`;
    result.textContent = shown.state === 'paired' ? `Paired with ${shown.peer?.name}. Both devices now trust each other.` : shown.message;
  }
  if (done && p.state === 'paired' && lastPaired !== p.peer?.fingerprint) { if (lastPaired !== null || !firstLoad) toast(`Paired with ${p.peer?.name}`); lastPaired = p.peer?.fingerprint; }
}

$('openNewBtn').onclick = () => {
  const fp = lastResult?.peer?.fingerprint || state?.pairing?.peer?.fingerprint;
  const peer = state?.peers.find(x => x.fingerprint === fp);
  if (peer) { lastResult = null; select(peer.id); }
};
function openPair() { roomOpen = null; wantPair = true; wantSecrets = false; wantFirewall = false; wantActivity = false; wantProjects = false; wantRooms = false; wantAgents = false; mobileMain = true; lastResult = null; render(state); ensureDiscover(); }
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
  if (p?.state === 'announcing' && !p.quiet && !playing) playLoop(p.beaconHex);
  if (listenMode === 'secret' || listenMode === 'phone') return; // the secret dialog (or phone pairing) owns the microphone
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
    if (mode === 'phone') { $('phoneStatus').textContent = 'The microphone is blocked. Allow it for this page (it hears the phone\'s pairing sound), then press Cancel and Pair a phone again.'; return; }
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
    if (listenMode === 'phone') {
      const r = decodeFskFrameV2(pcm, { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: HELLO_MIN, maxLength: HELLO_MAX, accept: b => !!parseHello(b) });
      lastDecode = { at: Date.now(), seconds: +(pcm.length / sr).toFixed(1), result: r ? (r.ok ? (r.fecFailed ? 'damaged' : 'ok') : r.reason) : 'no training' };
      if (!r?.ok) return;
      const keep = pcm.slice(Math.min(pcm.length, r.endSample));
      chunks = keep.length ? [keep] : []; samples = keep.length;
      if (r.fecFailed) { $('phoneStatus').textContent = 'Heard the phone, but the sound was damaged. Play it again, a little closer…'; return; }
      try {
        const got = await api('POST', '/ui/phone/heard', { hex: toHex(r.frameBytes) });
        stopListening();
        Object.assign(state, got); renderPhones();
      } catch (e) { $('phoneStatus').textContent = `${e.message} Still listening…`; }
      return;
    }
    const r = decodeFskFrameV2(pcm, secret
      ? { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, minLength: Math.min(SECRET_MIN_BYTES, PHONE_SECRET_MIN), maxLength: SECRET_MAX_BYTES, accept: b => secretFrameLooksValid(b) || !!parseSecretFrame(b) }
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
  const bars = $(listenMode === 'secret' ? 'secretMeter' : listenMode === 'phone' ? 'phoneMeter' : 'meter').children;
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
// Keys in the vault that can be sent on (not waiting for approval or acceptance).
const sendableSecrets = () => (state?.secrets || []).filter(s => !s.pending && !s.offered);
function showSecretBody(id) {
  for (const b of ['secretChoose', 'secretAsk', 'secretForm', 'secretProgress']) $(b).hidden = b !== id;
}
// The method follows the device: the network when it is reachable, sound when it is offline.
function pickHow() {
  const p = peerById($('secretPeer').value);
  $('secretForm').how.value = p?.online === false ? 'sound' : 'wifi';
  $('netHint').textContent = p?.online === false ? `${p.name} looks offline right now: sound works without a network` : 'instant: same Wi-Fi or cable, or Tailscale';
  syncHow();
}
// Send: a new key typed here, or one from the vault ('stored').
function useKeyPick() {
  const id = $('secretKeyPick').value;
  const item = id ? sendableSecrets().find(s => s.id === id) : null;
  secretMode = item ? 'stored' : 'send'; storedItem = item;
  $('valueRow').hidden = !!item; $('storedNote').hidden = !item;
  $('secretName').readOnly = !!item; $('secretName').value = item ? item.name : '';
  syncSecretPeer(); updateSoundTime();
}
function openSecretModal(mode, { item = null, fromConversation = false, name = '', via = 'sound' } = {}) {
  const sending = mode === 'send' || mode === 'stored';
  const peers = secretPeers();
  if ((sending || mode === 'ask') && !peers.length) return toast('Pair a device first: secrets go only to paired devices.');
  if (sending && fromConversation && !peerById(selected)?.canMessage) return toast('Pair this device again before sending it secrets.');
  if (secretRun) secretRun.stop = true;
  if (listenMode === 'secret') stopListening();
  secretMode = mode; storedItem = item;
  secretRun = null;
  $('secretModal').hidden = false;
  $('secretResult').hidden = true; $('secretDone').hidden = true; $('secretStop').hidden = false;
  $('secretPulse').hidden = false;
  if (mode === 'choose') {
    $('secretTitle').textContent = 'Receive a key';
    showSecretBody('secretChoose');
    const computers = peers.length > 0, phones = (state?.phones || []).length > 0;
    $('chooseAsk').disabled = $('chooseNetwork').disabled = $('chooseSound').disabled = !computers;
    $('choosePhoneHint').textContent = phones ? 'From the phone vault, by sound. Press Send on the phone after this.' : 'No phone paired yet: this opens Pair a phone.';
    if (!computers) $('chooseAsk').querySelector('small').textContent = 'Pair a computer first (Pair a device).';
    $(computers ? 'chooseAsk' : 'choosePhone').focus();
    return;
  }
  if (mode === 'ask') {
    $('secretTitle').textContent = 'Ask for a key';
    showSecretBody('secretAsk');
    $('askPeer').replaceChildren(...peers.map(p => new Option(p.online === false ? `${p.name} (offline)` : p.name, p.id)));
    $('askPeer').value = (peers.find(p => p.id === selected) || peers[0]).id;
    $('askName').value = name; $('askReason').value = '';
    $('askName').focus();
    return;
  }
  if (mode === 'receive') {
    showSecretBody('secretProgress');
    const sound = via !== 'network';
    $('secretTitle').textContent = via === 'phone' ? 'Receive from your phone' : sound ? 'Receive by sound' : 'Receive over the network';
    $('secretMeter').hidden = !sound;
    $('secretStatus').textContent = via === 'phone' ? 'Listening for 3 minutes… Now press Send on the phone, close to this computer, volume up.'
      : sound ? 'Listening for 3 minutes… Now press Send on the other computer and choose Sound.'
      : 'Waiting 3 minutes for a key from a paired computer. Send it there now; it is accepted here without asking.';
    secretRun = { stop: false };
    api('POST', '/ui/secret/receive', { on: true }).then(() => refresh.once()).catch(e => toast(e.message));
    if (sound) startListening('secret');
    return;
  }
  showSecretBody('secretForm');
  $('peerRow').hidden = !sending; $('howBox').hidden = !sending; $('speakerRow').hidden = !sending;
  $('valueRow').hidden = mode === 'stored'; $('storedNote').hidden = mode !== 'stored';
  $('secretName').readOnly = mode === 'stored';
  $('secretName').value = item ? item.name : name; $('secretValue').value = ''; $('secretValue').type = 'password'; $('secretShow').textContent = 'Show';
  // Send…: choose a key from the vault, or type a new one.
  const stored = sendableSecrets();
  $('keyPickRow').hidden = !(mode === 'send' && stored.length);
  if (mode === 'send' && stored.length) {
    $('secretKeyPick').replaceChildren(new Option('A new key (type it below)', ''), ...stored.map(s => new Option(s.name, s.id)));
    $('secretKeyPick').value = '';
  }
  if (sending) {
    $('secretPeer').replaceChildren(...peers.map(p => new Option(p.online === false ? `${p.name} (offline)` : p.name, p.id)));
    const pre = fromConversation ? selected : (peers.find(p => p.id === selected) || peers[0]).id;
    $('secretPeer').value = pre;
    $('secretHint').replaceChildren(text('span', 'Sealed so only '), text('b', ''), text('span', ' can open it, then stored in its key store. Its agent tools show the name, never the value. Use test values until VINAC Link has had a security review.'));
    $('secretHint').children[1].id = 'secretTo';
    syncSecretPeer(); updateSoundTime(); pickHow();
  } else {
    $('secretTitle').textContent = 'Add a key to this device';
    $('secretHint').textContent = 'Kept in this device\'s key store. Agents can ask to use it by name (you approve each run); VINAC Link\'s agent tools don\'t return its value. You can send it to a paired device later.';
    $('secretSend').textContent = 'Save';
  }
  (mode === 'stored' ? $('secretPeer') : mode === 'send' && stored.length ? $('secretKeyPick') : $('secretName')).focus();
}

// Receive…: the ways to get a key.
$('chooseAsk').onclick = () => openSecretModal('ask');
$('chooseNetwork').onclick = () => openSecretModal('receive', { via: 'network' });
$('chooseSound').onclick = () => openSecretModal('receive', { via: 'sound' });
$('choosePhone').onclick = () => {
  if ((state?.phones || []).length) return openSecretModal('receive', { via: 'phone' });
  closeSecretModal(); showSecretTab('devices'); $('phonesBox').open = true; $('phonePairBtn').focus();
};
$('choosePaste').onclick = () => openSecretModal('add');
$('secretAsk').onsubmit = async e => {
  e.preventDefault();
  const name = $('askName').value.trim(), peer = peerById($('askPeer').value);
  if (!name || !peer) return;
  const reason = $('askReason').value.trim();
  try {
    const s = await api('POST', '/ui/send', { to: peer.id, text: `Please send the key ${name}${reason ? `: ${reason}` : '.'}`, intent: 'person.secret.request', args: { name, ...(reason ? { reason } : {}) } });
    closeSecretModal(); render(s);
    toast(s.sent?.queued ? `${peer.name} is offline: the request goes out when it's back.` : `Asked ${peer.name} for ${name}. When they press Send there, it arrives here ready to use.`);
  } catch (err) { toast(err.message); }
};
$('secretKeyPick').addEventListener('change', useKeyPick);

// Secrets tabs: Keys · Requests · Phones (remembered in this browser).
let secretTab = LS.get('secretTab', 'keys');
function showSecretTab(tab) {
  secretTab = tab; LS.set('secretTab', tab);
  for (const b of document.querySelectorAll('.secret-tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('.secrets-view .tab-panel')) p.hidden = p.dataset.panel !== tab;
}
for (const b of document.querySelectorAll('.secret-tabs [role=tab]')) b.onclick = () => showSecretTab(b.dataset.tab);
showSecretTab(secretTab);
let seenWaiting = 0;
function renderSecretTabs() {
  const keys = (state.secrets || []).length;
  const waiting = (state.secretRequests || []).length + (state.secretUses || []).length;
  const devices = (state.phones || []).length;
  const setCount = (id, n, hot = false) => { const el = $(id); el.textContent = n || ''; el.classList.toggle('hot', hot && n > 0); };
  setCount('tabKeysCount', keys, (state.secrets || []).some(s => s.pending || s.offered));
  setCount('tabRequestsCount', waiting, true);
  setCount('tabDevicesCount', devices);
  $('requestsEmpty').hidden = !$('askBox').hidden || !$('useBox').hidden || !$('grantBox').hidden;
  // Something new needs the person (a key asked for, a program waiting): show it.
  if (waiting > seenWaiting && secretTab !== 'requests') showSecretTab('requests');
  seenWaiting = waiting;
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
  $('secretSend').textContent = sound ? 'Play it' : 'Send';
}

$('secretBtn').onclick = () => openSecretModal('send', { fromConversation: true });
$('receiveBtn').onclick = () => openSecretModal('choose');
$('addSecretBtn').onclick = () => openSecretModal('add');
$('sendSecretBtn').onclick = () => openSecretModal('send');
$('secretPeer').addEventListener('change', () => { syncSecretPeer(); pickHow(); });
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
      const r = stored ? await api('POST', '/ui/secrets/send', { id: storedItem.id, to: peer.id }) : await api('POST', '/ui/secret/wifi', { to: peer.id, name, value });
      secretFinish('ok', r.offered
        ? `Sent ${name} to ${peer.name}. Its person accepts it there (Secrets › Accept); until then nothing can use it.`
        : `Sent ${name} to ${peer.name} over Wi-Fi. It is in its key store now.`);
      refresh.once();
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
$('showCodeBtn').onclick = () => act('POST', '/ui/announce', { quiet: true });
$('enterCodeBtn').onclick = () => { const f = $('idleCodeForm'); f.hidden = !f.hidden; if (!f.hidden) $('idleCodeInput').focus(); };
$('idleCodeForm').onsubmit = e => { e.preventDefault(); const code = $('idleCodeInput').value.trim(); if (code) { $('idleCodeInput').value = ''; act('POST', '/ui/heard', { code }); } };
$('announceTsBtn').onclick = async () => { await engine.ensureContext().catch(() => {}); act('POST', '/ui/announce', { over: 'tailscale' }); };
$('compareActions').onsubmit = async e => {
  e.preventDefault();
  const code = $('otherCode').value.replace(/\D/g, '');
  if (code.length !== 6) return toast('Type the 6 digits shown on the other device.');
  try { render(await api('POST', '/ui/confirm', { code })); $('otherCode').value = ''; } catch (err) { toast(err.message); refresh.once(); }
};
$('rejectBtn').onclick = () => act('POST', '/ui/cancel');
$('matchBtn').onclick = async () => {
  try { render(await api('POST', '/ui/confirm', { match: true })); } catch (err) { toast(err.message); refresh.once(); }
};
$('inviteBtn').onclick = async () => {
  try { render(await api('POST', '/ui/invite', { mode: $('inviteMode').value, ...($('inviteTs').checked ? { over: 'tailscale' } : {}) })); }
  catch (err) { toast(err.message); }
};
$('inviteCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('inviteCmd').textContent); toast('Copied. Run it on the other computer, or give it to the agent there.'); }
  catch { toast('Select the command and copy it.'); }
};
$('pairMore').addEventListener('toggle', () => render(state));
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
