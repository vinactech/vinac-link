// macOS installed-copy reuse (0.13.0, from the Mac build). The signed-bundle check needs a Mac;
// the state rule below runs anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canReuseInstalledState, sameInstalledRelease } from '../src/mac-install.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-reuse-'));
const runtime = path.join(dir, 'node');
const other = path.join(dir, 'other-node');
fs.writeFileSync(runtime, '');
fs.writeFileSync(other, '');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('free ports allow starting the identical installed copy', () => {
  assert.equal(canReuseInstalledState({ state: 'FREE' }, runtime, '0.13.0'), true);
});

test('a healthy verified same-version service from the installed runtime is reused', () => {
  assert.equal(canReuseInstalledState({ state: 'HEALTHY', verified: true, version: '0.13.0', proof: { exe: runtime } }, runtime, '0.13.0'), true);
});

test('unverified, unknown or other-version services are not reused', () => {
  for (const s of [{ verified: false, version: '0.13.0' }, { verified: true, version: null }, { verified: true, version: '0.11.0' }]) {
    assert.equal(canReuseInstalledState({ state: 'HEALTHY', proof: { exe: runtime }, ...s }, runtime, '0.13.0'), false);
  }
});

test('a service running from another copy is not reused', () => {
  assert.equal(canReuseInstalledState({ state: 'HEALTHY', verified: true, version: '0.13.0', proof: { exe: other } }, runtime, '0.13.0'), false);
});

test('hung and conflicting instances keep the explicit recovery path', () => {
  for (const state of ['UNRESPONSIVE_OWN', 'PORT_CONFLICT']) {
    assert.equal(canReuseInstalledState({ state, verified: true, version: '0.13.0', proof: { exe: runtime } }, runtime, '0.13.0'), false);
  }
});

test('missing bundles are never treated as the same release', () => {
  assert.equal(sameInstalledRelease(path.join(dir, 'a.app'), path.join(dir, 'b.app'), '0.13.0'), false);
});
