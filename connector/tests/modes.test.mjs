import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, ui, api, pair } from './helpers.mjs';
import { Firewall, MODES } from '../src/firewall.js';

// One request of each risk, plus a plain message, from B to A; returns A's firewall status for each.
const KINDS = {
  info: { intent: 'agent.question.ask', args: { question: 'which branch?' } },
  read: { intent: 'agent.review.request', args: { summary: 'please review' } },
  change: { intent: 'communication.message.send', args: { text: 'hi' } },
  high: { intent: 'system.command.execute', args: { command: 'echo hi' } },
  text: { text: 'just a note' },
};
async function statuses(A, B, to = 'Mode A') {
  const out = {};
  for (const [k, body] of Object.entries(KINDS)) {
    const r = await api(B, 'POST', '/api/send', { to, ...body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = (await ui(A, 'GET', '/ui/firewall')).body.requests.find(x => x.id === r.body.id);
    out[k] = m ? m.firewall.status : 'allowed'; // a plain message that went straight through isn't listed
  }
  return out;
}

test('modes: restricted, standard and auto set the defaults by risk; high risk stays blocked; a rule still wins', { timeout: 60_000 }, async () => {
  const A = await startDevice('Mode A'), B = await startDevice('Mode B');
  try {
    await pair(A, B);
    const peerB = (await ui(A, 'GET', '/ui/firewall')).body.peers[0].id;
    assert.equal((await ui(A, 'GET', '/ui/firewall')).body.modes.all, 'standard');
    assert.deepEqual(await statuses(A, B), { info: 'allowed', read: 'pending', change: 'pending', high: 'blocked', text: 'allowed' });

    assert.equal((await ui(A, 'POST', '/ui/firewall/mode', { scope: '*', mode: 'restricted' })).status, 200);
    assert.deepEqual(await statuses(A, B), { info: 'pending', read: 'pending', change: 'blocked', high: 'blocked', text: 'pending' });

    // One device in Auto while all devices stay Restricted.
    assert.equal((await ui(A, 'POST', '/ui/firewall/mode', { scope: peerB, mode: 'auto' })).status, 200);
    assert.deepEqual(await statuses(A, B), { info: 'allowed', read: 'allowed', change: 'pending', high: 'blocked', text: 'allowed' });

    // A rule the person set wins over the mode.
    await ui(A, 'POST', '/ui/firewall/rule', { scope: peerB, intent: 'agent.review.request', decision: 'block' });
    assert.equal((await statuses(A, B)).read, 'blocked');

    // Back to the mode for all devices.
    await ui(A, 'POST', '/ui/firewall/mode', { scope: peerB, mode: 'default' });
    assert.equal((await ui(A, 'GET', '/ui/firewall')).body.modes.devices[peerB], undefined);

    // Only the person: the agent API can't change the mode, and bad input is refused.
    assert.notEqual((await api(A, 'POST', '/ui/firewall/mode', { scope: '*', mode: 'auto' })).status, 200);
    assert.notEqual((await api(A, 'POST', '/api/firewall/mode', { scope: '*', mode: 'auto' })).status, 200);
    assert.equal((await ui(A, 'POST', '/ui/firewall/mode', { scope: '*', mode: 'wide-open' })).status, 400);
    assert.equal((await ui(A, 'POST', '/ui/firewall/mode', { scope: '*', mode: 'default' })).status, 400);
    for (const m of Object.values(MODES)) assert.equal(m.high, 'block', 'high risk is blocked in every mode');
  } finally { await A.stop(); await B.stop(); }
});

test('approve for 1 hour: the same intent from that device goes through for a while, never high risk', { timeout: 60_000 }, async () => {
  const A = await startDevice('Hour A'), B = await startDevice('Hour B');
  try {
    await pair(A, B);
    const send = () => api(B, 'POST', '/api/send', { to: 'Hour A', ...KINDS.read });
    const first = await send();
    const r = await ui(A, 'POST', '/ui/firewall/decide', { id: first.body.id, approve: true, forMinutes: 60 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.request.firewall.allowedUntil);
    const second = await send();
    const seen = (await ui(A, 'GET', '/ui/firewall')).body;
    const m2 = seen.requests.find(x => x.id === second.body.id);
    assert.equal(m2.firewall.status, 'allowed');
    assert.match(m2.firewall.rule, /for a while/);
    assert.equal(Object.keys(seen.modes.temporary).length, 1);
    // Ending it early puts the request back to asking.
    await ui(A, 'POST', '/ui/firewall/temporary/clear', {});
    const third = await send();
    assert.equal((await ui(A, 'GET', '/ui/firewall')).body.requests.find(x => x.id === third.body.id).firewall.status, 'pending');

    // High risk can't be allowed for a while (it is blocked anyway; the firewall refuses it directly too).
    const fw = new Firewall(A.store);
    assert.throws(() => fw.allowFor('x', 'system.command.execute', 3600_000), /one at a time/);
  } finally { await A.stop(); await B.stop(); }
});

test('a device cannot flood the approval queue, and requests nobody decides on expire', { timeout: 60_000 }, async () => {
  const A = await startDevice('Queue A'), B = await startDevice('Queue B');
  try {
    await pair(A, B);
    const ids = [];
    for (let i = 0; i < 27; i++) ids.push((await api(B, 'POST', '/api/send', { to: 'Queue A', intent: 'agent.review.request', args: { summary: `change ${i}` } })).body.id);
    const reqs = (await ui(A, 'GET', '/ui/firewall')).body.requests;
    const st = id => reqs.find(x => x.id === id).firewall;
    assert.equal(ids.filter(id => st(id).status === 'pending').length, 25);
    assert.equal(st(ids[26]).status, 'blocked');
    assert.match(st(ids[26]).rule, /already waiting/);

    // Age one request past 3 days: it expires, can't be approved, and never reaches the agent.
    const list = A.store.messages();
    const old = list.find(m => m.id === ids[0]);
    old.receivedAt = new Date(Date.now() - 4 * 24 * 3600_000).toISOString();
    A.store.saveMessages(list);
    assert.equal((await ui(A, 'GET', '/ui/firewall')).body.requests.find(x => x.id === ids[0]).firewall.status, 'expired');
    const late = await ui(A, 'POST', '/ui/firewall/decide', { id: ids[0], approve: true });
    assert.equal(late.status, 409);
    assert.match(late.body.error, /expired/);
    const inbox = (await api(A, 'GET', '/api/inbox')).body;
    assert.ok(!JSON.stringify(inbox).includes('change 0'), 'an expired request never reaches the agent');
  } finally { await A.stop(); await B.stop(); }
});
