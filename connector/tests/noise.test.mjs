import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Handshake, keyPairFromPrivate, generateKeyPair, NoiseError } from '../src/noise.js';

const { vectors } = JSON.parse(fs.readFileSync(new URL('./fixtures/noise-vectors.json', import.meta.url), 'utf8'));
const hex = s => (s ? Buffer.from(s, 'hex') : null);
const kp = s => (s ? keyPairFromPrivate(hex(s)) : null);

test('Noise: matches the cacophony test vectors byte for byte', () => {
  assert.equal(vectors.length, 6);
  for (const v of vectors) {
    const pattern = v.protocol_name.split('_')[1];
    const init = new Handshake({ pattern, initiator: true, prologue: hex(v.init_prologue), s: kp(v.init_static), e: kp(v.init_ephemeral), rs: hex(v.init_remote_static), psk: v.init_psks?.[0] && hex(v.init_psks[0]) });
    const resp = new Handshake({ pattern, initiator: false, prologue: hex(v.resp_prologue), s: kp(v.resp_static), e: kp(v.resp_ephemeral), rs: hex(v.resp_remote_static), psk: v.resp_psks?.[0] && hex(v.resp_psks[0]) });
    v.messages.forEach((m, i) => {
      const [from, to] = i % 2 === 0 ? [init, resp] : [resp, init];
      let ct, pt;
      if (!from.complete) { ct = from.write(hex(m.payload)); pt = to.read(ct); }
      else { ct = from.send.encryptWithAd(Buffer.alloc(0), hex(m.payload)); pt = to.recv.decryptWithAd(Buffer.alloc(0), ct); }
      assert.equal(ct.toString('hex'), m.ciphertext, `${v.protocol_name} message ${i}`);
      assert.equal(pt.toString('hex'), m.payload, `${v.protocol_name} message ${i} payload`);
    });
    assert.ok(init.complete && resp.complete, v.protocol_name);
    assert.equal(init.hash.toString('hex'), v.handshake_hash, `${v.protocol_name} handshake hash`);
    assert.ok(init.hash.equals(resp.hash));
  }
});

test('Noise: wrong psk, wrong static key or a changed byte all fail', () => {
  const a = generateKeyPair(), b = generateKeyPair(), psk = Buffer.alloc(32, 7);
  const run = (iOpts, rOpts) => {
    const i = new Handshake({ pattern: 'KKpsk0', initiator: true, s: a, rs: b.publicRaw, psk, ...iOpts });
    const r = new Handshake({ pattern: 'KKpsk0', initiator: false, s: b, rs: a.publicRaw, psk, ...rOpts });
    r.read(i.write(Buffer.from('hi')));
    i.read(r.write());
    return [i, r];
  };
  const [i, r] = run({}, {});
  assert.ok(i.hash.equals(r.hash));
  assert.deepEqual(i.exportKeys('test', 2), r.exportKeys('test', 2));
  assert.ok(!i.exportKeys('test')[0].equals(i.exportKeys('other')[0]));
  assert.throws(() => run({}, { psk: Buffer.alloc(32, 8) }), NoiseError);
  assert.throws(() => run({}, { rs: generateKeyPair().publicRaw }), NoiseError);

  const i2 = new Handshake({ pattern: 'XX', initiator: true, s: a });
  const r2 = new Handshake({ pattern: 'XX', initiator: false, s: b });
  r2.read(i2.write());
  const m2 = i2.read.bind(i2);
  const msg = r2.write(Buffer.from('payload'));
  msg[msg.length - 1] ^= 1;
  assert.throws(() => m2(msg), NoiseError);
});

test('Noise: refuses out-of-turn use, missing keys and low-order points', () => {
  const a = generateKeyPair();
  const i = new Handshake({ pattern: 'NN', initiator: true });
  assert.throws(() => i.read(Buffer.alloc(48)), /NOT_MY_TURN/);
  assert.throws(() => new Handshake({ pattern: 'KK', initiator: true, s: a }), /MISSING_RS/);
  assert.throws(() => new Handshake({ pattern: 'NNpsk0', initiator: true }), /PSK_REQUIRED/);
  assert.throws(() => new Handshake({ pattern: 'IK', initiator: true }), /UNKNOWN_PATTERN/);
  const r = new Handshake({ pattern: 'NN', initiator: false });
  r.read(i.write());
  const zero = new Handshake({ pattern: 'NN', initiator: true });
  zero.write();
  assert.throws(() => zero.read(Buffer.concat([Buffer.alloc(32), Buffer.alloc(16)])), /BAD_KEY/);
});
