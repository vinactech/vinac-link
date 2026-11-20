import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_INTENTS, LOGOS_VERSION, intentFromId, intentId, isCanonicalIntent } from '../js/logos.js';

test('Logos v0.2.0 catalog is exact 30-member canonical set',()=>{
  assert.equal(LOGOS_VERSION,'0.2.0');assert.equal(CANONICAL_INTENTS.length,30);
  assert.equal(isCanonicalIntent('communication.message.send'),true);
  assert.equal(isCanonicalIntent('robot.gate.stop'),false);
  assert.throws(()=>intentId('robot.gate.stop'),/non-canonical/);
  for(const intent of CANONICAL_INTENTS) assert.equal(intentFromId(intentId(intent)),intent);
});
