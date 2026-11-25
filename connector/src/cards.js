// Cards (0.14 step 2): structured posts in a conversation or a room. A card travels inside a message's
// args (`args.card`); changes to it (claim, done, an answer) travel as `args.cardUpdate`. In a room both
// ride on agent.room.post; one-to-one they use agent.card.post / agent.card.update. Every device works
// out the same state from the same posts, so there is no server.
//   task      open -> claimed (first claim wins) -> done; reopen / release
//   status    a short status with a level (ok, info, warn, fail)
//   decision  a question with up to 4 options; ONLY a person answers (the page), never an agent
//   key       a key request: the NAME of a key a device needs (never a value), project / environment
//   file      a file offered in a room: name, size, SHA-256 (members fetch it)
//   link      a link (Google Drive, Dropbox, GitHub...), shown as a card; VINAC Link never opens it
import { randomBytes } from 'node:crypto';

export const CARD_POST = 'agent.card.post';
export const CARD_UPDATE = 'agent.card.update';
export const CARD_TYPES = ['task', 'status', 'decision', 'key', 'file', 'link'];
export const CARD_ACTIONS = ['claim', 'release', 'done', 'reopen', 'answer', 'want']; // want: ask the poster for a file card's file
const LEVELS = ['ok', 'info', 'warn', 'fail'];
const CARD_ID = /^[A-Za-z0-9_-]{8,24}$/;
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;

const bad = (msg, fromNetwork) => Object.assign(new Error(fromNetwork ? 'BAD_FIELD' : msg), { status: 400 });
const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const para = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const cardId = () => randomBytes(9).toString('base64url');

/** A safe http(s) link, or throws. */
export function safeUrl(u, fromNetwork) {
  let x;
  try { x = new URL(String(u)); } catch { throw bad('A link must be a full http(s) address.', fromNetwork); }
  if (!/^https?:$/.test(x.protocol) || x.username || x.password || String(u).length > 500) throw bad('A link must be a full http(s) address.', fromNetwork);
  return x.toString();
}

/** Checks and cleans a card (from an agent, the page or another device). */
export function checkCard(c, { fromNetwork = false, newId = false } = {}) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('card must be an object.', fromNetwork);
  const type = String(c.type ?? '');
  if (!CARD_TYPES.includes(type)) throw bad(`card.type must be one of ${CARD_TYPES.join(', ')}.`, fromNetwork);
  const id = newId ? cardId() : String(c.id ?? '');
  if (!CARD_ID.test(id)) throw bad('card.id is missing.', fromNetwork);
  const out = { id, type, title: line(c.title, 200) };
  if (c.body != null && String(c.body).trim()) out.body = para(c.body, 2000);
  if (type === 'status') out.level = LEVELS.includes(c.level) ? c.level : 'info';
  // 0.15 hand-offs between agents: a task may be a review, and may name a git branch and a path in
  // the project folder (where the work is; nothing is copied). Older devices drop these fields.
  if (type === 'task') {
    if (c.review === true) out.review = true;
    if (c.branch != null && line(c.branch, 120)) out.branch = line(c.branch, 120);
    if (c.path != null && line(c.path, 300)) out.path = line(c.path, 300);
  }
  if (type === 'decision') {
    const opts = Array.isArray(c.options) ? c.options.map(o => line(o, 60)).filter(Boolean) : [];
    if (opts.length < 2 || opts.length > 4) throw bad('A decision needs 2 to 4 options.', fromNetwork);
    out.options = [...new Set(opts)];
  }
  if (type === 'key') {
    if (!KEY_NAME.test(String(c.name ?? ''))) throw bad('A key request needs the key NAME (letters, digits, _), never its value.', fromNetwork);
    out.name = String(c.name);
    if (c.project != null && line(c.project, 40)) out.project = line(c.project, 40);
    if (c.env != null && line(c.env, 20)) out.env = line(c.env, 20);
    if (!out.title) out.title = `Needs ${out.name}`;
  }
  if (type === 'link') { out.url = safeUrl(c.url, fromNetwork); if (!out.title) out.title = new URL(out.url).hostname; }
  if (type === 'file') {
    if (!line(c.name, 120)) throw bad('A file card needs the file name.', fromNetwork);
    out.name = line(c.name, 120);
    out.size = Math.max(0, Math.min(Number(c.size) || 0, 1e12));
    if (c.sha256 != null) { if (!SHA.test(String(c.sha256))) throw bad('card.sha256 must be hex.', fromNetwork); out.sha256 = String(c.sha256); }
    if (c.file != null && /^[A-Za-z0-9_-]{8,40}$/.test(String(c.file))) out.file = String(c.file);
    if (!out.title) out.title = out.name;
  }
  if (!out.title) throw bad('A card needs a title.', fromNetwork);
  return out;
}

