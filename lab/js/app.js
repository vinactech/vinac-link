// Screen wiring for VINAC Lab. Audio, framing, error correction and
// verification live in their own modules; this file only connects controls.
import { AudioEngine } from './audio.js';
import { CANONICAL_INTENTS, LOGOS_VERSION } from './logos.js';
import { PROTOCOL_NAME } from './frame.js';
import { PROFILES } from './modem.js';
import { SPEEDS, DEFAULT_TONES, newSession, pairingLink, readPairing } from './session.js';
import { Receiver } from './receiver.js';
import { sendMessage, replayMessage, airtimeSeconds } from './sender.js';
import { measureTones, pickTones } from './calibrate.js';
import { runSecurityCampaign } from './security-lab.js';
import { exportJson } from './report.js';

const $ = s => document.querySelector(s);
const el = {
  micPill: $('#micPill'), sessionPill: $('#sessionPill'), roles: [...document.querySelectorAll('.roles button')],
  pairLink: $('#pairLink'), copyLink: $('#copyLink'), pairedInfo: $('#pairedInfo'), pastePair: $('#pastePair'),
  pasteLink: $('#pasteLink'), usePasted: $('#usePasted'), actionTitle: $('#actionTitle'),
  listenBtn: $('#listenBtn'), message: $('#message'), sendBtn: $('#sendBtn'), sendLabel: $('#sendLabel'),
  sendProgress: $('#sendProgress'), replayBtn: $('#replayBtn'), speaker: $('#speaker'), speakerHint: $('#speakerHint'),
  speedSeg: $('#speedSeg'), airtimeHint: $('#airtimeHint'), toneChips: $('#toneChips'), tuneBtn: $('#tuneBtn'),
  tuneStatus: $('#tuneStatus'), fec: $('#fec'), intent: $('#intent'), newSession: $('#newSession'),
  securityBtn: $('#securityBtn'), exportBtn: $('#exportBtn'), securityResults: $('#securityResults'),
  meterStatus: $('#meterStatus'), bars: $('#bars'), countSent: $('#countSent'), countOk: $('#countOk'),
  countBad: $('#countBad'), feed: $('#feed'), feedEmpty: $('#feedEmpty'),
};

const state = {
  role: 'send', session: newSession(), speed: SPEEDS.fast, fec: 64, tones: [...DEFAULT_TONES],
  paired: false, sequence: 1, lastSent: null, sending: false, tuning: false,
  events: [], counts: { sent: 0, ok: 0, bad: 0 }, calibration: null, security: null, track: {},
};

const engine = new AudioEngine({ onPcm: c => receiver.push(c), onState: s => { if (s.trackSettings) state.track = s.trackSettings; } });
const receiver = new Receiver({ engine, getConfig: () => state, onEvent: addEvent });

// ---------- rendering ----------
const khz = f => (f / 1000).toFixed(1);
const fecLabel = n => n === 64 ? 'Strong correction' : n === 32 ? 'Normal correction' : 'No correction';

function render() {
  document.body.dataset.role = state.role;
  el.roles.forEach(b => b.setAttribute('aria-selected', String(b.dataset.role === state.role)));
  el.actionTitle.textContent = { send: '2 · Send', receive: '2 · Listen', self: '2 · Send and listen' }[state.role];
  el.sessionPill.textContent = `Session ${state.session.id.slice(0, 6)}`;
  el.pairLink.value = pairingLink(`${location.origin}${location.pathname}`, state);
  const locked = state.role === 'receive' && state.paired;
  el.speedSeg.classList.toggle('locked', locked);
  el.speedSeg.querySelectorAll('button').forEach(b => { b.setAttribute('aria-checked', String(b.dataset.speed === state.speed.key)); b.disabled = locked; });
  el.fec.value = String(state.fec);
  el.airtimeHint.textContent = locked ? 'Set by the pairing link.' : `About ${Math.round(airtimeSeconds(el.message.value, { bps: state.speed.bps, fec: state.fec }))} s per message.`;
  el.toneChips.innerHTML = state.tones.map(f => `<span>${khz(f)} kHz</span>`).join('');
  renderBars();
  el.pairedInfo.hidden = !state.paired;
  el.pastePair.hidden = state.paired;
  if (state.paired) el.pairedInfo.innerHTML = `Paired with session <b>${state.session.id.slice(0, 6)}</b> · ${state.speed.label} · ${fecLabel(state.fec)} · ${khz(state.tones[0])}–${khz(state.tones[3])} kHz`;
  el.listenBtn.textContent = receiver.listening ? 'Stop listening' : 'Start listening';
  el.listenBtn.classList.toggle('stop', receiver.listening);
  el.micPill.textContent = receiver.listening ? 'Listening' : 'Mic off';
  el.micPill.dataset.state = receiver.listening ? 'on' : 'off';
  el.sendBtn.disabled = state.sending || state.tuning;
  el.replayBtn.disabled = !state.lastSent || state.sending || state.tuning;
  el.tuneBtn.disabled = state.sending || state.tuning;
  el.countSent.textContent = state.counts.sent; el.countOk.textContent = state.counts.ok; el.countBad.textContent = state.counts.bad;
}

