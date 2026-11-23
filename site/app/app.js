// VINAC Link phone vault (beta): keys encrypted on this phone with a passphrase, paired computers,
// and keys sent to a computer by sound. No server, no tracking; the pairing code arrives in the
// link after # (never sent to any server) and is removed from the address bar right away.
import { pairWithComputer, sealForComputer, vaultKey, sealVault, openVault, newSalt, unb64u, PBKDF2_ITERATIONS } from './web/phone-crypto.js';
import { decodePairLink, cleanName } from './web/phone-frame.js';
import { BEACON_TONES, BEACON_BPS } from './web/beacon.js';
import { SECRET_FEC } from './web/secret-frame.js';
import { AudioEngine } from './lab/js/audio.js';

const STORE = 'vinacPhoneVault';
const LOCK_AFTER_MS = 5 * 60_000;
const $ = id => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const engine = new AudioEngine({});

// The pairing link (if the phone's camera opened one): kept in memory only.
const rawLink = location.hash;
let pending = decodePairLink(rawLink);
if (pending) pending.raw = rawLink;
if (location.hash) history.replaceState(null, '', location.pathname);

let key = null, data = null, lockTimer = null, pairing = null, current = -1, tab = 'keys', playing = false, toastTimer = null;
const saved = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };

async function persist() {
  localStorage.setItem(STORE, JSON.stringify({ ...saved(), box: await sealVault(key, data) }));
}

function lock() {
  key = null; data = null; pairing = null; current = -1;
  closeSheets(); clearTimeout(lockTimer); render();
}
function bump() { clearTimeout(lockTimer); if (key) lockTimer = setTimeout(lock, LOCK_AFTER_MS); }
document.addEventListener('visibilitychange', () => { if (document.hidden && key) lockTimer = setTimeout(lock, 60_000); else bump(); });
['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, bump, { passive: true }));

function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
const when = iso => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
const chevron = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.classList.add('chev'); s.innerHTML = '<path d="m9 6 6 6-6 6"/>'; return s; };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }

// ---- sheets ----------------------------------------------------------------------------------
function openSheet(id) { closeSheets(); show('scrim'); show(id); $(id).querySelector('input, select, button.primary')?.focus({ preventScroll: true }); }
function closeSheets() { for (const id of ['sheetAdd', 'sheetKey', 'sheetSend', 'scrim']) show(id, false); $('keyValueShown').textContent = '••••••••••••'; $('keyShow').textContent = 'Show'; }
$('scrim').addEventListener('click', closeSheets);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

// ---- render ----------------------------------------------------------------------------------
function render() {
  const s = saved();
  show('vCreate', !s); show('vLocked', !!s && !key); show('vOpen', !!key);
  if (!key) {
    $('lockedLead').textContent = pending ? `Unlock to pair with ${pending.name}.` : 'Enter your passphrase to open your keys.';
    return;
  }
  $('title').textContent = tab === 'keys' ? 'Keys' : 'Computers';
  show('tabKeys', tab === 'keys'); show('tabComputers', tab === 'computers'); show('addKeyBtn', tab === 'keys');
  $('tabKeysBtn').setAttribute('aria-current', tab === 'keys' ? 'page' : 'false');
  $('tabComputersBtn').setAttribute('aria-current', tab === 'computers' ? 'page' : 'false');

  show('pairCard', !!pending);
  if (pending) {
    $('pairName').textContent = pending.name;
    show('pairCode', !!pairing); show('pairDone', !!pairing);
    $('pairIntro').textContent = pairing
      ? 'The computer should show the same 6 digits. If it does, press Allow there, then tap "The computer says Paired". Not heard? Play again, closer.'
      : 'Hold the phone close to that computer, volume up, then play the sound. The computer is listening for it.';
    if (pairing) $('pairCode').textContent = pairing.code;
  }

  const q = $('keySearch').value.trim().toLowerCase();
  const kl = $('keyList'); kl.replaceChildren();
  const keys = data.keys.map((k, i) => ({ k, i })).filter(({ k }) => !q || k.name.toLowerCase().includes(q));
  if (!data.keys.length) {
    const li = el('li', null, 'empty'); li.append(el('b', 'No keys yet'), el('p', 'Tap + to add an API key or token. It stays encrypted on this phone.'));
    kl.append(li);
  } else if (!keys.length) kl.append(Object.assign(el('li', null, 'empty'), { textContent: 'No key matches.' }));
  for (const { k, i } of keys) {
    const li = el('li', null, 'row'); li.tabIndex = 0; li.setAttribute('role', 'button');
    const t = el('div', null, 'txt'); t.append(el('b', k.name), el('small', `Added ${when(k.addedAt)}`));
    li.append(el('span', k.name[0].toUpperCase(), 'avatar'), t, chevron());
    li.addEventListener('click', () => openKey(i));
    li.addEventListener('keydown', e => { if (e.key === 'Enter') openKey(i); });
    kl.append(li);
  }

  const cl = $('computerList'); cl.replaceChildren();
  if (!data.computers.length) {
    const li = el('li', null, 'empty'); li.append(el('b', 'No computers yet'), el('p', 'Pair one to send it keys by sound.'));
    cl.append(li);
  }
  data.computers.forEach((c, i) => {
    const li = el('li');
    const t = el('div', null, 'txt'); t.append(el('b', c.name), el('small', `Paired ${when(c.pairedAt)}`));
    const rm = el('button', 'Remove', 'btn small'); rm.type = 'button';
    rm.addEventListener('click', async () => { if (!confirm(`Remove ${c.name}? Remove this phone on that computer too.`)) return; data.computers.splice(i, 1); await persist(); render(); });
    li.append(el('span', '▭', 'avatar pc'), t, rm);
    cl.append(li);
  });
}

