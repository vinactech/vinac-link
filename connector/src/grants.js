// Agent identities and standing key grants (0.11).
//
// Agent identities: a person adds an agent on the page ("Codex on the Mac") and gets a token for
// it, shown once (only its SHA-256 is kept). Requests made with that token carry the agent's name
// into the audit log, and a grant can be limited to that agent. Agents can't create identities.
// Like every token on this computer, a same-user program that can read the agent's settings can
// use it: identities are for accountability and narrower grants, not a wall between programs.
//
// Standing grants: instead of approving every `vinac run`, the person allows ONE agent to run ONE
// command (exactly, or that command plus any further arguments) in ONE folder (and its subfolders)
// with named keys, until a set time (at most 7 days). A run under a grant is started by the
// VINAC Link service itself, so the values never pass through the agent or its API; the program's
// output comes back with the values hidden. A grant can't be used while the vault is locked, the
// person can revoke it at any time, and every use is audited. Whatever the allowed command runs
// gets the keys (for example the scripts in that folder's package.json), so allow only commands
// and folders you trust.
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { redactor } from './redact.js';

export const MAX_AGENTS = 20;
export const MAX_GRANTS = 50;
export const GRANT_HOURS = [1, 8, 24, 168];   // the choices the page offers; 168 h = 7 days
export const MAX_GRANT_HOURS = 168;

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
/** An agent's fingerprint for the page, the audit log and reports: from its token's hash (never the token). */
export const agentFingerprint = hash => `AGT-${String(hash).slice(0, 16).toUpperCase().match(/..../g).join('-')}`;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- agent identities ----------------------------------------------------------------

export class Agents {
  constructor(store) { this.store = store; this.seen = new Map(); }

  list() { return this.store.agents(); }
  view() { return this.list().map(({ id, name, hash, createdAt, lastSeenAt }) => ({ id, name, fingerprint: agentFingerprint(hash), createdAt, lastSeenAt: this.seen.get(id) || lastSeenAt || null })); }

  /** The page adds an agent: returns its token ONCE. */
  add(name) {
    const n = cleanName(name).slice(0, 40);
    if (!n) throw httpError(400, 'Give the agent a name, for example "Codex on the Mac".');
    const list = this.list();
    if (list.length >= MAX_AGENTS) throw httpError(409, `At most ${MAX_AGENTS} agents. Remove one first.`);
    if (list.some(a => a.name.toLowerCase() === n.toLowerCase())) throw httpError(409, `There is already an agent called "${n}".`);
    const token = `agt_${crypto.randomBytes(32).toString('base64url')}`;
    const agent = { id: crypto.randomBytes(6).toString('hex'), name: n, hash: sha256(token), createdAt: new Date().toISOString(), lastSeenAt: null };
    this.store.saveAgents([...list, agent]);
    return { agent: { id: agent.id, name: agent.name, fingerprint: agentFingerprint(agent.hash), createdAt: agent.createdAt }, token };
  }

  /** The page connects an agent app (0.15): that app's identity by name, made now or given a fresh token (same id, so its grants stay). */
  identityFor(name) {
    const list = this.list();
    const a = list.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (!a) return this.add(name);
    const token = `agt_${crypto.randomBytes(32).toString('base64url')}`;
    a.hash = sha256(token);
    this.store.saveAgents(list);
    return { agent: { id: a.id, name: a.name, fingerprint: agentFingerprint(a.hash), createdAt: a.createdAt }, token };
  }

  remove(id) {
    const list = this.list();
    const a = list.find(x => x.id === String(id));
    if (!a) throw httpError(404, 'No such agent.');
    this.store.saveAgents(list.filter(x => x !== a));
    return { id: a.id, name: a.name };
  }

  /** The agent a token belongs to, or null. */
  byToken(token) {
    if (typeof token !== 'string' || !token.startsWith('agt_')) return null;
    const h = Buffer.from(sha256(token), 'hex');
    const a = this.list().find(x => { const b = Buffer.from(String(x.hash), 'hex'); return b.length === h.length && crypto.timingSafeEqual(b, h); });
    if (!a) return null;
    this.touch(a);
    return { id: a.id, name: a.name, fp: agentFingerprint(a.hash) };
  }

  /** "Last seen" for the page; written to disk at most every 10 minutes. */
  touch(a) {
    const now = new Date();
    this.seen.set(a.id, now.toISOString());
    if (!a.lastSeenAt || now - new Date(a.lastSeenAt) > 10 * 60_000) {
      const list = this.list();
      const x = list.find(y => y.id === a.id);
      if (x) { x.lastSeenAt = now.toISOString(); this.store.saveAgents(list); }
    }
  }
}

// ---- standing grants -----------------------------------------------------------------

const norm = p => { const r = path.resolve(String(p || '')); return process.platform === 'win32' ? r.toLowerCase() : r; };

