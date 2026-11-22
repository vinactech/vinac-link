import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, ui, api, state, waitFor } from './helpers.mjs';
import { nearbyPacket, readNearbyPacket, MemoryBus } from '../src/discovery.js';
import { encodeBeacon, decodeBeacon, beaconToCode, codeToBeacon, toHex } from '../web/beacon.js';
import { randomBytes } from 'node:crypto';

const both = async (A, B, s) => waitFor(async () => (await state(A)).pairing?.state === s && (await state(B)).pairing?.state === s, 6000);

test('nearby: with Pair a device open, two devices find each other, show the same 6 digits, and pair with Allow on both (no typing)', { timeout: 60_000 }, async () => {
  const A = await startDevice('Near A'), B = await startDevice('Near B');
  try {
    // Both people open "Pair a device": each waits to be picked, with no sound and no code to type.
    await ui(A, 'POST', '/ui/discover'); await ui(B, 'POST', '/ui/discover');
    const pa = (await state(A)).pairing;
    assert.deepEqual([pa.state, pa.discover, pa.quiet], ['announcing', true, true]);
    await waitFor(async () => (await state(B)).nearby.some(n => n.name === 'Near A'), 5000);
    const seen = (await state(B)).nearby.find(n => n.name === 'Near A');
    assert.equal(seen.paired, false);
    assert.ok(!(await state(B)).nearby.some(n => n.name === 'Near B'), 'a device never lists itself');
    // Agents can't see the list or pick from it.
    assert.notEqual((await api(B, 'POST', '/ui/nearby/pair', { id: seen.id })).status, 200);

    // The person on B picks A.
    assert.equal((await ui(B, 'POST', '/ui/nearby/pair', { id: seen.id })).status, 200);
    await both(A, B, 'comparing');
    const [a, b] = [(await state(A)).pairing, (await state(B)).pairing];
    assert.match(a.matchCode, /^\d{6}$/);
    assert.equal(a.matchCode, b.matchCode, 'both screens show the same 6 digits');
    assert.equal(b.peer.name, 'Near A'); assert.equal(a.peer.name, 'Near B');
    // The agent API never sees the codes.
    const agentView = await api(A, 'GET', '/api/status');
    assert.ok(!JSON.stringify(agentView.body).includes(a.matchCode));

    // Allow on one side isn't enough...
    assert.equal((await ui(A, 'POST', '/ui/confirm', { match: true })).status, 200);
    assert.equal((await state(A)).pairing.state, 'comparing');
    // ...Allow on both pairs them.
    assert.equal((await ui(B, 'POST', '/ui/confirm', { match: true })).status, 200);
    await both(A, B, 'paired');
    assert.equal((await state(A)).peers[0].via, 'network');
    // Now B lists A as already paired the next time.
    await ui(A, 'POST', '/ui/discover');
    await waitFor(async () => (await state(B)).nearby.some(n => n.name === 'Near A' && n.paired), 5000);
    // A message goes through.
    assert.equal((await api(B, 'POST', '/api/send', { to: 'Near A', text: 'hello over the new pairing' })).body.delivered, true);
  } finally { await A.stop(); await B.stop(); }
});

test('regression: the device that allows last starts waiting to be picked again at once; the other one still finishes', { timeout: 60_000 }, async () => {
  const A = await startDevice('Again A'), B = await startDevice('Again B');
  try {
    await ui(A, 'POST', '/ui/discover');
    await waitFor(async () => (await state(B)).nearby.some(n => n.name === 'Again A'), 5000);
    await ui(B, 'POST', '/ui/nearby/pair', { id: (await state(B)).nearby.find(n => n.name === 'Again A').id });
    await both(A, B, 'comparing');
    await ui(B, 'POST', '/ui/confirm', { match: true });           // B allows first...
    await ui(A, 'POST', '/ui/confirm', { match: true });           // ...A last: A is paired
    assert.equal((await state(A)).pairing.state, 'paired');
    await ui(A, 'POST', '/ui/discover');                            // A's page waits to be picked again right away
    assert.equal((await state(A)).pairing.state, 'announcing');
    await waitFor(async () => (await state(B)).pairing?.state === 'paired', 6000); // B still collects A's confirmation
    assert.equal((await state(B)).peers[0].name, 'Again A');
  } finally { await A.stop(); await B.stop(); }
});

