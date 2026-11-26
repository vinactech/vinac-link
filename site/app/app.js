// VINAC Link phone vault (beta): keys encrypted on this phone with a passphrase, paired devices
// (computers, and since 2.0 other phones), and keys sent sealed for one of them: as a code (QR) the
// other phone opens, or as sound. No server, no tracking; anything in a link arrives after # (never
// sent to any server) and is removed from the address bar right away.
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

const STORE = 'vinacPhoneVault';
const LOCK_AFTER_MS = 5 * 60_000;
const $ = id => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const SHEETS = ['sheetAdd', 'sheetKey', 'sheetSend', 'sheetHost', 'sheetReceive', 'sheetScan', 'scrim'];
const canScan = 'BarcodeDetector' in globalThis && !!navigator.mediaDevices?.getUserMedia;

// Whatever the camera opened (a pairing code, a phone's answer, a key): kept in memory only.
let incoming = readPhoneLink(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname);

let key = null, data = null, lockTimer = null, pairing = null, pending = null, current = -1, tab = 'keys', playing = false, toastTimer = null;
let hostFound = null, received = null, sendFrame = null;
const saved = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };
const devices = () => data.computers; // the stored name stays "computers" (older vaults)

async function persist() {
  localStorage.setItem(STORE, JSON.stringify({ ...saved(), box: await sealVault(key, data) }));
}

function lock() {
  stopListening(); stopScan();
  key = null; data = null; pairing = null; current = -1; hostFound = null; received = null; sendFrame = null;
  closeSheets(); clearTimeout(lockTimer); render();
}
function bump() { clearTimeout(lockTimer); if (key) lockTimer = setTimeout(lock, LOCK_AFTER_MS); }
document.addEventListener('visibilitychange', () => { if (document.hidden && key) lockTimer = setTimeout(lock, 60_000); else bump(); });
['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, bump, { passive: true }));

function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
const when = iso => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
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

// ---- render ----------------------------------------------------------------------------------
function render() {
  const s = saved();
  show('vCreate', !s); show('vLocked', !!s && !key); show('vOpen', !!key);
  if (!key) {
    $('lockedLead').textContent = incoming?.kind === 'p' ? `Unlock to pair with ${incoming.pair.name}.`
      : incoming?.kind === 'k' ? 'Unlock to receive the key you opened.'
        : incoming?.kind === 'h' ? 'Unlock to finish pairing with the other phone.'
          : 'Enter your passphrase to open your keys.';
    return;
  }
  $('title').textContent = tab === 'keys' ? 'Keys' : 'Devices';
  show('tabKeys', tab === 'keys'); show('tabComputers', tab === 'computers'); show('addKeyBtn', tab === 'keys');
  $('tabKeysBtn').setAttribute('aria-current', tab === 'keys' ? 'page' : 'false');
  $('tabComputersBtn').setAttribute('aria-current', tab === 'computers' ? 'page' : 'false');

  // Pairing as the guest (this phone opened a computer's or a phone's code).
  show('pairCard', !!pending);
  if (pending) {
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

  const q = $('keySearch').value.trim().toLowerCase();
  const kl = $('keyList'); kl.replaceChildren();
  const keys = data.keys.map((k, i) => ({ k, i })).filter(({ k }) => !q || k.name.toLowerCase().includes(q));
  if (!data.keys.length) {
    const li = el('li', null, 'empty'); li.append(el('b', 'No keys yet'), el('p', 'Tap + to add an API key or token, or ↓ to receive one. It stays encrypted on this phone.'));
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
    const li = el('li', null, 'empty'); li.append(el('b', 'No devices yet'), el('p', 'Pair a computer or another phone to send it keys.'));
    cl.append(li);
  }
  devices().forEach((c, i) => {
    const li = el('li');
    const phone = c.kind === 'phone';
    const t = el('div', null, 'txt'); t.append(el('b', c.name), el('small', `${phone ? 'Phone' : 'Computer'} · paired ${when(c.pairedAt)}`));
    const rm = el('button', 'Remove', 'btn small'); rm.type = 'button';
    rm.addEventListener('click', async () => { if (!confirm(`Remove ${c.name}? Remove this phone on that ${phone ? 'phone' : 'computer'} too.`)) return; devices().splice(i, 1); await persist(); render(); });
    li.append(el('span', phone ? '▯' : '▭', 'avatar pc'), t, rm);
    cl.append(li);
  });
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
  if (!confirm(`Delete ${k.name} from this phone?`)) return;
  data.keys.splice(current, 1); await persist(); closeSheets(); render(); toast(`${k.name} deleted.`);
});

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
  status(statusId, `${label}… keep the phones close, volume up.`);
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
      const kind = r.frameBytes[0] === 0xc6 ? 'h' : 'k';
      await handleIncoming({ kind, bytes: r.frameBytes }, st);
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
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch { status(statusId, 'The camera is blocked. Allow it for this page, or use the camera app.', 'bad'); return; }
  const v = $('scanVideo'); v.srcObject = scanStream; await v.play().catch(() => {});
  closeSheetsKeepStream(); show('scrim'); show('sheetScan');
  const det = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
  scanTimer = setInterval(async () => {
    try {
      const codes = await det.detect(v);
      const hit = codes.map(c => readPhoneLink(c.rawValue)).find(Boolean);
      if (!hit) return;
      stopScan(); show('sheetScan', false);
      show(scanBack); await handleIncoming(hit, scanBack === 'sheetHost' ? 'hostStatus' : 'recvStatus');
    } catch { /* not ready yet */ }
  }, 300);
}
function closeSheetsKeepStream() { for (const id of SHEETS) show(id, false); }
function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  scanStream?.getTracks().forEach(t => t.stop()); scanStream = null;
  const v = $('scanVideo'); if (v) v.srcObject = null;
}
$('scanCancel').addEventListener('click', () => { stopScan(); show('sheetScan', false); if (scanBack) show(scanBack); else closeSheets(); });

