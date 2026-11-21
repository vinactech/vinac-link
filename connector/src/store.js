// Files under the VINAC Link home folder (default ~/.vinac):
//   identity.json     device name, public key, and the private key as wrapped by the OS key store;
//                     also the X25519 key for Noise (protocol v3), wrapped the same way
//   peers.json        paired devices: public key, network address, and the shared pairing key
//                     as wrapped by the OS key store
//   history.key.json  key for the message history, wrapped by the OS key store
//   messages.enc      sent and received messages, encrypted (AES-256-GCM) with that key
//   secrets.json      received secrets: names and wrapped values (never plain)
//   firewall.json     the person's rules for requests (Logos intents) from paired devices
//   autoreply.json    the person's auto-reply settings (per device; see autoreply.js)
//   autoreply-log.json  the last 100 auto-reply runs (no message text)
//   files/            shared files, encrypted with the history key
//   transfers/        parts of bigger files still arriving, encrypted (removed after an hour)
//   groups.json       names for sets of paired devices (an address book)
//   audit.jsonl       hash-chained log of what happened (no message text; see audit.js)
//   replay.json       ids seen recently, kept for as long as they could still be accepted
//   api-token         lets the local MCP server call the daemon
//   daemon.json       ports of the running daemon
// Writes go to a temporary file first and are then renamed, so a crash never
// leaves half a file. A file that exists but cannot be read is an error, not
// an empty list: VINAC Link stops instead of forgetting its pairings.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { detectKeystore, protect, unprotect } from './keystore.js';
import { newIdentity, exportPrivate, importPrivate, publicFromPrivate, fingerprint, formatFingerprint, b64u, fromB64u, randomBytes } from './crypto.js';
import { env } from './env.js';
import { keyPairFromPrivate as noiseKeyPair, generateKeyPair as generateNoiseKey } from './noise.js';

/** VINAC_HOME, else ~/.vinac (or ~/.agentlink when only that exists, from before the rename). */
export function defaultHome() {
  const set = env('HOME');
  if (set) return set;
  const fresh = path.join(os.homedir(), '.vinac'), older = path.join(os.homedir(), '.agentlink');
  return !fs.existsSync(fresh) && fs.existsSync(older) ? older : fresh;
}

export function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows: ACLs of the user profile apply */ }
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  try { return JSON.parse(text); }
  catch { throw new Error(`${path.basename(file)} is damaged. Move it aside (or restore a backup) and start VINAC Link again.`); }
}

function readJsonSafe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

const HISTORY_LABEL = 'AgentLink history v1';
const FILE_LABEL = 'VINAC Link file v1';
const MAX_MESSAGES = 500;
const MAX_REPLAY = 50_000;

export class Store {
  constructor(home = defaultHome()) {
    this.home = home;
    fs.mkdirSync(home, { recursive: true });
    this.historyKeyCache = null;
  }
  file(name) { return path.join(this.home, name); }

  /** Loads this device's identity, creating it on first run. Fails if the OS key store fails. */
  identity(name = os.hostname()) {
    const file = this.file('identity.json');
    let rec = readJson(file, null);
    let privateKey;
    if (!rec) {
      const id = newIdentity();
      const label = `agentlink.identity.${b64u(fingerprint(id.publicRaw))}`;
      const wrapped = protect(detectKeystore(), label, exportPrivate(id.privateKey));
      rec = { version: 1, name, publicKey: b64u(id.publicRaw), keystore: wrapped.kind, keyLabel: label, wrapped: wrapped.stored, created: new Date().toISOString() };
      writeAtomic(file, JSON.stringify(rec, null, 2));
      privateKey = id.privateKey;
    } else {
      privateKey = importPrivate(unprotect(rec.keystore, rec.keyLabel, rec.wrapped));
    }
    const publicRaw = fromB64u(rec.publicKey);
    if (!publicFromPrivate(privateKey).equals(publicRaw)) throw new Error('Identity key does not match its public key');
    const fp = fingerprint(publicRaw);
    const keystoreNote = rec.keystore === 'file' ? 'Development mode: keys are in a plain user-only file, not an OS key store.' : null;
    return { name: rec.name, privateKey, publicRaw, fp, fpText: formatFingerprint(fp), keystore: rec.keystore, keystoreNote };
  }

  /**
   * This device's X25519 static key for Noise (protocol v3), created the first time it's needed
   * and kept next to the identity, wrapped by the same OS key store.
   */
  noiseKey() {
    const file = this.file('identity.json');
    const rec = readJson(file, null);
    if (!rec) throw new Error('No identity yet');
    if (rec.noise) {
      const kp = noiseKeyPair(unprotect(rec.noise.keystore, rec.noise.keyLabel, rec.noise.wrapped));
      if (!kp.publicRaw.equals(fromB64u(rec.noise.publicKey))) throw new Error('Noise key does not match its public key');
      return kp;
    }
    const kp = generateNoiseKey();
    const label = `agentlink.noise.${b64u(fingerprint(fromB64u(rec.publicKey)))}`;
    const w = protect(detectKeystore(), label, kp.privateRaw);
    rec.noise = { publicKey: b64u(kp.publicRaw), keystore: w.kind, keyLabel: label, wrapped: w.stored, created: new Date().toISOString() };
    writeAtomic(file, JSON.stringify(rec, null, 2));
    return kp;
  }