function renderBars() {
  el.bars.innerHTML = state.tones.map(f => `<div class="bar"><div class="track"><i class="floor"></i><i class="fill"></i></div><span>${khz(f)}</span></div>`).join('');
}

function addEvent(ev) {
  state.events.unshift(ev);
  if (ev.kind === 'sent') state.counts.sent++;
  if (ev.kind === 'received') state.counts[ev.status === 'verified' ? 'ok' : 'bad']++;
  el.feedEmpty.hidden = true;
  const li = document.createElement('li');
  li.className = `msg ${ev.status || ''}`;
  const time = ev.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const bits = [];
  if (ev.kind === 'received' && ev.status === 'verified') {
    bits.push(`message #${ev.sequence}`, ev.intent, ev.repaired ? `${ev.repaired} byte${ev.repaired === 1 ? '' : 's'} repaired` : 'no repair needed', ev.format);
  } else if (ev.kind === 'received') {
    bits.push(ev.detail, ev.reason);
  } else if (ev.detail) bits.push(ev.detail);
  li.innerHTML = '<i class="dot"></i><span class="title"></span><time></time><span class="detail"></span>';
  li.querySelector('.title').textContent = ev.title;
  li.querySelector('time').textContent = time;
  li.querySelector('.detail').textContent = bits.filter(Boolean).join(' · ');
  if (ev.text) { const t = document.createElement('span'); t.className = 'text'; t.textContent = `“${ev.text}”`; li.appendChild(t); }
  el.feed.prepend(li);
  while (el.feed.children.length > 101) el.feed.lastElementChild.remove();
  render();
}

// ---------- signal meter ----------
let meterRaf = null, meterTick = 0;
function meterLoop() {
  meterRaf = requestAnimationFrame(meterLoop);
  if (++meterTick % 3) return;
  const sp = engine.readSpectrum();
  if (!sp) return;
  const binOf = f => Math.round(f / sp.sampleRate * sp.fftSize);
  const at = f => { const b = binOf(f); return Math.max(sp.data[b - 1] ?? -140, sp.data[b] ?? -140, sp.data[b + 1] ?? -140); };
  const levels = state.tones.map(at);
  const others = [];
  for (let b = binOf(15000); b <= binOf(20000); b++) {
    const f = b * sp.sampleRate / sp.fftSize;
    if (state.tones.every(t => Math.abs(t - f) > 250)) others.push(sp.data[b]);
  }
  others.sort((a, b) => a - b);
  const floor = others[Math.floor(others.length / 2)] ?? -120;
  const pct = db => Math.max(0, Math.min(100, (db + 120) / 90 * 100));
  el.bars.querySelectorAll('.bar').forEach((bar, i) => {
    bar.querySelector('.fill').style.height = `${pct(levels[i])}%`;
    bar.querySelector('.floor').style.bottom = `${pct(floor)}%`;
  });
  if (meterTick % 15 === 0) {
    const margin = Math.max(...levels) - floor;
    el.meterStatus.textContent = margin > 25 ? 'Tones arriving · strong' : margin > 10 ? 'Tones arriving · weak, move closer' : 'Listening · quiet';
  }
}
function startMeter() { if (!meterRaf) meterLoop(); }
function stopMeter() {
  cancelAnimationFrame(meterRaf); meterRaf = null;
  el.meterStatus.textContent = 'Microphone off';
  el.bars.querySelectorAll('.fill').forEach(f => { f.style.height = '0'; });
}