test('compare: Allow without the code still works with the typed-code fallback for an older device', { timeout: 60_000 }, async () => {
  const A = await startDevice('Cmp A'), B = await startDevice('Cmp B');
  try {
    // A shows a code (as an older device would), B types it.
    const p = (await ui(A, 'POST', '/ui/announce', { quiet: true })).body.pairing;
    await ui(B, 'POST', '/ui/heard', { code: p.beaconCode });
    await both(A, B, 'comparing');
    const [a, b] = [(await state(A)).pairing, (await state(B)).pairing];
    // An older A would ask its person to type B's own code; B shows it as showCode.
    assert.equal((await ui(A, 'POST', '/ui/confirm', { code: b.showCode })).status, 200);
    assert.equal((await ui(B, 'POST', '/ui/confirm', { match: true })).status, 200);
    await both(A, B, 'paired');
    assert.notEqual(a.matchCode, undefined);
  } finally { await A.stop(); await B.stop(); }
});

test('invite: the person makes one; the other device (or its agent) joins with `vinac join`, no comparing; it starts in the chosen mode', { timeout: 60_000 }, async () => {
  const A = await startDevice('Inv A'), B = await startDevice('Inv B'), C = await startDevice('Inv C');
  try {
    // Only the page can make an invite.
    assert.notEqual((await api(A, 'POST', '/ui/invite', { mode: 'auto' })).status, 200);
    const made = await ui(A, 'POST', '/ui/invite', { mode: 'restricted' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const { code, command, mode } = made.body.invite;
    assert.equal(mode, 'restricted');
    assert.equal(command, `vinac join ${code}`);
    assert.equal(decodeBeacon(codeToBeacon(code)).invite, true);
    // An invite is never announced on the network.
    await ui(C, 'POST', '/ui/discover');
    await new Promise(r => setTimeout(r, 1800));
    assert.ok(!(await state(C)).nearby.some(n => n.name === 'Inv A'), 'invites are not broadcast');

    // B's agent joins with it.
    const joined = await api(B, 'POST', '/api/join', { code });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.deepEqual([joined.body.paired, joined.body.peer.name], [true, 'Inv A']);
    await waitFor(async () => (await state(A)).pairing?.state === 'paired', 4000);
    const peerB = (await state(A)).peers.find(p => p.name === 'Inv B');
    assert.equal(peerB.via, 'invite');
    assert.equal((await ui(A, 'GET', '/ui/firewall')).body.modes.devices[peerB.id], 'restricted', 'the new device starts in the invite mode');

    // Used once: a second join fails.
    assert.notEqual((await api(C, 'POST', '/api/join', { code })).status, 200);
    // A normal pairing code is not an invite: join refuses it.
    const normal = (await ui(C, 'POST', '/ui/announce', { quiet: true })).body.pairing.beaconCode;
    const refused = await api(B, 'POST', '/api/join', { code: normal });
    assert.equal(refused.status, 400); assert.match(refused.body.error, /not an invite/);
  } finally { await A.stop(); await B.stop(); await C.stop(); }
});

test('nearby packets: only valid VINAC Link pairing packets are read; invites never; a bus member does not hear itself', () => {
  const beacon = encodeBeacon({ ip: '10.0.0.5', port: 47800, secret: randomBytes(8), fingerprint: randomBytes(8) });
  const pkt = readNearbyPacket(nearbyPacket({ name: 'Mac', beacon, proto: 3 }));
  assert.deepEqual([pkt.name, pkt.ip, pkt.port, pkt.proto], ['Mac', '10.0.0.5', 47800, 3]);
  const invite = encodeBeacon({ ip: '10.0.0.5', port: 47800, secret: randomBytes(8), fingerprint: randomBytes(8), invite: true });
  assert.equal(readNearbyPacket(nearbyPacket({ name: 'Mac', beacon: invite, proto: 3 })), null);
  assert.equal(readNearbyPacket(Buffer.from('{"v":1,"kind":"vinac-pair","name":"x","beacon":"zz"}')), null);
  assert.equal(readNearbyPacket(Buffer.from('not json')), null);
  const bad = Buffer.from(beacon); bad[3] ^= 1;
  assert.equal(readNearbyPacket(Buffer.from(JSON.stringify({ v: 1, kind: 'vinac-pair', name: 'x', beacon: toHex(bad) }))), null, 'checksum');
  const bus = new MemoryBus(); const heard = [];
  const m1 = bus.join(), m2 = bus.join();
  m1.start(b => heard.push(['m1', b.toString()])); m2.start(b => heard.push(['m2', b.toString()]));
  m1.send(Buffer.from('hi'));
  assert.deepEqual(heard, [['m2', 'hi']]);
  assert.equal(beaconToCode(beacon).length, 47);
});
