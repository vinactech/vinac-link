import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevice, pair, ui } from './helpers.mjs';
import { TOOLS as MCP_TOOLS } from '../src/mcp.js';
import { COMMANDS, COMMAND_NAMES, runCommand } from '../../openclaw/node/commands.js';
import { TOOLS, TOOL_NAMES, ALLOWED_COMMANDS, resolveNode, runTool } from '../../openclaw/gateway/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OC = path.resolve(here, '../../openclaw');
const json = f => JSON.parse(fs.readFileSync(path.join(OC, f), 'utf8'));
const ok = s => { const r = JSON.parse(s); assert.equal(r.ok, true, s); return r.result; };
const bad = (s, code) => { const r = JSON.parse(s); assert.equal(r.ok, false, s); assert.equal(r.code, code, s); };

/** A fake gateway node runtime whose one node runs the real node commands for `home`. */
function fakeNodes(home, nodes = [{ nodeId: 'win', displayName: 'Office Files', connected: true, commands: ['office.files.list', ...COMMAND_NAMES] }]) {
  const calls = [];
  return {
    calls,
    async list() { return { nodes }; },
    async invoke({ nodeId, command, params, timeoutMs }) {
      calls.push({ nodeId, command, params, timeoutMs });
      const payloadJSON = await runCommand(command, JSON.stringify(params), { home });
      return { ok: true, payload: JSON.parse(payloadJSON), payloadJSON };
    },
  };
}