// ---------- actions ----------
async function startListening() {
  try {
    await receiver.start();
    startMeter(); fillSpeakers();
  } catch (e) {
    addEvent({ kind: 'error', at: new Date(), title: 'Microphone blocked', detail: `${e.name || 'Error'}: allow microphone access for this page and try again.` });
  }
  render();
}
function stopListening() { receiver.stop(); stopMeter(); render(); }

async function fillSpeakers() {
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && !['default', 'communications', ''].includes(d.deviceId));
    const keep = el.speaker.value; el.speaker.length = 1;
    for (const d of outs) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Speaker'; el.speaker.appendChild(o); }
    el.speaker.value = [...el.speaker.options].some(o => o.value === keep) ? keep : '';
    el.speakerHint.textContent = typeof AudioContext.prototype.setSinkId === 'function' ? 'Pick the speaker nearest the other device.' : 'This browser always uses the system speaker.';
  } catch { /* keep the default */ }
}

async function chooseSpeaker() {
  try {
    const ctx = await engine.ensureContext();
    if (typeof ctx.setSinkId === 'function') await ctx.setSinkId(el.speaker.value);
  } catch (e) { addEvent({ kind: 'error', at: new Date(), title: 'Speaker not changed', detail: e.message }); }
}

async function doSend() {
  if (state.sending) return;
  state.sending = true; render();
  const text = el.message.value.trim() || 'Hello from VINAC';
  const sequence = state.sequence++;
  const est = airtimeSeconds(text, { bps: state.speed.bps, fec: state.fec }) * 1000, t0 = performance.now();
  const anim = setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / est);
    el.sendProgress.style.width = `${p * 100}%`;
    el.sendLabel.textContent = `Sending… ${Math.max(0, Math.ceil((est - (performance.now() - t0)) / 1000))} s`;
  }, 200);
  try {
    const r = await sendMessage(engine, { ...state, sequence, intent: el.intent.value, text });
    state.lastSent = r.bytes;
    addEvent({ kind: 'sent', at: new Date(), title: `Sent message #${sequence}`, detail: `“${text}” · ${state.speed.label} · ${Math.round(r.durationMs / 1000)} s` });
  } catch (e) {
    addEvent({ kind: 'error', at: new Date(), title: 'Send failed', detail: e.message });
  } finally {
    clearInterval(anim); el.sendProgress.style.width = '0'; el.sendLabel.textContent = 'Send message';
    state.sending = false; render();
  }
}

async function doReplay() {
  if (!state.lastSent || state.sending) return;
  state.sending = true; render();
  try {
    const r = await replayMessage(engine, state.lastSent, state);
    addEvent({ kind: 'sent', at: new Date(), title: 'Replayed last message', detail: `Identical copy · ${Math.round(r.durationMs / 1000)} s · the receiver should block it` });
  } finally { state.sending = false; render(); }
}

async function doTune() {
  state.tuning = true; render();
  const wasListening = receiver.listening;
  try {
    if (!wasListening) await startListening();
    el.tuneStatus.textContent = 'Measuring… 0%';
    const rows = await measureTones(engine, { onProgress: p => { el.tuneStatus.textContent = `Measuring… ${Math.round(p * 100)}%`; } });
    const tones = pickTones(rows);
    if (!tones) throw new Error('No usable tone set found.');
    state.tones = tones; state.calibration = { at: new Date().toISOString(), rows, tones };
    receiver.clear();
    el.tuneStatus.textContent = `Tuned. Copy the link again so the receiver uses these tones.`;
  } catch (e) {
    el.tuneStatus.textContent = `Tuning failed: ${e.message}`;
  } finally {
    if (!wasListening) stopListening();
    state.tuning = false; render();
  }
}

function applyPairing(p, { fromPaste = false } = {}) {
  state.session = p.session; state.sequence = 1;
  if (p.speed) state.speed = p.speed;
  if (p.fec !== null && [0, 32, 64].includes(p.fec)) state.fec = p.fec;
  if (p.tones) state.tones = p.tones;
  state.paired = true; receiver.replayCache.clear(); receiver.clear();
  state.role = p.role || 'receive';
  if (fromPaste) history.replaceState(null, '', `#${new URL(pairingLink(location.href.split('#')[0], state)).hash.slice(1)}`);
  render();
}