  peers() { return readJson(this.file('peers.json'), []); }
  savePeers(list) { writeAtomic(this.file('peers.json'), JSON.stringify(list, null, 2)); }

  // ---- message history, encrypted at rest ------------------------------------

  historyKey() {
    if (this.historyKeyCache) return this.historyKeyCache;
    const file = this.file('history.key.json');
    let rec = readJson(file, null);
    let key;
    if (!rec) {
      key = randomBytes(32);
      const label = `agentlink.history.${randomBytes(6).toString('hex')}`;
      const w = protect(detectKeystore(), label, key);
      rec = { keystore: w.kind, keyLabel: label, wrapped: w.stored };
      writeAtomic(file, JSON.stringify(rec));
    } else key = unprotect(rec.keystore, rec.keyLabel, rec.wrapped);
    if (key.length !== 32) throw new Error('history.key.json holds a key of the wrong size');
    return (this.historyKeyCache = key);
  }

  messages() {
    const encFile = this.file('messages.enc');
    if (fs.existsSync(encFile)) {
      const raw = fs.readFileSync(encFile);
      if (raw.length < 28) throw new Error('messages.enc is damaged.');
      const d = crypto.createDecipheriv('aes-256-gcm', this.historyKey(), raw.subarray(0, 12));
      d.setAAD(Buffer.from(HISTORY_LABEL)); d.setAuthTag(raw.subarray(raw.length - 16));
      let plain;
      try { plain = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]); }
      catch { throw new Error('messages.enc could not be decrypted (wrong key or damaged file).'); }
      return JSON.parse(plain.toString('utf8'));
    }
    // Older versions kept plain JSON: move it into the encrypted file once.
    const old = readJson(this.file('messages.json'), null);
    if (old) { this.saveMessages(old); fs.rmSync(this.file('messages.json'), { force: true }); return old.slice(-MAX_MESSAGES); }
    return [];
  }

  saveMessages(list) {
    const nonce = randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.historyKey(), nonce);
    c.setAAD(Buffer.from(HISTORY_LABEL));
    const body = Buffer.concat([c.update(JSON.stringify(list.slice(-MAX_MESSAGES))), c.final()]);
    writeAtomic(this.file('messages.enc'), Buffer.concat([nonce, body, c.getAuthTag()]));
    this.onMessagesSaved?.();
  }

  // ---- shared files (document.file.share), encrypted with the history key ----

  fileId() { return randomBytes(12).toString('hex'); }
  filePath(id) {
    if (!/^[0-9a-f]{24}$/.test(String(id))) throw Object.assign(new Error('Bad file id'), { status: 400 });
    return path.join(this.home, 'files', `${id}.enc`);
  }
  saveFile(id, bytes) {
    fs.mkdirSync(path.join(this.home, 'files'), { recursive: true });
    const nonce = randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.historyKey(), nonce);
    c.setAAD(Buffer.from(`${FILE_LABEL}|${id}`));
    writeAtomic(this.filePath(id), Buffer.concat([nonce, c.update(bytes), c.final(), c.getAuthTag()]));
  }
  readFile(id) {
    const raw = fs.readFileSync(this.filePath(id));
    const d = crypto.createDecipheriv('aes-256-gcm', this.historyKey(), raw.subarray(0, 12));
    d.setAAD(Buffer.from(`${FILE_LABEL}|${id}`)); d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]);
  }
  // ---- parts of a bigger file on its way in (transfers/<peer>-<transfer>/<i>.enc) ----

  partDir(peerId, t) {
    if (!/^[0-9a-f]{16}$/.test(String(peerId)) || !/^[A-Za-z0-9_-]{16}$/.test(String(t))) throw Object.assign(new Error('Bad transfer'), { status: 400 });
    // hex, so two ids that differ only in letter case never share a folder (Windows, macOS)
    return path.join(this.home, 'transfers', `${peerId}-${Buffer.from(t, 'base64url').toString('hex')}`);
  }
  savePart(peerId, t, i, n, bytes) {
    const dir = this.partDir(peerId, t);
    fs.mkdirSync(dir, { recursive: true });
    const meta = path.join(dir, 'parts.json');
    if (!fs.existsSync(meta)) writeAtomic(meta, JSON.stringify({ n, started: Date.now() }));
    else if (readJson(meta, {}).n !== n) throw Object.assign(new Error('BAD_FIELD'), { status: 400 });
    const nonce = randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.historyKey(), nonce);
    c.setAAD(Buffer.from(`${FILE_LABEL}|part|${peerId}|${t}|${i}|${n}`));
    writeAtomic(path.join(dir, `${i}.enc`), Buffer.concat([nonce, c.update(bytes), c.final(), c.getAuthTag()]));
  }
  hasParts(peerId, t) { return fs.existsSync(this.partDir(peerId, t)); }
  openTransfers(peerId) {
    try { return fs.readdirSync(path.join(this.home, 'transfers')).filter(d => d.startsWith(`${peerId}-`)).length; } catch { return 0; }
  }
  /** All parts in order, or null if any is missing. */
  assembleParts(peerId, t, n) {
    const dir = this.partDir(peerId, t);
    if (readJson(path.join(dir, 'parts.json'), {}).n !== n) return null;
    const out = [];
    for (let i = 0; i < n; i++) {
      let raw;
      try { raw = fs.readFileSync(path.join(dir, `${i}.enc`)); } catch { return null; }
      const d = crypto.createDecipheriv('aes-256-gcm', this.historyKey(), raw.subarray(0, 12));
      d.setAAD(Buffer.from(`${FILE_LABEL}|part|${peerId}|${t}|${i}|${n}`));
      try { d.setAuthTag(raw.subarray(raw.length - 16)); out.push(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()])); }
      catch { return null; }
    }
    return Buffer.concat(out);
  }
  dropParts(peerId, t) { fs.rmSync(this.partDir(peerId, t), { recursive: true, force: true }); }
  /** Removes transfers that never finished. */
  pruneParts(maxAgeMs) {
    const root = path.join(this.home, 'transfers');
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch { return; }
    for (const d of dirs) {
      const started = readJsonSafe(path.join(root, d, 'parts.json'))?.started || 0;
      if (Date.now() - started > maxAgeMs) fs.rmSync(path.join(root, d), { recursive: true, force: true });
    }
  }

  /** Groups: name -> paired device ids (an address book; see Daemon.targets). */
  groups() { const g = readJson(this.file('groups.json'), { v: 1, groups: {} }); return g.groups && typeof g.groups === 'object' ? g.groups : {}; }
  saveGroups(groups) { writeAtomic(this.file('groups.json'), JSON.stringify({ v: 1, groups }, null, 1)); }

  /** Removes stored files that no message refers to any more (history keeps the last 500). */
  pruneFiles(keepIds) {
    const dir = path.join(this.home, 'files');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.enc') && !keepIds.has(f.slice(0, -4))) fs.rmSync(path.join(dir, f), { force: true });
  }

  // ---- secrets and replay protection ----------------------------------------

  /** Received secrets: names and wrapped values (never plain). */
  secrets() { const s = readJson(this.file('secrets.json'), { items: [] }); return { items: s.items || [] }; }
  saveSecrets(s) { writeAtomic(this.file('secrets.json'), JSON.stringify({ items: s.items }, null, 1)); }

  /** Firewall rules for requests from paired devices (see firewall.js). */
  /** The vault lock record (see vault.js), or null when the vault has no passphrase. */
  vault() { return readJson(this.file('vault.json'), null); }
  saveVault(r) { const f = this.file('vault.json'); if (r) writeAtomic(f, JSON.stringify(r, null, 1)); else fs.rmSync(f, { force: true }); }

  // rules: the person's rules; modes: restricted/standard/auto per device or '*'; temporary: "allow for a while" (intent -> until, ms).
  firewall() { const f = readJson(this.file('firewall.json'), { v: 1, rules: {} }); return { v: 1, rules: f.rules || {}, modes: f.modes || {}, temporary: f.temporary || {} }; }
  saveFirewall(f) { writeAtomic(this.file('firewall.json'), JSON.stringify({ v: 1, rules: f.rules, modes: f.modes || {}, temporary: f.temporary || {} }, null, 1)); }

  /**
   * Remembers an id until `expiresAt` (ms). Returns false if it was already
   * there and still valid (a replay). Kept for the whole acceptance window,
   * not for a fixed number of entries.
   */
  rememberOnce(key, expiresAt) {
    const file = this.file('replay.json');
    const now = Date.now();
    const seen = readJson(file, {});
    for (const k of Object.keys(seen)) if (seen[k] < now) delete seen[k];
    if (seen[key] && seen[key] >= now) return false;
    if (Object.keys(seen).length >= MAX_REPLAY) throw Object.assign(new Error('Too many recent items; try again later.'), { status: 429 });
    seen[key] = expiresAt;
    writeAtomic(file, JSON.stringify(seen));
    return true;
  }

  apiToken() {
    const file = this.file('api-token');
    try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
    const token = b64u(randomBytes(24));
    writeAtomic(file, token);
    return token;
  }

  daemonInfo() { try { return readJson(this.file('daemon.json'), null); } catch { return null; } }
  saveDaemonInfo(info) { writeAtomic(this.file('daemon.json'), JSON.stringify(info)); }
}
