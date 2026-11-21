import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevice, ui, api, pair, state } from './helpers.mjs';
import { unprotect } from '../src/keystore.js';
import { Vault, sealTo, openWith } from '../src/vault.js';
import crypto from 'node:crypto';

const PASS = 'correct horse battery';   // test passphrase, not a real one
const receive = d => ui(d, 'POST', '/ui/secret/receive', { on: true });

test('vault lock: with a passphrase, values are sealed; nothing reads them while locked; receiving still works', { timeout: 60_000 }, async () => {
  const A = await startDevice('vault-lock-a'), B = await startDevice('vault-lock-b');
  try {
    await pair(A, B);
    await ui(A, 'POST', '/ui/secrets/add', { name: 'EARLY_KEY', value: 'sk_test_before_lock' });
    assert.deepEqual((await state(A)).vaultLock, { protected: false, locked: false, unlockedUntil: null });

    // Too short, then set it: existing secrets get sealed.
    assert.equal((await ui(A, 'POST', '/ui/vault/setup', { passphrase: 'short' })).status, 400);
    const set = await ui(A, 'POST', '/ui/vault/setup', { passphrase: PASS });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.vaultLock.protected, true);
    assert.equal(set.body.vaultLock.locked, false, 'unlocked right after setting it');
    const early = A.store.secrets().items.find(s => s.name === 'EARLY_KEY');
    assert.equal(early.vault, true);
    // What the OS key store holds is now the sealed form: no plain value in it.
    assert.ok(!unprotect(early.keystore, early.keyLabel, early.wrapped).toString('latin1').includes('sk_test_before_lock'));
    assert.ok(!JSON.stringify(A.store.vault()).includes(PASS), 'the passphrase is never stored');

    // Lock: reveal, send on and approving a run all refuse.
    await ui(A, 'POST', '/ui/vault/lock', {});
    assert.equal((await state(A)).vaultLock.locked, true);
    const reveal = await ui(A, 'POST', '/ui/secrets/reveal', { id: early.id });
    assert.equal(reveal.status, 423);
    assert.match(reveal.body.error, /VAULT_LOCKED/);
    const peerB = A.store.peers()[0].id;
    assert.equal((await ui(A, 'POST', '/ui/secrets/seal', { id: early.id, to: peerB })).status, 423);
    const ask = await api(A, 'POST', '/api/secret-use', { names: ['EARLY_KEY'], command: ['node', 'app.js'] });
    assert.equal((await ui(A, 'POST', '/ui/secret-use/decide', { id: ask.body.id, approve: true })).status, 423);

    // Receiving works while locked, and the new secret is sealed too.
    await receive(A);
    assert.equal((await ui(B, 'POST', '/ui/secret/wifi', { to: B.store.peers()[0].id, name: 'FROM_B', value: 'sk_test_from_b' })).status, 200);
    const fromB = A.store.secrets().items.find(s => s.name === 'FROM_B');
    assert.equal(fromB.vault, true);

    // Wrong passphrase, then the right one.
    const wrong = await ui(A, 'POST', '/ui/vault/unlock', { passphrase: 'not the passphrase' });
    assert.equal(wrong.status, 403);
    assert.equal((await ui(A, 'POST', '/ui/vault/unlock', { passphrase: PASS })).status, 200);
    assert.equal((await ui(A, 'POST', '/ui/secrets/reveal', { id: early.id })).body.value, 'sk_test_before_lock');
    assert.equal((await ui(A, 'POST', '/ui/secrets/reveal', { id: fromB.id })).body.value, 'sk_test_from_b');

    // The agent API can't unlock, lock or set it.
    for (const a of ['unlock', 'setup', 'remove']) assert.notEqual((await api(A, 'POST', `/ui/vault/${a}`, { passphrase: PASS })).status, 200);

    // Remove the passphrase: values go back to the key store only, still readable.
    assert.equal((await ui(A, 'POST', '/ui/vault/remove', { passphrase: 'nope nope nope' })).status, 403);
    assert.equal((await ui(A, 'POST', '/ui/vault/remove', { passphrase: PASS })).status, 200);
    assert.equal(A.store.vault(), null);
    assert.ok(A.store.secrets().items.every(s => !s.vault));
    assert.equal((await ui(A, 'POST', '/ui/secrets/reveal', { id: fromB.id })).body.value, 'sk_test_from_b');
  } finally { await A.stop(); await B.stop(); }
});

test('vault lock: too many passphrase tries are slowed down', { timeout: 60_000 }, async () => {
  const A = await startDevice('vault-rate');
  try {
    await ui(A, 'POST', '/ui/vault/setup', { passphrase: PASS });
    await ui(A, 'POST', '/ui/vault/lock', {});
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await ui(A, 'POST', '/ui/vault/unlock', { passphrase: `guess number ${i}` })).status);
    assert.ok(codes.includes(429), `got ${codes}`);
  } finally { await A.stop(); }
});

test('vault seal: only the matching key opens it, and the label is bound', () => {
  let rec = null;
  const v = new Vault({ load: () => rec, save: r => { rec = r; } });
  const pub = v.create(PASS);
  const sealed = sealTo(pub, 'agentlink.secret.1', Buffer.from('value-1'));
  assert.equal(openWith(v.privateKey(), pub, 'agentlink.secret.1', sealed).toString(), 'value-1');
  assert.throws(() => openWith(v.privateKey(), pub, 'agentlink.secret.2', sealed), /could not be opened/);
  const other = crypto.generateKeyPairSync('x25519').privateKey;
  assert.throws(() => openWith(other, pub, 'agentlink.secret.1', sealed), /could not be opened/);
  v.lock();
  assert.throws(() => v.privateKey(), /VAULT_LOCKED/);
});