async function runSecurity() {
  el.securityBtn.disabled = true;
  try {
    const res = await runSecurityCampaign({ sessionId: state.session.id, sessionKey: state.session.key, intent: el.intent.value, profile: PROFILES[state.speed.profile], sampleRate: engine.sampleRate || 48000 });
    state.security = res;
    el.securityResults.hidden = false;
    el.securityResults.innerHTML = '';
    for (const t of res.tests) { const li = document.createElement('li'); li.className = t.pass ? '' : 'fail'; li.textContent = t.name; el.securityResults.appendChild(li); }
  } finally { el.securityBtn.disabled = false; }
}

function report() {
  return {
    schema: 'vinac.lab.report/0.2', timestamp: new Date().toISOString(), protocol: PROTOCOL_NAME, logos_version: LOGOS_VERSION,
    role: state.role, session: { id: state.session.id, key_exported: false }, paired_by_link: state.paired,
    device: { user_agent: navigator.userAgent, sample_rate: engine.sampleRate, mic_settings: state.track },
    settings: { speed_bps: state.speed.bps, error_correction_bytes: state.fec, tones_hz: state.tones },
    counts: state.counts,
    events: state.events.map(e => ({ at: e.at.toISOString(), kind: e.kind, status: e.status ?? null, reason: e.reason ?? null, title: e.title, sequence: e.sequence ?? null, intent: e.intent ?? null, bytes_repaired: e.repaired ?? null, format: e.format ?? null, signal_db: e.signalDb ?? null, duration_ms: e.durationMs ?? null })).reverse(),
    calibration: state.calibration, security_selftest: state.security && { passed: state.security.passed, total: state.security.total },
    note: 'Messages are HMAC-signed and replay-protected, not encrypted. Acoustic delivery does not prove distance.',
  };
}

// ---------- events ----------
el.roles.forEach(b => b.addEventListener('click', () => { state.role = b.dataset.role; render(); }));
el.speedSeg.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) { state.speed = SPEEDS[b.dataset.speed]; render(); } });
el.fec.addEventListener('change', () => { state.fec = Number(el.fec.value); render(); });
el.message.addEventListener('input', render);
el.listenBtn.addEventListener('click', () => receiver.listening ? stopListening() : startListening());
el.sendBtn.addEventListener('click', doSend);
el.replayBtn.addEventListener('click', doReplay);
el.tuneBtn.addEventListener('click', doTune);
el.speaker.addEventListener('change', chooseSpeaker);
el.copyLink.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(el.pairLink.value); el.copyLink.textContent = 'Copied'; }
  catch { el.pairLink.select(); el.copyLink.textContent = 'Press Ctrl+C'; }
  setTimeout(() => { el.copyLink.textContent = 'Copy'; }, 1800);
});
el.usePasted.addEventListener('click', () => {
  const v = el.pasteLink.value.trim(), p = readPairing(v.includes('#') ? v.slice(v.indexOf('#')) : v);
  if (p) { applyPairing({ ...p, role: 'receive' }, { fromPaste: true }); el.pasteLink.value = ''; }
  else el.pasteLink.setCustomValidity('That is not a receiver link.'), el.pasteLink.reportValidity();
});
el.pasteLink.addEventListener('input', () => el.pasteLink.setCustomValidity(''));
el.newSession.addEventListener('click', () => { state.session = newSession(); state.sequence = 1; state.paired = false; receiver.replayCache.clear(); render(); });
el.securityBtn.addEventListener('click', runSecurity);
el.exportBtn.addEventListener('click', () => exportJson(report()));
window.addEventListener('hashchange', () => { const p = readPairing(location.hash); if (p) applyPairing(p); });

// ---------- start ----------
for (const intent of CANONICAL_INTENTS) { const o = document.createElement('option'); o.value = intent; o.textContent = intent; el.intent.appendChild(o); }
el.intent.value = 'communication.message.send';
const fromLink = readPairing(location.hash);
if (fromLink) applyPairing(fromLink); else render();

// Test hook, only on this machine's local server.
if (['127.0.0.1', 'localhost'].includes(location.hostname)) window.__vinac = { state, engine, receiver, send: doSend, replay: doReplay, startListening, stopListening };
