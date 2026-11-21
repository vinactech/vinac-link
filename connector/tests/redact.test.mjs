import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { redactor } from '../src/redact.js';

const run = async (secrets, chunks) => {
  const out = [];
  await new Promise((resolve, reject) => Readable.from(chunks.map(c => Buffer.from(c))).pipe(redactor(secrets)).on('data', d => out.push(d)).on('end', resolve).on('error', reject));
  return Buffer.concat(out).toString();
};

test('vinac run output: printed values are hidden, even split across chunks; other text is untouched', async () => {
  const s = { STRIPE_KEY: 'sk_test_abcdef123456', DB: 'postgres://u:pw@h/db' };
  assert.equal(await run(s, ['key=sk_test_abcdef123456\n']), 'key=[hidden: STRIPE_KEY]\n');
  assert.equal(await run(s, ['key=sk_test_ab', 'cdef123456 and ', 'postgres://u:', 'pw@h/db done']), 'key=[hidden: STRIPE_KEY] and [hidden: DB] done');
  assert.equal(await run(s, ['nothing secret here']), 'nothing secret here');
  assert.equal(await run(s, ['twice sk_test_abcdef123456 sk_test_abcdef123456']), 'twice [hidden: STRIPE_KEY] [hidden: STRIPE_KEY]');
  assert.equal(await run({ PIN: '12' }, ['12 apples']), '12 apples', 'very short values are left alone');
  assert.equal(await run({}, ['plain']), 'plain');
});
