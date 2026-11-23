// 0.11 compliance: the audit log on the page (search, who did what), CSV, signed reports,
// retention with a legal hold, agent fingerprints.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startDevice, ui, api, tempHome } from './helpers.mjs';
import { AuditLog } from '../src/audit.js';
import { checkReport, applyRetention, toCsv, query } from '../src/compliance.js';

const VALUE = 'sk_test_compliance_value_42';

test('compliance: search the log, see who did what (with agent fingerprints), export CSV, and a signed report anyone can check', { timeout: 60_000 }, async () => {
  const A = await startDevice('comp-a');
  try {
    await ui(A, 'POST', '/ui/secrets/add', { name: 'DEMO_KEY', value: VALUE });
    const added = (await ui(A, 'POST', '/ui/agents/add', { name: 'Codex' })).body.newAgent;
    assert.match(added.fingerprint, /^AGT-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    const codex = (m, p, b) => ui(A, m, p, b, { token: null, auth: `Bearer ${added.token}` });
    const work = path.resolve(tempHome('comp-work'));
    const ask = await codex('POST', '/api/secret-use', { names: ['DEMO_KEY'], command: ['npm', 'test'], cwd: work });
    await ui(A, 'POST', '/ui/secret-use/decide', { id: ask.body.id, approve: true, allowHours: 8 });
    await codex('GET', `/api/secret-use?id=${ask.body.id}`);

    // Only the page can read the log.
    assert.equal((await api(A, 'GET', '/ui/audit')).status, 401);
    assert.equal((await codex('GET', '/ui/audit')).status, 401);

    const all = (await ui(A, 'GET', '/ui/audit')).body;
    assert.equal(all.chain.ok, true);
    assert.ok(all.total >= 4);
    assert.deepEqual(all.agents, ['Codex']);
    assert.ok(!JSON.stringify(all).includes(VALUE), 'values are never in the log');
    const runs = (await ui(A, 'GET', '/ui/audit?category=runs')).body.entries;
    const grant = runs.find(e => e.type === 'grant.created');
    assert.equal(grant.who.kind, 'person', 'a grant is made by the person');
    assert.equal(grant.fields.agentFp, added.fingerprint);
    const used = runs.find(e => e.type === 'secret.used');
    assert.equal(used.who.kind, 'person', 'an approved run counts as the person\'s decision');
    assert.equal((await ui(A, 'GET', '/ui/audit?who=agent')).body.entries.length, 0);
    assert.ok((await ui(A, 'GET', '/ui/audit?q=npm%20test')).body.entries.length >= 1, 'full-text search over the metadata');
    assert.equal((await ui(A, 'GET', '/ui/audit?from=2000-01-01&to=2000-01-02')).body.total, 0);

    // CSV export.
    const csv = await fetch(`http://127.0.0.1:${A.uiPort}/ui/audit/export`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ui-token': A.uiToken }, body: JSON.stringify({ filters: { category: 'runs' } }) });
    const text = await csv.text();
    assert.match(csv.headers.get('content-disposition'), /attachment; filename="vinac-audit-/);
    assert.match(text, /^time \(UTC\),event,category,who/);
    assert.match(text, /grant\.created/);
    assert.ok(!text.includes(VALUE));

    // A signed report: checks out; any change is caught.
    const rep = (await ui(A, 'POST', '/ui/audit/report', { filters: {} })).body;
    const report = rep.report;
    assert.equal(report.device.fingerprint, (await ui(A, 'GET', '/ui/audit')).body.device.fingerprint);
    assert.equal(checkReport(report).ok, true);
    const changed = structuredClone(report); changed.entries[0].type = 'pair';
    assert.equal(checkReport(changed).ok, false);
    const forged = structuredClone(report); forged.count += 1;
    assert.equal(checkReport(forged).ok, false);
    const page = await fetch(`http://127.0.0.1:${A.uiPort}${rep.page}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(await page.text(), /Audit report: comp-a/);
    assert.equal((await fetch(`http://127.0.0.1:${A.uiPort}${rep.page}`)).status, 404, 'the printable page works once');
    const log = (await ui(A, 'GET', '/ui/audit?category=log')).body.entries.map(e => e.type);
    assert.ok(log.includes('report.created') && log.includes('audit.exported'), 'reports and exports are logged too');

    // Retention settings: only the listed choices.
    assert.equal((await ui(A, 'POST', '/ui/audit/retention', { keepDays: 5 })).status, 400);
    assert.deepEqual((await ui(A, 'POST', '/ui/audit/retention', { keepDays: 730, legalHold: true })).body.retention, { keepDays: 730, legalHold: true });
    assert.equal((await ui(A, 'GET', '/ui/audit')).body.retention.legalHold, true);
  } finally { await A.stop(); }
});

test('retention removes whole old files, the chain still verifies from its anchor, and a legal hold keeps everything', () => {
  const home = tempHome('retention');
  const log = new AuditLog(home);
  for (let i = 0; i < 5; i++) log.add('msg.in', { id: `m${i}` });
  // As if a month had passed: the current file is rotated.
  fs.renameSync(path.join(home, 'audit.jsonl'), path.join(home, 'audit-20250101T000000.jsonl'));
  const log2 = new AuditLog(home);
  for (let i = 0; i < 3; i++) log2.add('msg.out', { id: `n${i}` });
  assert.equal(log2.verify().ok, true);
  assert.equal(applyRetention(log2, { keepDays: 365, legalHold: true }), 0, 'legal hold: nothing removed');
  assert.equal(applyRetention(log2, { keepDays: 0 }), 0, 'keep always: nothing removed');
  assert.equal(log2.pruneBefore(new Date(Date.now() + 60_000)), 5);
  const v = log2.verify();
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.count, 4, '3 kept + the audit.pruned entry');
  assert.equal(log2.anchor().removedEntries, 5);
  // An edit is still caught.
  const f = path.join(home, 'audit.jsonl');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"n1"', '"nX"'));
  assert.equal(new AuditLog(home).verify().ok, false);
  assert.match(toCsv(query(new AuditLog(home), {}).entries), /msg\.out/);
});
