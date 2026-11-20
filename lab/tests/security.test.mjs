import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../js/bytes.js';
import { PROFILES } from '../js/modem.js';
import { runSecurityCampaign } from '../js/security-lab.js';

test('synthetic security campaign passes expected reject/accept cases',async()=>{
  const r=await runSecurityCampaign({sessionId:'security-test',sessionKey:randomBytes(32),intent:'communication.message.send',profile:PROFILES.fast,sampleRate:48000});
  assert.equal(r.allPassed,true,JSON.stringify(r.tests.filter(x=>!x.pass)));
  assert.ok(r.total>=10);assert.equal(r.passed,r.total);
});