/** Checks a change to a card. */
export function checkUpdate(u, { fromNetwork = false } = {}) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) throw bad('cardUpdate must be an object.', fromNetwork);
  const card = String(u.card ?? '');
  if (!CARD_ID.test(card)) throw bad('cardUpdate.card must be a card id.', fromNetwork);
  const action = String(u.action ?? '');
  if (!CARD_ACTIONS.includes(action)) throw bad(`cardUpdate.action must be one of ${CARD_ACTIONS.join(', ')}.`, fromNetwork);
  const out = { card, action };
  if (action === 'answer') { out.option = line(u.option, 60); if (!out.option) throw bad('An answer names one of the options.', fromNetwork); }
  if (u.note != null && line(u.note, 200)) out.note = line(u.note, 200);
  return out;
}

/** Plain text for a card, for older devices and agents reading text only. */
export function cardText(c) {
  if (c.type === 'task') return `${c.review ? 'Review' : 'Task'}: ${c.title}${c.branch ? ` (branch ${c.branch})` : ''}${c.path ? ` [${c.path}]` : ''}`;
  if (c.type === 'decision') return `Decision: ${c.title} (${c.options.join(' / ')})`;
  if (c.type === 'key') return `Key request: ${c.name}${c.project ? ` (${c.project}${c.env ? `, ${c.env}` : ''})` : ''}`;
  if (c.type === 'link') return `Link: ${c.title} ${c.url}`;
  if (c.type === 'file') return `File: ${c.name}`;
  return `Status (${c.level}): ${c.title}`;
}
export function updateText(u, title = 'a card') {
  const t = `"${title}"`;
  return { claim: `Claimed ${t}`, release: `Released ${t}`, done: `Done: ${t}`, reopen: `Reopened ${t}`, answer: `Answered ${t}: ${u.option}`, want: `Asked for the file ${t}` }[u.action];
}

/** Who did something, as a short label: "Windows PC" or "Mac › Codex". */
const actor = m => `${m.dir === 'out' || m.dir === 'local' ? 'me' : m.peer?.name || 'a device'}${m.agent?.name ? ` › ${m.agent.name}` : ''}`;

/**
 * Works out every card's state from the stored messages (oldest first).
 * Returns Map(id -> { card, from, at, state, claimedBy, doneBy, answer, answeredBy, updates }).
 */
export function cardStates(messages) {
  const cards = new Map();
  const ups = [];
  const posts = new Set();   // a room post kept here once and sent to N devices counts once
  for (const m of messages) {
    const a = m.args;
    if (!a || (m.firewall && !['allowed', 'approved'].includes(m.firewall.status) && m.dir === 'in')) continue;
    if (m.dir !== 'in' && a.post) { if (posts.has(a.post)) continue; posts.add(a.post); }
    if (a.card && typeof a.card === 'object' && !cards.has(a.card.id)) {
      cards.set(a.card.id, { card: a.card, from: actor(m), at: m.sentAt, state: a.card.type === 'task' ? 'open' : a.card.type === 'decision' ? 'open' : 'posted', claimedBy: null, doneBy: null, answer: null, answeredBy: null, updates: [] });
    }
    if (a.cardUpdate && typeof a.cardUpdate === 'object') ups.push({ u: a.cardUpdate, m });
  }
  ups.sort((x, y) => (x.m.sentAt < y.m.sentAt ? -1 : x.m.sentAt > y.m.sentAt ? 1 : x.m.id < y.m.id ? -1 : 1));
  for (const { u, m } of ups) {
    const c = cards.get(u.card);
    if (!c) continue;
    const who = actor(m);
    c.updates.push({ action: u.action, by: who, person: m.by === 'person', at: m.sentAt, ...(u.option ? { option: u.option } : {}) });
    if (c.card.type === 'task') {
      if (u.action === 'claim' && c.state === 'open') { c.state = 'claimed'; c.claimedBy = who; }
      else if (u.action === 'release' && c.state === 'claimed' && c.claimedBy === who) { c.state = 'open'; c.claimedBy = null; }
      else if (u.action === 'done' && c.state !== 'done') { c.state = 'done'; c.doneBy = who; }
      else if (u.action === 'reopen' && c.state === 'done') { c.state = 'open'; c.claimedBy = null; c.doneBy = null; }
    } else if (c.card.type === 'decision' && u.action === 'answer' && c.state === 'open' && m.by === 'person' && c.card.options.includes(u.option)) {
      c.state = 'answered'; c.answer = u.option; c.answeredBy = who;
    } else if (c.card.type === 'key' && u.action === 'done' && c.state !== 'done') { c.state = 'done'; c.doneBy = who; }
  }
  return cards;
}

/** A card's state for views (page and agents). */
export const stateView = s => ({ ...s.card, from: s.from, at: s.at, state: s.state, ...(s.claimedBy ? { claimedBy: s.claimedBy } : {}), ...(s.doneBy ? { doneBy: s.doneBy } : {}), ...(s.answer ? { answer: s.answer, answeredBy: s.answeredBy } : {}) });
