import { randomBytes, crc16Ccitt, u16 } from './bytes.js';
import { createFrame, parseFrame, verifyFrame } from './frame.js';
import { decodeFskFrame, framedFskSymbols, synthesizeFsk, syntheticClap, syntheticSpeechBand, toneSetForSampleRate } from './modem.js';

function rewriteCrc(bytes){const out=bytes.slice();const c=u16(crc16Ccitt(out.slice(0,-2)));out.set(c,out.length-2);return out;}
function result(name,pass,reason,layer){return {name,pass,reason,layer};}

export async function runSecurityCampaign({sessionId,sessionKey,intent='communication.message.send',profile, sampleRate=48000}={}){
  const tones=toneSetForSampleRate(sampleRate);const rawBps=profile.rawBps;const now=Math.floor(Date.now()/1000);
  const base=await createFrame({sessionId,sessionKey,sequence:301,profileId:profile.id,intent,nonce:randomBytes(6),expiry:now+30,payload:'VINAC security control'});
  const pcm=synthesizeFsk(framedFskSymbols(base.bytes),{sampleRate,rawBps,tones,amplitude:.52});
  const tests=[];

  const validDecode=decodeFskFrame(pcm,{sampleRate,rawBps,tones});
  const validVerify=validDecode.ok?await verifyFrame(validDecode.frameBytes,{sessionId,sessionKey,replayCache:new Set(),now}):validDecode;
  tests.push(result('Valid authenticated frame',validDecode.ok&&validVerify.ok,validVerify.reason||validDecode.reason,'full stack'));

  const silence=new Float32Array(Math.round(sampleRate*4));
  tests.push(result('Silence rejected',!decodeFskFrame(silence,{sampleRate,rawBps,tones}).ok,'PREAMBLE_MISS','physical/modem'));

  const clap=syntheticClap(sampleRate,4);
  tests.push(result('Clap-like impulse rejected',!decodeFskFrame(clap,{sampleRate,rawBps,tones}).ok,'PREAMBLE_MISS','physical/modem'));

  const speech=syntheticSpeechBand(sampleRate,4);
  tests.push(result('Speech-band energy rejected',!decodeFskFrame(speech,{sampleRate,rawBps,tones}).ok,'PREAMBLE_MISS','physical/modem'));

  const shifted=tones.map(x=>x+1250).filter(x=>x<sampleRate/2-400);while(shifted.length<4)shifted.push(15000+shifted.length*350);
  const wrongCarrier=synthesizeFsk(framedFskSymbols(base.bytes),{sampleRate,rawBps,tones:shifted,amplitude:.52});
  tests.push(result('Wrong carrier set rejected',!decodeFskFrame(wrongCarrier,{sampleRate,rawBps,tones}).ok,'PREAMBLE_MISS','physical/modem'));

  const wrongSymbols=synthesizeFsk(Array.from({length:220},(_,i)=>(i*3+1)%4),{sampleRate,rawBps,tones,amplitude:.52});
  tests.push(result('Wrong symbol sequence rejected',!decodeFskFrame(wrongSymbols,{sampleRate,rawBps,tones}).ok,'PREAMBLE_MISS','modem'));

  const crcBad=base.bytes.slice();crcBad[Math.min(25,crcBad.length-20)]^=0x01;
  tests.push(result('Corrupted CRC rejected',parseFrame(crcBad).reason==='CRC_FAIL',parseFrame(crcBad).reason,'link integrity'));

  const macBad=base.bytes.slice();macBad[macBad.length-2-16]^=0x10;const macBadCrc=rewriteCrc(macBad);
  const mv=await verifyFrame(macBadCrc,{sessionId,sessionKey,replayCache:new Set(),now});
  tests.push(result('Invalid authenticator rejected',!mv.ok&&mv.reason==='AUTH_FAIL',mv.reason,'cryptographic authentication'));

  const actionBad=base.bytes.slice();actionBad[actionBad.length-2-16-12]^=0x20;const actionBadCrc=rewriteCrc(actionBad);
  const av=await verifyFrame(actionBadCrc,{sessionId,sessionKey,replayCache:new Set(),now});
  tests.push(result('Altered action hash rejected',!av.ok&&av.reason==='ACTION_HASH_MISMATCH',av.reason,'action binding'));

  const expired=await createFrame({sessionId,sessionKey,sequence:302,profileId:profile.id,intent,nonce:randomBytes(6),expiry:now-1,payload:'expired'});
  const ev=await verifyFrame(expired.bytes,{sessionId,sessionKey,replayCache:new Set(),now});
  tests.push(result('Expired frame rejected',!ev.ok&&ev.reason==='EXPIRED',ev.reason,'freshness'));

  const otherIntent=intent==='system.command.execute'?'communication.message.send':'system.command.execute';
  const wv=await verifyFrame(base.bytes,{sessionId,sessionKey,replayCache:new Set(),now,expectedIntent:otherIntent});
  tests.push(result('Different Logos intent rejected',!wv.ok&&wv.reason==='ACTION_HASH_MISMATCH',wv.reason,'semantic/action binding'));

  const replayCache=new Set();const first=await verifyFrame(base.bytes,{sessionId,sessionKey,replayCache,now});const second=await verifyFrame(base.bytes,{sessionId,sessionKey,replayCache,now});
  tests.push(result('Second use / replay rejected',first.ok&&!second.ok&&second.reason==='ALREADY_CONSUMED',second.reason,'replay cache'));

  return {tests,passed:tests.filter(x=>x.pass).length,total:tests.length,allPassed:tests.every(x=>x.pass),note:'Synthetic regression campaign only; live over-the-air and live-relay resistance require separate testing.'};
}
