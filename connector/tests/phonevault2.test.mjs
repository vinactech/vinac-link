// Phone vault 2.0: keys in both directions (computer to phone, phone to phone) and a phone as the
// host of a pairing. The phone side is the real web app code (WebCrypto), run in Node. No sound is
// played: the same frames travel as links (QR codes) here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, ui, api } from './helpers.mjs';
import { pairWithComputer, hostStart, hostHello, sealKey, openKey } from '../web/phone-crypto.js';
import { readPhoneLink, phoneLink, parseSecretFrame, PHONE_DOWN, PHONE_SECRET } from '../web/phone-frame.js';
import { toHex } from '../web/beacon.js';

test('phone to phone: one shows the code, the other opens it, both compare 6 digits; keys go both ways', async () => {
  // Ana's phone hosts: its link says it is a phone.
  const host = await hostStart('Ana phone');
  const read = readPhoneLink(host.link);
  assert.equal(read.kind, 'p'); assert.equal(read.pair.host, 'phone'); assert.equal(read.pair.name, 'Ana phone');

  // Ben's phone opens it and answers with its HELLO, as a link Ana's camera opens.
  const guest = await pairWithComputer(host.link, 'Ben phone');
  assert.equal(guest.computer.kind, 'phone'); assert.equal(guest.computer.role, 'guest');
  const hl = readPhoneLink(phoneLink('h', guest.hello));
  assert.equal(hl.kind, 'h');

  // A HELLO made for another code is refused; the right one gives the same 6 digits.
  const other = await hostStart('Someone else');
  await assert.rejects(hostHello(other.pending, hl.bytes), /not made for this/);
  const changed = Uint8Array.from(hl.bytes); changed[6] ^= 1;
  await assert.rejects(hostHello(host.pending, changed));
  const h = await hostHello(host.pending, hl.bytes);
  assert.equal(h.code, guest.code, 'both phones show the same 6 digits');
  assert.equal(h.name, 'Ben phone'); assert.equal(h.record.role, 'host');
  const ana = h.record, ben = guest.computer;

  // Ben to Ana (SECRET), as a QR link.
  const up = await sealKey(ben, 'OPENAI_API_KEY', 'sk-test-ben-1'); ben.counter = up.counter;
  assert.equal(up.frame[0], PHONE_SECRET);
  const upLink = readPhoneLink(phoneLink('k', up.frame));
  const got = await openKey([ana], upLink.bytes);
  assert.equal(got.name, 'OPENAI_API_KEY'); assert.equal(got.value, 'sk-test-ben-1'); assert.equal(got.record, ana);
  ana.seen = got.counter;
  await assert.rejects(openKey([ana], upLink.bytes), /already received/, 'the same code again is refused');

  // Ana to Ben (KEY DOWN).
  const down = await sealKey(ana, 'GITHUB_TOKEN', 'ghp_test_ana_2'); ana.counter = down.counter;
  assert.equal(down.frame[0], PHONE_DOWN);
  const back = await openKey([ben], down.frame);
  assert.equal(back.value, 'ghp_test_ana_2'); ben.seen = back.counter;

  // Each direction opens only on its receiver; changed bytes and strangers are refused.
  await assert.rejects(openKey([ana], down.frame), /not sent to this phone/);
  await assert.rejects(openKey([ben], up.frame), /not sent to this phone/);
  const bent = Uint8Array.from(down.frame); bent[30] ^= 1;
  await assert.rejects(openKey([ben], bent));
  const stranger = (await pairWithComputer((await hostStart('X')).link, 'Y')).computer;
  await assert.rejects(openKey([stranger], down.frame), /not sent to this phone/);

  // An expired code can't be used.
  await assert.rejects(hostHello({ ...host.pending, expires: Date.now() - 1 }, hl.bytes), /expired/);
});

test('computer to phone: the person sends a key as a sealed code; agents cannot; replays are refused', { timeout: 60_000 }, async () => {
  const A = await startDevice('pv2-a');
  try {
    const link = (await ui(A, 'POST', '/ui/phone/start', {})).body.phonePairing.link;
    assert.equal(readPhoneLink(link).pair.host, 'computer');
    const phone = await pairWithComputer(link, 'Pixel');
    assert.equal(phone.computer.kind, 'computer');
    await ui(A, 'POST', '/ui/phone/heard', { hex: toHex(phone.hello) });
    const id = (await ui(A, 'POST', '/ui/phone/confirm', { allow: true })).body.pairedPhone.id;
    const secret = (await ui(A, 'POST', '/ui/secrets/add', { name: 'RESEND_API_KEY', value: 're_test_to_phone_1' })).body.added.id;

    assert.notEqual((await api(A, 'POST', '/ui/phones/send', { phone: id, secret })).status, 200, 'agents cannot send keys to a phone');
    assert.equal((await ui(A, 'POST', '/ui/phones/send', { phone: 'nope', secret })).status, 404);
    const r = await ui(A, 'POST', '/ui/phones/send', { phone: id, secret });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.link, /^https:\/\/vinac\.tech\/app\/#k=/);
    assert.ok(!JSON.stringify(r.body).includes('re_test_to_phone_1'), 'only sealed bytes leave the service');

    const rec = phone.computer;
    const got = await openKey([rec], readPhoneLink(r.body.link).bytes);
    assert.equal(got.name, 'RESEND_API_KEY'); assert.equal(got.value, 're_test_to_phone_1');
    rec.seen = got.counter;
    await assert.rejects(openKey([rec], readPhoneLink(r.body.link).bytes), /already received/);
    // The same frame by sound (hex) opens the same way; a second send has a higher counter.
    const r2 = await ui(A, 'POST', '/ui/phones/send', { phone: id, secret });
    const again = await openKey([rec], Buffer.from(r2.body.hex, 'hex'));
    assert.equal(again.counter, got.counter + 1);

    // The computer only takes keys coming its way: a KEY DOWN played back to it is refused.
    assert.equal(parseSecretFrame(Buffer.from(r2.body.hex, 'hex')), null);
  } finally { await A.stop(); }
});
