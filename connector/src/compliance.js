// Compliance (0.11): the audit log made usable for a company. Search and filters, CSV / JSON
// exports, a period report signed with this device's Ed25519 identity key, and retention with a
// legal hold. Built on audit.js (hash-chained lines). Never contents, args or secret values.
//
// Who did it: each entry is classed as done by the person (on this device's page), an agent (an
// agent identity, or this computer's default agent token), another device, or the service itself.
import crypto from 'node:crypto';
import { sign, verify as verifySig } from './crypto.js';

export const REPORT_LABEL = 'VINAC Link audit report v1';

export const CATEGORIES = {
  pairing: { label: 'Pairing and devices', types: ['pair', 'unpair', 'invite.created', 'phone.paired', 'phone.removed', 'protocol'] },
  messages: { label: 'Messages', types: ['msg.in', 'msg.out', 'msg.queued', 'msg.cancelled'] },
  requests: { label: 'Requests and approvals', types: ['request.decided', 'request.expired'] },
  secrets: { label: 'Secrets', types: ['secret.in', 'secret.out', 'secret.added', 'secret.accepted', 'secret.revealed'] },
  runs: { label: 'Key use, grants', types: ['secret.used', 'secret.use.denied', 'grant.created', 'grant.revoked'] },
  agents: { label: 'Agents', types: ['agent.added', 'agent.removed'] },
  files: { label: 'Files', types: ['file.saved'] },
  settings: { label: 'Settings and vault', types: ['mode.changed', 'rule.changed', 'autoreply.changed', 'temporary.cleared', 'vault.locked', 'vault.unlocked', 'vault.passphrase.set', 'vault.passphrase.removed', 'retention.changed'] },
  log: { label: 'The log itself', types: ['audit.exported', 'audit.pruned', 'report.created'] },
};
const CATEGORY_OF = Object.fromEntries(Object.entries(CATEGORIES).flatMap(([c, { types }]) => types.map(t => [t, c])));
export const categoryOf = type => CATEGORY_OF[type] || 'other';

// Decisions and settings only a person can make, on this device's page.
const BY_PERSON = new Set(['pair', 'invite.created', 'phone.paired', 'phone.removed', 'request.decided', 'secret.added', 'secret.accepted', 'secret.revealed',
  'secret.use.denied', 'grant.created', 'grant.revoked', 'agent.added', 'agent.removed', 'mode.changed', 'rule.changed', 'autoreply.changed', 'temporary.cleared',
  'vault.locked', 'vault.unlocked', 'vault.passphrase.set', 'vault.passphrase.removed', 'retention.changed', 'audit.exported', 'report.created', 'secret.out']);

/** { kind: 'person' | 'agent' | 'device' | 'service', name } */
export function actorOf(e) {
  if (e.type === 'secret.used') return e.via === 'grant' ? { kind: 'agent', name: e.agent || 'agent' } : { kind: 'person', name: `approved by the person${e.agent ? ` for ${e.agent}` : ''}` };
  if (BY_PERSON.has(e.type)) return { kind: 'person', name: 'the person (this page)' };
  if (e.type === 'msg.out') return e.by === 'person' ? { kind: 'person', name: 'the person (this page)' } : { kind: 'agent', name: e.agent || 'agent' };
  if (e.type === 'msg.in' && e.agent) return { kind: 'device', name: `${e.peer?.name || 'a paired device'} › agent ${e.agent}` };
  if (e.type === 'msg.in' || e.type === 'secret.in' || e.type === 'unpair') return { kind: 'device', name: e.peer?.name || e.phone || 'a paired device' };
  if (e.type === 'file.saved') return { kind: 'agent', name: e.agent || 'agent' };
  return { kind: 'service', name: 'VINAC Link' };
}

const deviceOf = e => e.peer?.name || e.phone || e.from?.name || null;

/** Filters: from, to (ISO dates or yyyy-mm-dd), category, who (person/agent/device/service), agent, device, q. */
export function matches(e, f) {
  if (e.damaged) return !f.category && !f.q;
  if (f.from && e.at < f.from) return false;
  if (f.to && e.at > (f.to.length === 10 ? `${f.to}T23:59:59.999Z` : f.to)) return false;
  if (f.category && categoryOf(e.type) !== f.category) return false;
  const who = actorOf(e);
  if (f.who && who.kind !== f.who) return false;
  if (f.agent && (e.agent || '').toLowerCase() !== f.agent.toLowerCase()) return false;
  if (f.device && (deviceOf(e) || '').toLowerCase() !== f.device.toLowerCase()) return false;
  if (f.q) {
    const { prev, hash, ...rest } = e;
    if (!JSON.stringify(rest).toLowerCase().includes(String(f.q).toLowerCase())) return false;
  }
  return true;
}