/** True if `cwd` is `folder` or inside it. */
export function insideFolder(folder, cwd) {
  if (!folder || !cwd || !path.isAbsolute(String(folder)) || !path.isAbsolute(String(cwd))) return false;
  const rel = path.relative(norm(folder), norm(cwd));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Exact command, or (with `prefix`) the command followed by more arguments. */
export function commandMatches(grant, command) {
  return command === grant.command || (grant.prefix && command.startsWith(`${grant.command} `));
}

export class Grants {
  constructor(store) { this.store = store; }

  /** Live grants; expired ones are dropped. */
  active() {
    const list = this.store.grants();
    const live = list.filter(g => new Date(g.expiresAt).getTime() > Date.now());
    if (live.length !== list.length) this.store.saveGrants(live);
    return live;
  }

  view(agentId) {
    return this.active().filter(g => agentId === undefined || (g.agentId ?? null) === (agentId ?? null))
      .map(({ id, agentId: a, agentName, names, command, prefix, cwd, createdAt, expiresAt, uses, lastUsedAt }) => ({ id, agentId: a ?? null, agentName, names, command, prefix: !!prefix, cwd, createdAt, expiresAt, uses: uses || 0, lastUsedAt: lastUsedAt || null }));
  }

  /** Made by the person on the page (never by an agent). */
  add({ agentId = null, agentName, names, command, cwd, hours, prefix = false }) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0 || h > MAX_GRANT_HOURS) throw httpError(400, `A grant lasts at most ${MAX_GRANT_HOURS} hours (7 days).`);
    if (!Array.isArray(names) || !names.length || names.length > 10) throw httpError(400, 'Name 1 to 10 secrets.');
    const cmd = cleanName(command).slice(0, 400);
    if (!cmd) throw httpError(400, 'A grant needs the exact command.');
    if (!cwd || !path.isAbsolute(String(cwd))) throw httpError(400, 'A grant needs the folder the command runs in.');
    const list = this.active();
    if (list.length >= MAX_GRANTS) throw httpError(409, `At most ${MAX_GRANTS} allowed runs. Revoke one first.`);
    const g = {
      id: crypto.randomBytes(6).toString('hex'), agentId: agentId ?? null, agentName: agentName || 'this computer\'s agents',
      names: [...new Set(names.map(String))], command: cmd, prefix: !!prefix, cwd: path.resolve(String(cwd)),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + h * 3600_000).toISOString(), uses: 0, lastUsedAt: null,
    };
    this.store.saveGrants([...list, g]);
    return g;
  }

  revoke(id) {
    const list = this.active();
    const g = list.find(x => x.id === String(id));
    if (!g) throw httpError(404, 'No such allowed run (it may have expired).');
    this.store.saveGrants(list.filter(x => x !== g));
    return g;
  }

  /** The grant that allows this run, if any: same agent, all names covered, command and folder. */
  match({ agentId = null, names, command, cwd }) {
    return this.active().find(g => (g.agentId ?? null) === (agentId ?? null)
      && names.every(n => g.names.includes(n)) && commandMatches(g, command) && insideFolder(g.cwd, cwd)) || null;
  }

  used(id) {
    const list = this.active();
    const g = list.find(x => x.id === id);
    if (g) { g.uses = (g.uses || 0) + 1; g.lastUsedAt = new Date().toISOString(); this.store.saveGrants(list); }
  }
}

// ---- a run started by the service --------------------------------------------------

/** Where command-line tools usually live, added to the service's own PATH (never the agent's). */
export function runPath(extraDirs = []) {
  const sep = process.platform === 'win32' ? ';' : ':';
  return [...new Set([...(process.env.PATH || process.env.Path || '').split(sep), ...extraDirs].filter(Boolean))].join(sep);
}

/**
 * Starts `argv` in `cwd` with `values` in its environment (as `envNames[name]`), no stdin.
 * Output goes through the redactor to `onData(stream, text)`; `onExit(code)` at the end.
 * Returns a stop() that ends the program (and its children on Windows).
 */
export function startRun({ argv, cwd, values, envNames, extraDirs = [], onData, onExit }) {
  const env = { ...process.env, PATH: runPath(extraDirs) };
  if (process.platform === 'win32') delete env.Path;
  for (const [name, value] of Object.entries(values)) env[envNames[name] || name] = value;
  const [cmd, ...args] = argv;
  const winQuote = a => (/^[\w./:=@+\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  const child = process.platform === 'win32'
    ? spawn(argv.map(winQuote).join(' '), { cwd, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let open = 2, code = null, ended = false;
  const finish = () => { if (!ended && open === 0 && code !== null) { ended = true; onExit(code); } };
  for (const stream of ['stdout', 'stderr']) {
    const dec = new StringDecoder('utf8');
    const r = redactor(values);
    child[stream].pipe(r);
    r.on('data', b => { const t = dec.write(b); if (t) onData(stream, t); });
    r.on('end', () => { const t = dec.end(); if (t) onData(stream, t); open--; finish(); });
  }
  child.on('error', e => { onData('stderr', `vinac: could not start ${cmd}: ${e.message}\n`); code = 127; open = 0; finish(); });
  child.on('close', c => { code = c ?? 1; finish(); });
  return {
    stop() {
      if (child.exitCode !== null || child.killed) return;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
    },
  };
}