test('OpenClaw plugin files: manifests, versions and tool lists line up with the agent tools', () => {
  const version = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')).version;
  for (const f of ['node/openclaw.plugin.json', 'node/package.json', 'gateway/openclaw.plugin.json', 'gateway/package.json']) assert.equal(json(f).version, version, f);
  assert.deepEqual(json('gateway/openclaw.plugin.json').contracts.tools, TOOL_NAMES);
  assert.deepEqual(Object.keys(json('gateway/openclaw.plugin.json').toolMetadata), TOOL_NAMES);

  // Same tools as Claude Code / Codex, minus unpair (removing trust stays with the person or Claude Code).
  const mcp = Object.fromEntries(MCP_TOOLS.map(t => [t.name, t]));
  assert.deepEqual([...TOOL_NAMES].sort(), Object.keys(mcp).filter(n => n !== 'vinac_unpair').sort());
  for (const n of TOOL_NAMES) assert.deepEqual(Object.keys(TOOLS[n].parameters.properties).sort(), Object.keys(mcp[n].inputSchema.properties).sort(), n);
  assert.deepEqual(TOOL_NAMES.map(n => COMMANDS[TOOLS[n].command]?.[0]), TOOL_NAMES, 'each tool maps to its own node command');
  assert.ok(!ALLOWED_COMMANDS.some(c => /unpair|confirm|approve|reveal|rule|firewall|secret_value/.test(c)));

  // The gateway part is self-contained (it is copied to the gateway machine alone).
  for (const f of fs.readdirSync(path.join(OC, 'gateway')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(OC, 'gateway', f), 'utf8');
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('./') || m[1].startsWith('openclaw/'), `${f} imports ${m[1]}`);
    assert.doesNotMatch(src, /child_process|node:fs|exec\(|spawn\(/, f);
  }
});

test('node commands refuse bad input before touching VINAC Link', async () => {
  const home = path.join(here, 'does-not-exist');
  bad(await runCommand('vinac.unpair', '{}', { home }), 'UNKNOWN_COMMAND');
  bad(await runCommand('vinac.status', '{"x":1}', { home }), 'REQ_INVALID');
  bad(await runCommand('vinac.status', 'not json', { home }), 'REQ_INVALID');
  bad(await runCommand('vinac.status', '[1]', { home }), 'REQ_INVALID');
  bad(await runCommand('vinac.pair_request', '{"mode":"confirm"}', { home }), 'REQ_INVALID');
  bad(await runCommand('vinac.send', '{"text":"hi","args":[1]}', { home }), 'REQ_INVALID');
  bad(await runCommand('vinac.send', '{"text":"hi","home":"/tmp"}', { home }), 'REQ_INVALID');
  bad(await runCommand('vinac.inbox', '{"waitSeconds":"soon"}', { home }), 'REQ_INVALID');
  assert.ok(!fs.existsSync(home), 'nothing was started or created');
});

test('gateway tool → node command → VINAC Link: status, messages, requests and the firewall', async () => {
  const A = await startDevice('Claw PC'), B = await startDevice('Claw Mac');
  try {
    await pair(A, B);
    const nodesA = fakeNodes(A.homeDir), nodesB = fakeNodes(B.homeDir);

    const status = await runTool(nodesA, {}, 'vinac_status');
    assert.equal(status.node, 'Office Files');
    assert.equal(status.result.device.name, 'Claw PC');
    assert.equal(nodesA.calls[0].command, 'vinac.status');
    assert.equal((await runTool(nodesA, {}, 'vinac_peers')).result.peers[0].name, 'Claw Mac');
    assert.equal((await runTool(nodesA, {}, 'vinac_intents')).result.intents.length, (await import('../src/logos.js')).CANONICAL_INTENTS.length);

    const sent = await runTool(nodesA, {}, 'vinac_send', { to: 'Claw Mac', text: 'hello from OpenClaw' });
    assert.equal(sent.result.delivered, true);
    await runTool(nodesA, {}, 'vinac_send', { to: 'Claw Mac', intent: 'crm.contact.read', args: { name: 'Acme' } });

    const box = (await runTool(nodesB, {}, 'vinac_inbox', { waitSeconds: 1 })).result;
    assert.deepEqual(box.messages.map(m => m.text), ['hello from OpenClaw'], 'the request waits for the person');
    assert.equal(box.waitingForPerson, 1);
    assert.ok(nodesB.calls.at(-1).timeoutMs >= 21_000, 'inbox waits get a longer timeout');

    // Only the person (the page) approves; then OpenClaw's agent sees it.
    const req = (await ui(B, 'GET', '/ui/firewall')).body.requests[0];
    await ui(B, 'POST', '/ui/firewall/decide', { id: req.id, approve: true });
    const after = (await runTool(nodesB, {}, 'vinac_inbox')).result;
    assert.equal(after.messages[0].intent, 'crm.contact.read');
    assert.equal(after.messages[0].trust, 'request approved by the person on this device');

    // Errors from VINAC Link come back as clear tool errors.
    await assert.rejects(runTool(nodesA, {}, 'vinac_send', { to: 'Nobody', text: 'x' }), e => e.code === 'VINAC_VINAC_ERROR' && /No paired device/.test(e.message));
    await assert.rejects(runTool(nodesA, {}, 'vinac_unpair', { id: 'x' }), e => e.code === 'VINAC_TOOL_UNKNOWN');
  } finally { await A.stop(); await B.stop(); }
});

test('gateway finds the VINAC Link node safely: by its commands, or a pinned id/name; never from tool arguments', async () => {
  const n = (id, name, cmds) => ({ nodeId: id, displayName: name, connected: true, commands: cmds });
  const list = nodes => ({ async list() { return { nodes }; } });
  assert.equal((await resolveNode(list([n('a', 'iPhone', ['canvas.snapshot']), n('b', 'PC', ['vinac.status'])]))).nodeId, 'b');
  await assert.rejects(resolveNode(list([n('a', 'iPhone', [])])), e => e.code === 'VINAC_NODE_OFFLINE');
  await assert.rejects(resolveNode(list([n('a', 'PC1', ['vinac.status']), n('b', 'PC2', ['vinac.status'])])), e => e.code === 'VINAC_NODE_AMBIGUOUS');
  assert.equal((await resolveNode(list([n('a', 'PC1', ['vinac.status']), n('b', 'PC2', ['vinac.status'])]), { nodeId: 'a' })).nodeId, 'a');
  assert.equal((await resolveNode(list([n('a', 'PC1', []), n('b', 'PC2', [])]), { nodeName: 'PC2' })).nodeId, 'b');
  await assert.rejects(resolveNode(list([]), { nodeId: 'gone' }), e => e.code === 'VINAC_NODE_OFFLINE');

  // A tool argument naming another node or command is refused by the node, not obeyed.
  const calls = [];
  const nodes = { async list() { return { nodes: [n('b', 'PC', ['vinac.status'])] }; }, async invoke(p) { calls.push(p); return { ok: true, payload: JSON.parse(await runCommand(p.command, JSON.stringify(p.params), { home: path.join(here, 'nope') })) }; } };
  await assert.rejects(runTool(nodes, {}, 'vinac_status', { nodeId: 'evil', command: 'system.run' }), e => e.code === 'VINAC_REQ_INVALID');
  assert.deepEqual(calls.map(c => [c.nodeId, c.command]), [['b', 'vinac.status']]);
  await assert.rejects(runTool({ async list() { return { nodes: [n('b', 'PC', ['vinac.status'])] }; }, async invoke() { throw new Error('node disconnected'); } }, {}, 'vinac_peers'), e => e.code === 'VINAC_INVOKE_FAILED');
  await assert.rejects(runTool({ async list() { return { nodes: [n('b', 'PC', ['vinac.status'])] }; }, async invoke() { return { ok: true, payloadJSON: 'nope' }; } }, {}, 'vinac_peers'), e => e.code === 'VINAC_BAD_PAYLOAD');
});
