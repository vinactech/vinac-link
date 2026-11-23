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
const ANCHOR = 'audit-anchor.json';
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
      // Rotate when the file is big, or when a new month starts (so retention can remove whole months).
      try {
        const big = fs.statSync(this.file).size > MAX_BYTES;
        const first = big ? null : readFirstLine(this.file);
        const month = first ? JSON.parse(first).at?.slice(0, 7) : null;
        if (big || (month && month !== entry.at.slice(0, 7))) fs.renameSync(this.file, path.join(this.home, `audit-${stamp()}.jsonl`));
      } catch { /* no file yet */ }
      fs.appendFileSync(this.file, JSON.stringify({ ...entry, prev, hash }) + '\n', { mode: 0o600 });
      this.last = hash;
      return { ...entry, prev, hash };
    } catch { return null; }
  }

  /** The newest `n` entries (current file only). */
  tail(n = 50) {
    return readLines(this.file).slice(-n).map(l => { try { return JSON.parse(l); } catch { return { damaged: true }; } });
  }

  /** Every entry, oldest first, across rotated files and the current one. */
  *entries() {
    for (const f of [...this.rotatedFiles(), this.file]) {
      for (const l of readLines(f)) { try { yield JSON.parse(l); } catch { yield { damaged: true }; } }
    }
  }

  /**
   * Retention: removes whole rotated files whose newest entry is older than `before` (a Date).
   * The chain still verifies: anchor.json keeps the hash the first kept line follows, and an
   * `audit.pruned` entry records what was removed. Returns the number of entries removed.
   */
  pruneBefore(before) {
    const files = this.rotatedFiles();
    let removed = 0, lastHash = null, until = null;
    const gone = [];
    for (const f of files) {
      const lines = readLines(f);
      const last = lines.length ? JSON.parse(lines.at(-1)) : null;
      if (!last || new Date(last.at) >= before) break;
      removed += lines.length; lastHash = last.hash; until = last.at; gone.push(f);
    }
    if (!gone.length) return 0;
    const anchor = this.anchor();
    fs.writeFileSync(path.join(this.home, ANCHOR), JSON.stringify({ prev: lastHash, removedUntil: until, removedEntries: (anchor?.removedEntries || 0) + removed }), { mode: 0o600 });
    for (const f of gone) fs.rmSync(f, { force: true });
    this.add('audit.pruned', { entries: removed, until });
    return removed;
  }

  anchor() { try { return JSON.parse(fs.readFileSync(path.join(this.home, ANCHOR), 'utf8')); } catch { return null; } }

  /** Checks every line in every file, oldest first (from the retention anchor, if older lines were removed). */
  verify() {
    let prev = this.anchor()?.prev || GENESIS, count = 0;
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

function readFirstLine(file) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); const s = b.subarray(0, n).toString('utf8'); const i = s.indexOf('\n'); return i > 0 ? s.slice(0, i) : null; }
  finally { fs.closeSync(fd); }
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