function openKey(i) {
  current = i; const k = data.keys[i];
  $('keyAvatar').textContent = k.name[0].toUpperCase();
  $('keyTitle').textContent = k.name; $('keyAdded').textContent = `Added ${when(k.addedAt)}`;
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
$('keySend').addEventListener('click', () => {
  const k = data.keys[current];
  if (!data.computers.length) { toast('Pair a computer first (Computers tab).'); return; }
  $('sendName').textContent = k.name;
  const sel = $('sendTo'); sel.replaceChildren(); data.computers.forEach((c, i) => sel.append(new Option(c.name, String(i))));
  show('sendToRow', data.computers.length > 1);
  $('sendStatus').className = 'status'; $('sendStatus').textContent = '';
  openSheet('sheetSend');
});

async function play(frame, statusId, label) {
  if (playing) return false;
  playing = true;
  const st = $(statusId); st.className = 'status'; st.textContent = `${label}… keep the phone close.`;
  try {
    await engine.playFrame(frame, { rawBps: BEACON_BPS, tones: BEACON_TONES, fec: SECRET_FEC, amplitude: 0.3 });
    st.textContent = 'Done playing.';
    return true;
  } catch (e) { st.className = 'status bad'; st.textContent = `Could not play sound: ${e.message}`; return false; }
  finally { playing = false; }
}

// ---- create, unlock, lock --------------------------------------------------------------------
$('createForm').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('newPass').value !== $('newPass2').value) { toast('The two passphrases differ.'); return; }
  const salt = newSalt();
  key = await vaultKey($('newPass').value, unb64u(salt));
  data = { phoneName: cleanName($('phoneName').value, 20) || 'My phone', keys: [], computers: [] };
  localStorage.setItem(STORE, JSON.stringify({ v: 1, salt, iterations: PBKDF2_ITERATIONS, box: await sealVault(key, data) }));
  $('newPass').value = $('newPass2').value = '';
  navigator.storage?.persist?.().catch(() => {});
  bump(); render();
});
$('unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const s = saved();
  $('unlockStatus').className = 'status'; $('unlockStatus').textContent = 'Unlocking…';
  try {
    const k = await vaultKey($('pass').value, unb64u(s.salt), s.iterations || PBKDF2_ITERATIONS);
    data = await openVault(k, s.box); key = k;
    $('pass').value = ''; $('unlockStatus').textContent = '';
    bump(); render();
  } catch { $('unlockStatus').className = 'status bad'; $('unlockStatus').textContent = 'Wrong passphrase.'; }
});
$('lockBtn').addEventListener('click', lock);
$('tabKeysBtn').addEventListener('click', () => { tab = 'keys'; render(); });
$('tabComputersBtn').addEventListener('click', () => { tab = 'computers'; render(); });
$('keySearch').addEventListener('input', render);

// ---- pairing -----------------------------------------------------------------------------------
$('pairPlay').addEventListener('click', async () => {
  try {
    if (!pairing) pairing = await pairWithComputer(pending.raw, data.phoneName);
    render();
    await play(pairing.hello, 'pairStatus', 'Playing the pairing sound');
  } catch (e) { $('pairStatus').className = 'status bad'; $('pairStatus').textContent = e.message; }
});
$('pairDone').addEventListener('click', async () => {
  data.computers = data.computers.filter(c => c.name !== pairing.computer.name); // pairing again replaces it
  data.computers.push(pairing.computer);
  await persist();
  const name = pending.name;
  pending = null; pairing = null; tab = 'computers'; render();
  toast(`Paired with ${name}.`);
});
$('pairCancel').addEventListener('click', () => { pending = null; pairing = null; render(); });

// ---- add and send ------------------------------------------------------------------------------
$('addKeyBtn').addEventListener('click', () => { $('addKeyForm').reset(); openSheet('sheetAdd'); });
$('addKeyCancel').addEventListener('click', closeSheets);
$('addKeyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('keyName').value.trim(), value = $('keyValue').value;
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) { toast('Names use letters, digits, _ . - (up to 40).'); return; }
  if (new TextEncoder().encode(value).length > 200) { toast('By sound a value can be up to 200 bytes.'); return; }
  data.keys = data.keys.filter(k => k.name !== name);
  data.keys.push({ name, value, addedAt: new Date().toISOString() });
  data.keys.sort((a, b) => a.name.localeCompare(b.name));
  await persist();
  closeSheets(); render(); toast(`${name} saved.`);
});
$('sendPlay').addEventListener('click', async () => {
  const k = data.keys[current], c = data.computers[Number($('sendTo').value) || 0];
  if (!k || !c) return;
  try {
    const { frame, counter } = await sealForComputer(c, k.name, k.value);
    c.counter = counter; await persist();   // a newer number every time: a replayed sound is refused there
    if (await play(frame, 'sendStatus', `Sending ${k.name} to ${c.name}`)) {
      $('sendStatus').className = 'status ok';
      $('sendStatus').textContent = `Played. ${c.name} should say it received ${k.name}. If not, check it's listening and play again.`;
    }
  } catch (e) { $('sendStatus').className = 'status bad'; $('sendStatus').textContent = e.message; }
});
$('sendCancel').addEventListener('click', closeSheets);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
render();
