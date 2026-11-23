// 0.11 phone vault: pairing a phone (QR link + HELLO by sound + Allow) and keys sent by sound.
// The phone side is the real phone web app code (WebCrypto), run in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startDevice, ui, api, state } from './helpers.mjs';
import { pairWithComputer, sealForComputer, vaultKey, sealVault, openVault, newSalt, unb64u } from '../web/phone-crypto.js';
import { decodePairLink, encodePairLink, phoneFrameLooksValid, parseHello } from '../web/phone-frame.js';
import { toHex } from '../web/beacon.js';

const VALUE = 'sk_test_from_phone_0123456789';

test('phone link: round trip, and anything else is not a pairing link', () => {
  const cpub = new Uint8Array(32).fill(7), secret = new Uint8Array(16).fill(9);
  const link = encodePairLink({ cpub, secret, name: 'My PC' });
  assert.match(link, /^https:\/\/vinac\.tech\/app\/#p=/);
  const p = decodePairLink(link);
  assert.deepEqual([...p.cpub], [...cpub]); assert.deepEqual([...p.secret], [...secret]); assert.equal(p.name, 'My PC');
  assert.equal(decodePairLink('https://vinac.tech/app/'), null);
  assert.equal(decodePairLink('#p=AAAA'), null);
});

test('phone vault: pair a phone with the QR link and its sound, compare 6 digits, Allow; then keys arrive by sound', { timeout: 60_000 }, async () => {
  const A = await startDevice('phone-a');
  try {
    // The computer shows the QR code; agents can't start it.
    assert.notEqual((await api(A, 'POST', '/ui/phone/start', {})).status, 200);
    const start = await ui(A, 'POST', '/ui/phone/start', {});
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const link = start.body.phonePairing.link;

    // The phone opens the link, makes its keys, shows 6 digits and plays HELLO.
    const phone = await pairWithComputer(link, 'Art\'s iPhone');
    assert.ok(phoneFrameLooksValid(phone.hello) && parseHello(phone.hello));
    assert.equal(phone.computer.name, 'phone-a');

    // A HELLO for another pairing (or changed) is refused.
    const bad = Uint8Array.from(phone.hello); bad[5] ^= 1;
    assert.notEqual((await ui(A, 'POST', '/ui/phone/heard', { hex: toHex(bad) })).status, 200);

    const heard = await ui(A, 'POST', '/ui/phone/heard', { hex: toHex(phone.hello) });
    assert.equal(heard.status, 200, JSON.stringify(heard.body));
    assert.equal(heard.body.phonePairing.state, 'confirm');
    assert.equal(heard.body.phonePairing.code, phone.code, 'both screens show the same 6 digits');
    assert.equal(heard.body.phonePairing.phoneName, 'Art\'s iPhone');
    assert.notEqual((await api(A, 'POST', '/ui/phone/confirm', { allow: true })).status, 200, 'an agent cannot press Allow');
    const ok = await ui(A, 'POST', '/ui/phone/confirm', { allow: true });
    assert.equal(ok.body.pairedPhone.name, 'Art\'s iPhone');
    assert.equal((await state(A)).phones.length, 1);
    // With a real key store (DPAPI, Keychain, Secret Service) the sealing key never appears in phones.json.
    // Tests use the plain "file" store, which keeps it base64-encoded there by design.
    const saved = JSON.parse(fs.readFileSync(path.join(A.homeDir, 'phones.json'), 'utf8')).phones[0];
    assert.equal(saved.keyLabel, `agentlink.phone.${saved.id}`);
    if (saved.keystore === 'file') assert.equal(Buffer.from(saved.wrappedKey, 'base64').toString('base64url'), phone.computer.key);
    else assert.ok(!JSON.stringify(saved).includes(phone.computer.key) && !JSON.stringify(saved).includes(Buffer.from(phone.computer.key, 'base64url').toString('base64')), 'the sealing key is kept by the key store, not in plain');

    // Sending a key: only while the person listens (Receive by sound).
    const c = phone.computer;
    const s1 = await sealForComputer(c, 'STRIPE_TEST_KEY', VALUE); c.counter = s1.counter;
    assert.equal((await ui(A, 'POST', '/ui/secret/heard', { hex: toHex(s1.frame) })).status, 409, 'not listening: refused');
    await ui(A, 'POST', '/ui/secret/receive', { on: true });
    const got = await ui(A, 'POST', '/ui/secret/heard', { hex: toHex(s1.frame) });
    assert.equal(got.status, 200, JSON.stringify(got.body));
    assert.equal(got.body.from.name, 'Art\'s iPhone');
    const item = (await state(A)).secrets.find(x => x.name === 'STRIPE_TEST_KEY');
    assert.ok(item && !item.offered && !item.pending);
    assert.equal((await ui(A, 'POST', '/ui/secrets/reveal', { id: item.id })).body.value, VALUE);
    assert.ok(!JSON.stringify(await state(A)).includes(VALUE));

    // The same sound played again is refused; a changed one doesn't unlock.
    assert.equal((await ui(A, 'POST', '/ui/secret/heard', { hex: toHex(s1.frame) })).status, 409);
    const s2 = await sealForComputer(c, 'STRIPE_TEST_KEY', `${VALUE}-new`); c.counter = s2.counter;
    const tampered = Uint8Array.from(s2.frame); tampered[30] ^= 1;
    // (fix the CRC so it reaches the decryption step)
    const { crc16 } = await import('../web/beacon.js');
    const cc = crc16(tampered.subarray(0, tampered.length - 2)); tampered[tampered.length - 2] = cc >> 8; tampered[tampered.length - 1] = cc & 255;
    assert.equal((await ui(A, 'POST', '/ui/secret/heard', { hex: toHex(tampered) })).status, 403);
    // A newer value of the same name from the same phone replaces the old one.
    assert.equal((await ui(A, 'POST', '/ui/secret/heard', { hex: toHex(s2.frame) })).status, 200);
    const after = (await state(A)).secrets.filter(x => x.name === 'STRIPE_TEST_KEY');
    assert.equal(after.length, 1);
    assert.equal((await ui(A, 'POST', '/ui/secrets/reveal', { id: after[0].id })).body.value, `${VALUE}-new`);
    assert.ok(A.audit.tail(20).some(e => e.type === 'phone.paired') && !JSON.stringify(A.audit.tail(20)).includes(VALUE));

    // Removing the phone: its keys no longer open.
    await ui(A, 'POST', '/ui/phones/remove', { id: (await state(A)).phones[0].id });
    const s3 = await sealForComputer(c, 'OTHER_KEY', 'value-3'); c.counter = s3.counter;
    assert.equal((await ui(A, 'POST', '/ui/secret/heard', { hex: toHex(s3.frame) })).status, 403);
  } finally { await A.stop(); }
});

test('phone frames survive the sound modem (synthesized with echo and noise, no speaker or microphone)', async () => {
  const { synthesizeFsk, framedFskSymbolsV2, decodeFskFrameV2 } = await import('../../lab/js/modem.js');
  const { BEACON_TONES, BEACON_BPS } = await import('../web/beacon.js');
  const { SECRET_FEC, SECRET_MIN_BYTES, SECRET_MAX_BYTES } = await import('../web/secret-frame.js');
  const { HELLO_MIN, HELLO_MAX, PHONE_SECRET_MIN, parseSecretFrame } = await import('../web/phone-frame.js');
  const cpub = new Uint8Array(32); globalThis.crypto.getRandomValues(cpub);
  const link = encodePairLink({ cpub, secret: new Uint8Array(16).fill(3), name: 'PC' });
  const phone = await pairWithComputer(link, 'Pixel');
  const { frame } = await sealForComputer(phone.computer, 'OPENAI_API_KEY', 'sk-' + 'x'.repeat(120));
  const sr = 48000;
  const room = (bytes, opts) => {
    const clean = synthesizeFsk(framedFskSymbolsV2(bytes, SECRET_FEC), { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, amplitude: 0.3 });
    const out = new Float32Array(sr / 4 + clean.length + sr / 2), d = Math.round(sr * 0.007);
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (let i = 0; i < clean.length; i++) { out[sr / 4 + i] += clean[i]; out[sr / 4 + i + d] += clean[i] * 0.4; }
    for (let i = 0; i < out.length; i++) out[i] += (rnd() - 0.5) * 0.05;
    return decodeFskFrameV2(out, { sampleRate: sr, rawBps: BEACON_BPS, tones: BEACON_TONES, ...opts });
  };
  const h = room(phone.hello, { minLength: HELLO_MIN, maxLength: HELLO_MAX, accept: b => !!parseHello(b) });
  assert.ok(h?.ok && !h.fecFailed);
  assert.deepEqual([...h.frameBytes], [...phone.hello]);
  // The computer's "Receive by sound" listener takes phone keys too.
  const s = room(frame, { minLength: Math.min(SECRET_MIN_BYTES, PHONE_SECRET_MIN), maxLength: SECRET_MAX_BYTES, accept: b => !!parseSecretFrame(b) });
  assert.ok(s?.ok && !s.fecFailed);
  assert.deepEqual([...s.frameBytes], [...frame]);
  const seconds = (framedFskSymbolsV2(frame, SECRET_FEC).length) / (BEACON_BPS / 2);
  assert.ok(seconds < 30, `a long key takes ${seconds.toFixed(1)} s`);
});

test('phone vault on the phone: everything is sealed with the passphrase, and a wrong one opens nothing', async () => {
  const salt = unb64u(newSalt());
  const key = await vaultKey('correct horse battery', salt, 1000);
  const box = await sealVault(key, { keys: [{ name: 'K', value: VALUE }] });
  assert.ok(!JSON.stringify(box).includes(VALUE));
  assert.equal((await openVault(key, box)).keys[0].value, VALUE);
  await assert.rejects(openVault(await vaultKey('wrong passphrase!', salt, 1000), box));
});
