import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../js/bytes.js';
import { createFrame } from '../js/frame.js';
import { decodeFskFrame, framedFskSymbols, synthesizeFsk, toneSetForSampleRate } from '../js/modem.js';

test('synthetic CP-4FSK round trip recovers exact frame',async()=>{
  const sr=48000,rawBps=500,tones=toneSetForSampleRate(sr),sessionKey=randomBytes(32);
  const f=await createFrame({sessionId:'synthetic-session',sessionKey,sequence:3,profileId:3,intent:'communication.message.send',nonce:randomBytes(6),payload:'VINAC'});
  const pcm=synthesizeFsk(framedFskSymbols(f.bytes),{sampleRate:sr,rawBps,tones,amplitude:.55});
  const d=decodeFskFrame(pcm,{sampleRate:sr,rawBps,tones});assert.equal(d.ok,true,d.reason);assert.deepEqual([...d.frameBytes],[...f.bytes]);assert.ok(d.trainingScore>.9);assert.ok(Number.isFinite(d.snrProxyDb));
});

test('silence does not produce a frame',()=>{
  const sr=48000;const d=decodeFskFrame(new Float32Array(sr*2),{sampleRate:sr,rawBps:500,tones:toneSetForSampleRate(sr)});assert.equal(d.ok,false);assert.equal(d.reason,'PREAMBLE_MISS');
});