// ---- anything that arrives: a pairing code, a phone's answer, a key --------------------------------
async function handleIncoming(item, statusId = 'recvStatus') {
  if (!item) return;
  if (item.kind === 'p') { pending = item.pair; pairing = null; $('pairQr').replaceChildren(); closeSheets(); tab = 'computers'; render(); return; }
  if (item.kind === 'h') {
    if (!data.hosting) { toast('No pairing is waiting on this phone: press "Pair another phone" first.'); return; }
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
$('tabKeysBtn').addEventListener('click', () => { tab = 'keys'; render(); });
$('tabComputersBtn').addEventListener('click', () => { tab = 'computers'; render(); });
$('keySearch').addEventListener('input', render);

// ---- pairing as the guest (this phone opened the other device's code) -------------------------------
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
  pending = null; pairing = null; $('pairQr').replaceChildren(); tab = 'computers'; render();
  toast(`Paired with ${name}.`);
});
$('pairCancel').addEventListener('click', () => { pending = null; pairing = null; $('pairQr').replaceChildren(); render(); });

// ---- pairing as the host (another phone opens this phone's code) ---------------------------------
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
  await persist(); closeSheets(); tab = 'computers'; render();
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
  await persist(); closeSheets(); tab = 'keys'; render(); toast(`${r.name} saved.`);
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

const sendTarget = () => devices()[Number($('sendTo').value) || 0];
function renderSend() {
  const c = sendTarget(), phone = c?.kind === 'phone';
  show('sendStepsPc', !phone); show('sendPhone', phone);
  $('sendQr').replaceChildren(); show('sendMakeQr', true); sendFrame = null;
  $('sendPlay').textContent = phone ? 'Play a sound instead' : 'Play';
  $('sendPlay').className = phone ? 'btn block' : 'btn primary block';
  status('sendStatus', '');
}
$('keySend').addEventListener('click', () => {
  const k = data.keys[current];
  if (!devices().length) { toast('Pair a computer or a phone first (Devices tab).'); return; }
  $('sendName').textContent = k.name;
  const sel = $('sendTo'); sel.replaceChildren(); devices().forEach((c, i) => sel.append(new Option(`${c.name}${c.kind === 'phone' ? ' (phone)' : ''}`, String(i))));
  show('sendToRow', devices().length > 1);
  openSheet('sheetSend'); renderSend();
});
$('sendTo').addEventListener('change', renderSend);
async function sealCurrent() {
  const k = data.keys[current], c = sendTarget();
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
    const { frame, k, c } = sendFrame ? { frame: sendFrame, k: data.keys[current], c: sendTarget() } : await sealCurrent();
    if (await play(frame, 'sendStatus', `Sending ${k.name} to ${c.name}`)) {
      status('sendStatus', `Played. ${c.name} should say it received ${k.name}. If not, check it's listening and play again.`, 'ok');
    }
  } catch (e) { status('sendStatus', e.message, 'bad'); }
});
$('sendCancel').addEventListener('click', closeSheets);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
render();
