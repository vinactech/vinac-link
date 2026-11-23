import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempHome } from './helpers.mjs';

const bin = fileURLToPath(new URL('../bin/vinac.mjs', import.meta.url));

function client() {
  const child = spawn(process.execPath, [bin, 'mcp', '--home', tempHome('mcp'), '--port', '0'], {
    env: { ...process.env, VINAC_KEYSTORE: 'file', VINAC_NO_BROWSER: '1', VINAC_LAN_HOST: '127.0.0.1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = ''; const waiting = new Map(); let next = 1;
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
    }
  });
  const call = (method, params) => new Promise(resolve => {
    const id = next++; waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { call, close: () => { child.stdin.end(); return new Promise(r => child.on('exit', r)); } };
}

test('MCP server: handshake, eight tools, none can confirm pairing or read secret values', async () => {
  const c = client();
  try {
    const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'vinac');
    const tools = (await c.call('tools/list', {})).result.tools.map(t => t.name);
    assert.deepEqual(tools, ['vinac_status', 'vinac_pair_request', 'vinac_pair_status', 'vinac_peers', 'vinac_send', 'vinac_cards', 'vinac_help', 'vinac_search', 'vinac_file', 'vinac_intents', 'vinac_inbox', 'vinac_secrets', 'vinac_unpair']);
    assert.ok(!tools.some(t => /confirm|approve|accept|reveal|firewall|rule|decide/.test(t)));
    const intents = JSON.parse((await c.call('tools/call', { name: 'vinac_intents', arguments: {} })).result.content[0].text);
    assert.equal(intents.logos, (await import('../src/logos.js')).LOGOS_VERSION);
    assert.equal(intents.intents.length, (await import('../src/logos.js')).CANONICAL_INTENTS.length);
    assert.equal(intents.intents.find(i => i.intent === 'system.command.execute').risk, 'high');

    const status = JSON.parse((await c.call('tools/call', { name: 'vinac_status', arguments: {} })).result.content[0].text);
    assert.match(status.device.fingerprint, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    assert.equal(status.peers, 0);

    const req = JSON.parse((await c.call('tools/call', { name: 'vinac_pair_request', arguments: { mode: 'announce' } })).result.content[0].text);
    assert.match(req.approvalPage, /^http:\/\/127\.0\.0\.1:\d+\/#announce$/);
    assert.equal(req.opened, false);

    const inbox = JSON.parse((await c.call('tools/call', { name: 'vinac_inbox', arguments: {} })).result.content[0].text);
    assert.deepEqual(inbox.messages, []);
    const noPeer = await c.call('tools/call', { name: 'vinac_send', arguments: { text: 'hi' } });
    assert.equal(noPeer.result.isError, true);
    assert.match(noPeer.result.content[0].text, /not paired/);

    const bad = await c.call('tools/call', { name: 'vinac_unpair', arguments: { id: 'nope' } });
    assert.equal(bad.result.isError, true);
    assert.equal((await c.call('tools/call', { name: 'vinac_confirm', arguments: {} })).error.code, -32602);
  } finally { await c.close(); }
});
