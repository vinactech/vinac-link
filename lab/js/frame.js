import { concatBytes, crc16Ccitt, equalBytes, fromUtf8, readU16, readU32, u16, u32, utf8, bytesToHex } from './bytes.js';
import { actionHash, deriveSessionTag, hmacSha256, payloadDigest } from './crypto.js';
import { intentFromId, intentId, isCanonicalIntent } from './logos.js';

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_NAME = 'VINAC-NUS/0.1';
export const MAGIC = 0xA7;
export const FIXED_FRAME_BYTES = 52; // includes CRC, excludes payload
export const MAX_PAYLOAD_BYTES = 255;
export const ACTION_HASH_BYTES = 12;
export const AUTH_TAG_BYTES = 16;
export const NONCE_BYTES = 6;

export async function createFrame({sessionId, sessionKey, sequence=0, profileId=1, flags=0, intent, nonce, expiry=Math.floor(Date.now()/1000)+12, payload=''}){
  if (!isCanonicalIntent(intent)) throw new Error('non-canonical Logos intent');
  const payloadBytes = payload instanceof Uint8Array ? payload : utf8(payload);
  if (payloadBytes.length > MAX_PAYLOAD_BYTES) throw new Error('payload too large');
  if (!(sessionKey instanceof Uint8Array) || sessionKey.length < 16) throw new Error('session key must be >=16 bytes');
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) throw new Error(`nonce must be ${NONCE_BYTES} bytes`);
  const sessionTag = await deriveSessionTag(sessionId);
  const pDigest = await payloadDigest(payloadBytes);
  const action = {
    intent, sessionId, sequence, payloadHashHex: bytesToHex(pDigest), nonceHex: bytesToHex(nonce), expiry
  };
  const fullActionHash = await actionHash(action);
  const actionTag = fullActionHash.slice(0,ACTION_HASH_BYTES);
  const header = concatBytes(
    Uint8Array.of(MAGIC,PROTOCOL_VERSION,profileId & 0xff,flags & 0xff),
    sessionTag,
    u16(sequence & 0xffff),
    Uint8Array.of(intentId(intent)),
    nonce,
    u32(expiry),
    Uint8Array.of(payloadBytes.length),
    payloadBytes
  );
  const authenticated = concatBytes(header, actionTag);
  const mac = (await hmacSha256(sessionKey,authenticated)).slice(0,AUTH_TAG_BYTES);
  const body = concatBytes(authenticated,mac);
  const crc = u16(crc16Ccitt(body));
  return {bytes:concatBytes(body,crc), action, actionHash:fullActionHash, actionTag, mac, payloadBytes};
}

export function expectedFrameLength(bytes){
  if (bytes.length < 22) return null;
  return FIXED_FRAME_BYTES + bytes[21];
}

export function parseFrame(bytes){
  if (!(bytes instanceof Uint8Array)) bytes=new Uint8Array(bytes);
  if (bytes.length < FIXED_FRAME_BYTES) return {ok:false,reason:'INCOMPLETE_FRAME'};
  if (bytes[0]!==MAGIC) return {ok:false,reason:'BAD_MAGIC'};
  if (bytes[1]!==PROTOCOL_VERSION) return {ok:false,reason:'BAD_VERSION'};
  const payloadLen=bytes[21];
  const total=FIXED_FRAME_BYTES+payloadLen;
  if (bytes.length < total) return {ok:false,reason:'INCOMPLETE_FRAME',expected:total,available:bytes.length};
  const frame=bytes.slice(0,total);
  const crcExpected=readU16(frame,total-2);
  const crcActual=crc16Ccitt(frame.slice(0,total-2));
  if (crcExpected!==crcActual) return {ok:false,reason:'CRC_FAIL',frameBytes:frame};
  let o=2;
  const profileId=frame[o++], flags=frame[o++];
  const sessionTag=frame.slice(o,o+4); o+=4;
  const sequence=readU16(frame,o); o+=2;
  const iid=frame[o++];
  const intent=intentFromId(iid);
  if (!intent) return {ok:false,reason:'NON_CANONICAL_INTENT',frameBytes:frame};
  const nonce=frame.slice(o,o+NONCE_BYTES); o+=NONCE_BYTES;
  const expiry=readU32(frame,o); o+=4;
  const plen=frame[o++];
  const payload=frame.slice(o,o+plen); o+=plen;
  const actionTag=frame.slice(o,o+ACTION_HASH_BYTES); o+=ACTION_HASH_BYTES;
  const mac=frame.slice(o,o+AUTH_TAG_BYTES); o+=AUTH_TAG_BYTES;
  return {ok:true,frameBytes:frame,profileId,flags,sessionTag,sequence,intent,nonce,expiry,payload,payloadText:fromUtf8(payload),actionTag,mac,totalBytes:total,bodyBeforeAction:frame.slice(0,o-ACTION_HASH_BYTES-AUTH_TAG_BYTES),authenticated:frame.slice(0,o-AUTH_TAG_BYTES),crc:crcExpected};
}

export async function verifyFrame(bytes,{sessionId,sessionKey,replayCache=new Set(),now=Math.floor(Date.now()/1000),expectedIntent=null,consume=true}={}){
  const parsed=parseFrame(bytes);
  if(!parsed.ok) return parsed;
  if(expectedIntent && parsed.intent!==expectedIntent) return {...parsed,ok:false,reason:'ACTION_HASH_MISMATCH'};
  const expectedSessionTag=await deriveSessionTag(sessionId);
  if(!equalBytes(parsed.sessionTag,expectedSessionTag)) return {...parsed,ok:false,reason:'SESSION_MISMATCH'};
  if(parsed.expiry < now) return {...parsed,ok:false,reason:'EXPIRED'};
  const pd=await payloadDigest(parsed.payload);
  const action={intent:parsed.intent,sessionId,sequence:parsed.sequence,payloadHashHex:bytesToHex(pd),nonceHex:bytesToHex(parsed.nonce),expiry:parsed.expiry};
  const fullActionHash=await actionHash(action);
  if(!equalBytes(parsed.actionTag,fullActionHash.slice(0,ACTION_HASH_BYTES))) return {...parsed,ok:false,reason:'ACTION_HASH_MISMATCH'};
  const expectedMac=(await hmacSha256(sessionKey,parsed.authenticated)).slice(0,AUTH_TAG_BYTES);
  if(!equalBytes(parsed.mac,expectedMac)) return {...parsed,ok:false,reason:'AUTH_FAIL'};
  const replayId=`${bytesToHex(parsed.sessionTag)}:${parsed.sequence}:${bytesToHex(parsed.nonce)}`;
  if(replayCache.has(replayId)) return {...parsed,ok:false,reason:'ALREADY_CONSUMED',action,fullActionHash,replayId};
  if(consume) replayCache.add(replayId);
  return {...parsed,ok:true,reason:'VERIFIED',action,fullActionHash,replayId};
}