/** Newest first, with the totals for the filter. */
export function query(audit, f = {}, { limit = 200, offset = 0 } = {}) {
  const all = [...audit.entries()].filter(e => matches(e, f));
  const total = all.length;
  const page = all.reverse().slice(offset, offset + Math.min(1000, limit)).map(view);
  const agents = new Set(), devices = new Set();
  for (const e of audit.entries()) { if (e.agent) agents.add(e.agent); const d = deviceOf(e); if (d) devices.add(d); }
  return { total, entries: page, agents: [...agents].sort(), devices: [...devices].sort() };
}

export function view(e) {
  if (e.damaged) return { damaged: true };
  const { at, type, prev, hash, ...fields } = e;
  return { at, type, category: categoryOf(type), who: actorOf(e), device: deviceOf(e), fields, hash };
}

// ---- exports and the signed report ------------------------------------------------------

const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function toCsv(entries) {
  const head = ['time (UTC)', 'event', 'category', 'who', 'actor', 'agent', 'device', 'keys', 'command', 'details', 'hash'];
  const rows = entries.map(e => {
    if (e.damaged) return ['', 'damaged line', '', '', '', '', '', '', '', '', ''];
    const { names, name, command, agent, ...rest } = e.fields;
    return [e.at, e.type, e.category, e.who.kind, e.who.name, agent || '', e.device || '', (names || (name ? [name] : [])).join(' '), command || '', JSON.stringify(rest), e.hash];
  });
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');

/**
 * A report over a period (oldest first), signed with the device's identity key. Anyone with the
 * device's public key (in the report, and shown as its fingerprint on the page) can check that
 * nothing was changed: `vinac audit --check-report report.json`.
 */
export function buildReport({ audit, device, privateKey, publicRaw, filters = {} }) {
  const entries = [...audit.entries()].filter(e => matches(e, filters));
  const chain = audit.verify();
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  const summary = { total: entries.length, byCategory: {}, byWho: {}, byAgent: {}, keysUsed: {}, grants: { created: 0, revoked: 0 }, approvals: 0, denials: 0 };
  for (const e of entries) {
    if (e.damaged) continue;
    const c = categoryOf(e.type), w = actorOf(e).kind;
    summary.byCategory[c] = (summary.byCategory[c] || 0) + 1;
    summary.byWho[w] = (summary.byWho[w] || 0) + 1;
    if (e.agent) summary.byAgent[e.agent] = (summary.byAgent[e.agent] || 0) + 1;
    if (e.type === 'secret.used') for (const n of e.names || []) summary.keysUsed[n] = (summary.keysUsed[n] || 0) + 1;
    if (e.type === 'grant.created') summary.grants.created++;
    if (e.type === 'grant.revoked') summary.grants.revoked++;
    if (e.type === 'request.decided') { if (e.status === 'approved') summary.approvals++; else summary.denials++; }
    if (e.type === 'secret.use.denied') summary.denials++;
  }
  const header = {
    label: REPORT_LABEL, device: { name: device.name, fingerprint: device.fingerprint, publicKey: Buffer.from(publicRaw).toString('base64url') },
    generatedAt: new Date().toISOString(), filters, count: entries.length, entriesSha256: sha256hex(lines),
    chain: { ok: chain.ok, head: chain.ok ? chain.head : null, checked: chain.count, problem: chain.ok ? null : `${chain.file} line ${chain.line}: ${chain.problem}` },
  };
  const signature = Buffer.from(sign(privateKey, statement(header))).toString('base64url');
  return { ...header, signature, summary, entries };
}

function statement(h) {
  return [h.label, h.device.fingerprint, h.device.publicKey, h.generatedAt, JSON.stringify(h.filters), h.count, h.entriesSha256, h.chain.ok, h.chain.head || ''].join('\n');
}

/** Checks a report: the signature, and that the entries are the ones signed (and still chain). */
export function checkReport(report) {
  try {
    const lines = report.entries.map(e => JSON.stringify(e)).join('\n');
    if (sha256hex(lines) !== report.entriesSha256) return { ok: false, problem: 'The entries were changed after the report was signed.' };
    if (!verifySig(Buffer.from(report.device.publicKey, 'base64url'), statement(report), Buffer.from(report.signature, 'base64url'))) return { ok: false, problem: 'The signature does not match (changed, or not signed by this device).' };
    for (let i = 1; i < report.entries.length; i++) {
      const a = report.entries[i - 1], b = report.entries[i];
      if (!report.filters || Object.keys(report.filters).length === 0) if (b.prev !== a.hash) return { ok: false, problem: `Entry ${i + 1} does not follow the one before it.` };
    }
    return { ok: true, device: report.device, count: report.count, generatedAt: report.generatedAt, chainOk: report.chain.ok };
  } catch (e) { return { ok: false, problem: `Not a VINAC Link report (${e.message}).` }; }
}

// ---- retention ---------------------------------------------------------------------------

export const RETENTION_CHOICES = [90, 365, 730, 2555, 0]; // days; 0 = keep everything
export const DEFAULT_RETENTION = { keepDays: 365, legalHold: false };

/** Applies the retention setting (never while a legal hold is on). Returns entries removed. */
export function applyRetention(audit, setting) {
  const s = { ...DEFAULT_RETENTION, ...setting };
  if (s.legalHold || !s.keepDays) return 0;
  return audit.pruneBefore(new Date(Date.now() - s.keepDays * 86_400_000));
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** A printable page for the report (the JSON is the proof; this is for people). */
export function reportHtml(r) {
  const when = iso => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const table = (title, obj) => Object.keys(obj).length ? `<h2>${esc(title)}</h2><table>${Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`).join('')}</table>` : '';
  const rows = r.entries.slice(-2000).reverse().map(e => {
    if (e.damaged) return '<tr><td colspan="5">damaged line</td></tr>';
    const v = view(e); const { names, name, command } = v.fields;
    return `<tr><td>${esc(when(v.at))}</td><td>${esc(v.type)}</td><td>${esc(v.who.name)}</td><td>${esc(v.device || '')}</td><td>${esc([...(names || (name ? [name] : [])), command || ''].filter(Boolean).join(' · '))}</td></tr>`;
  }).join('');
  const period = [r.filters.from && `from ${r.filters.from}`, r.filters.to && `to ${r.filters.to}`].filter(Boolean).join(' ') || 'all retained entries';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>VINAC Link audit report · ${esc(r.device.name)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:32px;max-width:1000px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}
.meta{color:#555}table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}td.n{text-align:right;width:80px}
.sig{font:12px ui-monospace,monospace;word-break:break-all;background:#f5f5f8;padding:10px;border-radius:6px}.ok{color:#0a7a3e;font-weight:700}.bad{color:#b00020;font-weight:700}
@media print{button{display:none}body{margin:12mm}}</style></head><body>
<button onclick="print()">Print or save as PDF</button>
<h1>Audit report: ${esc(r.device.name)}</h1>
<p class="meta">Device fingerprint ${esc(r.device.fingerprint)} · ${esc(period)} · ${r.count} entries · generated ${esc(when(r.generatedAt))}</p>
<p>Chain: ${r.chain.ok ? `<span class="ok">intact</span> (${r.chain.checked} lines checked)` : `<span class="bad">broken</span>: ${esc(r.chain.problem)}`}. Contents of messages, request arguments, files and secret values are never logged.</p>
${table('By category', Object.fromEntries(Object.entries(r.summary.byCategory).map(([k, v]) => [CATEGORIES[k]?.label || k, v])))}
${table('By who', r.summary.byWho)}${table('By agent', r.summary.byAgent)}${table('Keys used by programs', r.summary.keysUsed)}
<h2>Decisions</h2><table><tr><td>Grants created / revoked</td><td class="n">${r.summary.grants.created} / ${r.summary.grants.revoked}</td></tr><tr><td>Requests approved / denied</td><td class="n">${r.summary.approvals} / ${r.summary.denials}</td></tr></table>
<h2>Entries (newest first${r.entries.length > 2000 ? ', last 2000; the JSON has all' : ''})</h2>
<table><tr><th>Time</th><th>Event</th><th>Who</th><th>Device</th><th>Keys / command</th></tr>${rows}</table>
<h2>Signature</h2><p>Signed with this device's Ed25519 identity key. Check the JSON export with <code>vinac audit --check-report report.json</code>.</p>
<p class="sig">entries SHA-256 ${esc(r.entriesSha256)}<br>chain head ${esc(r.chain.head || '-')}<br>signature ${esc(r.signature)}</p>
</body></html>`;
}
