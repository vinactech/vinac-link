import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../js/bytes.js';
import { createFrame, parseFrame, verifyFrame } from '../js/frame.js';

test('frame creates, parses and verifies action-bound proof',async()=>{
  const sessionKey=randomBytes(32), sessionId='session-test-001', nonce=randomBytes(6), now=Math.floor(Date.now()/1000);
  const f=await createFrame({sessionId,sessionKey,sequence:42,profileId:2,intent:'system.command.execute',nonce,expiry:now+60,payload:'hello'});
  const p=parseFrame(f.bytes);assert.equal(p.ok,true);assert.equal(p.intent,'system.command.execute');assert.equal(p.payloadText,'hello');assert.equal(p.sequence,42);
  const v=await verifyFrame(f.bytes,{sessionId,sessionKey,replayCache:new Set(),now});assert.equal(v.ok,true);assert.equal(v.reason,'VERIFIED');
});

test('CRC corruption, intent mismatch, expiry and replay reject',async()=>{
  const sessionKey=randomBytes(32),sessionId='session-test-002',now=Math.floor(Date.now()/1000);
  const f=await createFrame({sessionId,sessionKey,sequence:7,profileId:1,intent:'communication.message.send',nonce:randomBytes(6),expiry:now+20,payload:'payload'});
  const bad=f.bytes.slice();bad[24]^=1;assert.equal(parseFrame(bad).reason,'CRC_FAIL');
  const wrong=await verifyFrame(f.bytes,{sessionId,sessionKey,replayCache:new Set(),now,expectedIntent:'system.command.execute'});assert.equal(wrong.reason,'ACTION_HASH_MISMATCH');
  const expired=await createFrame({sessionId,sessionKey,sequence:8,profileId:1,intent:'communication.message.send',nonce:randomBytes(6),expiry:now-1,payload:'payload'});
  assert.equal((await verifyFrame(expired.bytes,{sessionId,sessionKey,replayCache:new Set(),now})).reason,'EXPIRED');
  const cache=new Set();assert.equal((await verifyFrame(f.bytes,{sessionId,sessionKey,replayCache:cache,now})).ok,true);assert.equal((await verifyFrame(f.bytes,{sessionId,sessionKey,replayCache:cache,now})).reason,'ALREADY_CONSUMED');
});

test('non-canonical Logos intent cannot enter a frame',async()=>{
  await assert.rejects(()=>createFrame({sessionId:'s',sessionKey:randomBytes(32),sequence:1,intent:'robot.gate.stop',nonce:randomBytes(6),payload:'x'}),/non-canonical/);
});
