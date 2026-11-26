// 0.16 VINAC Web: a browser as a device, against a local stand-in for Supabase. The "browser" here is
// simulated in Node with the same keys and messages the web app uses, over the same relay frames.
// Adding a browser needs the person on the computer's page (6 digits, Allow); after that only sealed,
// fresh requests for a short list of actions are accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startSupabaseMock } from './supabase-mock.mjs';

const mock = await startSupabaseMock();
process.env.VINAC_CLOUD_URL = mock.url;
process.env.VINAC_CLOUD_KEY = mock.key;
const { startDevice, ui, api, state, waitFor } = await import('./helpers.mjs');
const { Relay } = await import('../src/relay.js');
const { webKeys, webId, helloTag, seal, open, reqAad, resAad } = await import('../src/webdevices.js');
const { codeFromMac } = await import('../web/phone-frame.js');

test.after(() => mock.close());

async function account(d, email) {
  assert.equal((await ui(d, 'POST', '/ui/account/start', { email })).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/verify', { code: mock.codes.get(email) })).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/link', {})).status, 200);
  assert.equal((await ui(d, 'POST', '/ui/account/relay', { on: true })).status, 200);
}
/** A browser signed in to the account (its own session), speaking the relay frames. */
async function browserSession(email, userId) {
  await fetch(`${mock.url}/auth/v1/otp`, { method: 'POST', headers: { apikey: mock.key, 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  const s = await (await fetch(`${mock.url}/auth/v1/verify`, { method: 'POST', headers: { apikey: mock.key, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'email', email, token: mock.codes.get(email) }) })).json();
  return { url: mock.url, key: mock.key, account: () => ({ userId, device: { id: 'browser' } }), token: async () => s.access_token };
}

test('a browser as a device: add with 6 digits and Allow, then sealed fresh requests only', { timeout: 60_000 }, async () => {
  const A = await startDevice('Ana PC');
  let R;
  try {
    await account(A, 'ana@web.example');
    await waitFor(() => A.relay?.ready());
    assert.notEqual((await api(A, 'POST', '/ui/web/start', {})).status, 200, 'agents can\'t add a browser');
    const st = await ui(A, 'POST', '/ui/web/start', {});
    assert.equal(st.status, 200, JSON.stringify(st.body));
    const link = st.body.webPairing.link;
    assert.match(link, /^https:\/\/vinac\.tech\/web\/#pair=/);
    const p = JSON.parse(Buffer.from(link.split('#pair=')[1], 'base64url').toString('utf8'));
    assert.equal(p.d, A.meId); assert.equal(p.a, A.cloud.account().userId);

    // The browser: its own X25519 key, the keys from the link, HELLO through the account relay.
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const ppub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const cpub = Buffer.from(p.k, 'base64url');
    const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: p.k }, format: 'jwk' }) });
    const { kmac, kenc } = webKeys(shared, Buffer.from(p.s, 'base64url'), cpub, ppub);
    const id = webId(ppub);
    R = new Relay({ cloud: await browserSession('ana@web.example', p.a), meId: id, onRequest: async () => ({}), allowed: async () => false });
    await R.start(); await waitFor(() => R.ready());

    // A wrong tag (someone without the link) is refused.
    const bad = await R.request(A.meId, '/web/hello', { from: id, ppub: ppub.toString('base64url'), name: 'Mallory', tag: Buffer.alloc(16).toString('base64url') }).catch(e => e);
    assert.equal(bad.status, 403);
    const ok = await R.request(A.meId, '/web/hello', { from: id, ppub: ppub.toString('base64url'), name: 'Chrome on Ana phone', tag: helloTag(kmac, ppub, 'Chrome on Ana phone').toString('base64url') });
    assert.equal(ok.ok, true);
    const wp = (await state(A)).webPairing;
    assert.equal(wp.state, 'confirm'); assert.equal(wp.browserName, 'Chrome on Ana phone');
    const myCode = codeFromMac(crypto.createHmac('sha256', kmac).update('code').digest());
    assert.equal(wp.code, myCode, 'both screens show the same 6 digits');
    assert.equal((await R.request(A.meId, '/web/check', { from: id })).state, 'waiting');
    // Before Allow, a request is refused.
    const early = await R.request(A.meId, '/web/call', { from: id, ...seal(kenc, Buffer.from(JSON.stringify({ t: Date.now(), q: 1, op: 'state' })), reqAad(id, A.meId)) }).catch(e => e);
    assert.equal(early.status, 403);
    assert.notEqual((await api(A, 'POST', '/ui/web/confirm', { allow: true })).status, 200, 'agents can\'t allow it');
    assert.equal((await ui(A, 'POST', '/ui/web/confirm', { allow: true })).status, 200);
    assert.equal((await R.request(A.meId, '/web/check', { from: id })).state, 'paired');
    assert.equal((await state(A)).webDevices[0].name, 'Chrome on Ana phone');

    // Sealed requests. q counts up; a replay or an old one is refused.
    let q = 1;
    const call = async (op, args = {}, { t = Date.now(), qq } = {}) => {
      const n = qq ?? q++;
      const r = await R.request(A.meId, '/web/call', { from: id, ...seal(kenc, Buffer.from(JSON.stringify({ t, q: n, op, args })), reqAad(id, A.meId)) });
      return JSON.parse(open(kenc, r, resAad(A.meId, id, n)).toString('utf8'));
    };
    const s1 = await call('state');
    assert.equal(s1.ok, true); assert.equal(s1.result.device.name, 'Ana PC'); assert.ok(Array.isArray(s1.result.needsMe));
    const replay = await call('state', {}, { qq: 1 }).catch(e => e);
    assert.equal(replay.status, 409);
    const stale = await call('state', {}, { t: Date.now() - 10 * 60_000 }).catch(e => e);
    assert.equal(stale.status, 409);
    // Not on the list: refused inside the sealed answer.
    const no = await call('setFirewallRule', { x: 1 });
    assert.equal(no.ok, false); assert.match(no.error, /can't do/);

    // A real action: post in a room (as the person), seen on the computer.
    const w = (await ui(A, 'POST', '/ui/projects/workspace', { name: 'Shop' })).body;
    const posted = await call('post', { room: w.room.id, text: 'Hi from my phone browser' });
    assert.equal(posted.ok, true, JSON.stringify(posted));
    assert.ok(A.store.messages().some(m => m.dir === 'local' && m.by === 'person' && m.text === 'Hi from my phone browser'));
    const audit = (await ui(A, 'GET', '/ui/audit?last=20')).body;
    assert.match(JSON.stringify(audit), /web\.action/);

    // Removed: refused from then on.
    assert.equal((await ui(A, 'POST', '/ui/web/remove', { id })).status, 200);
    const after = await call('state').catch(e => e);
    assert.equal(after.status, 403);
  } finally { R?.stop(); await A.stop(); }
});

test('one browser per link: a second holder of the link is refused while the first waits', async () => {
  const { WebDevices } = await import('../src/webdevices.js');
  const w = new WebDevices({ file: () => 'none.json', readJson: () => null, writeJson: () => {} });
  w.list = () => [];
  const p = JSON.parse(Buffer.from(w.start({ deviceId: 'pc', name: 'PC', account: 'u' }).link.split('#pair=')[1], 'base64url').toString('utf8'));
  const browser = name => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const ppub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: p.k }, format: 'jwk' }) });
    const { kmac } = webKeys(shared, Buffer.from(p.s, 'base64url'), Buffer.from(p.k, 'base64url'), ppub);
    return { from: webId(ppub), ppub: ppub.toString('base64url'), name, tag: helloTag(kmac, ppub, name).toString('base64url') };
  };
  const first = browser('First'), second = browser('Second');
  assert.equal(w.hello(first).ok, true);
  assert.throws(() => w.hello(second), e => e.status === 409);
  assert.equal(w.hello(first).ok, true, 'the same browser may say hello again');
});
