// The audit log: one line per event (pairing, unpairing, message sent or
// received, firewall decision, secret moved or revealed, rule changed, file
// saved, auto-reply run, secret used by `vinac run`). Never message text, args,
// file contents or secret values: only who, what kind, which id, how big, and
// what the firewall did.
//
// Each line carries the SHA-256 of the line before it (`prev`) and its own
// (`hash`), so editing or deleting a past line breaks the chain from there on,
// and `vinac audit --verify` says where. A program running as this user could
// still rewrite the whole file; keep the latest hash somewhere else (print it,
// export the log) to detect that too.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const FILE = 'audit.jsonl';
const GENESIS = '0'.repeat(64);
const MAX_BYTES = 8 * 1024 * 1024; // then the file is rotated to audit-<date>.jsonl, chain continues

const hashOf = (prev, body) => createHash('sha256').update(prev).update('\n').update(body).digest('hex');

export class AuditLog {
  constructor(home) { this.home = home; this.file = path.join(home, FILE); this.last = null; }

  /** Hash of the newest line (or the chain start). */
  head() {
    if (this.last) return this.last;
    const lines = readLines(this.file);
    if (lines.length) { try { return (this.last = JSON.parse(lines.at(-1)).hash); } catch { /* damaged: verify reports it */ } }
    const rotated = this.rotatedFiles().at(-1);
    if (rotated) { const l = readLines(rotated); try { return (this.last = JSON.parse(l.at(-1)).hash); } catch { /* idem */ } }
    return GENESIS;
  }

  rotatedFiles() {
    try { return fs.readdirSync(this.home).filter(f => /^audit-\d{8}T\d{6}\.jsonl$/.test(f)).sort().map(f => path.join(this.home, f)); }
    catch { return []; }
  }

  /** Appends one event. Never throws (the log must not stop the service); returns the entry or null. */
  add(type, fields = {}) {
    try {
      const prev = this.head();
      const entry = { at: new Date().toISOString(), type, ...clean(fields) };
      const body = JSON.stringify(entry);
      const hash = hashOf(prev, body);
      try { if (fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, path.join(this.home, `audit-${stamp()}.jsonl`)); } catch { /* no file yet */ }
      fs.appendFileSync(this.file, JSON.stringify({ ...entry, prev, hash }) + '\n', { mode: 0o600 });
      this.last = hash;
      return { ...entry, prev, hash };
    } catch { return null; }
  }

  /** The newest `n` entries (current file only). */
  tail(n = 50) {
    return readLines(this.file).slice(-n).map(l => { try { return JSON.parse(l); } catch { return { damaged: true }; } });
  }

  /** Checks every line in every file, oldest first. */
  verify() {
    let prev = GENESIS, count = 0;
    for (const f of [...this.rotatedFiles(), this.file]) {
      const lines = readLines(f);
      for (let i = 0; i < lines.length; i++) {
        let e;
        try { e = JSON.parse(lines[i]); } catch { return { ok: false, count, file: path.basename(f), line: i + 1, problem: 'not valid JSON' }; }
        const { prev: p, hash, ...entry } = e;
        if (p !== prev) return { ok: false, count, file: path.basename(f), line: i + 1, problem: 'does not follow the line before it (a line was removed or changed)' };
        if (hashOf(p, JSON.stringify(entry)) !== hash) return { ok: false, count, file: path.basename(f), line: i + 1, problem: 'was changed after it was written' };
        prev = hash; count++;
      }
    }
    return { ok: true, count, head: prev };
  }
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
}
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15); }
/** Short scalar fields only; nested objects become {id, name}. */
function clean(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) r[k] = { ...(v.id ? { id: String(v.id) } : {}), ...(v.name ? { name: String(v.name).slice(0, 64) } : {}) };
    else if (Array.isArray(v)) r[k] = v.slice(0, 20).map(x => String(x).slice(0, 120));
    else r[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return r;
}
