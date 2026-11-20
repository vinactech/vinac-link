import { bytesToHex, concatBytes, utf8 } from './bytes.js';

function subtle(){
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto subtle unavailable');
  return globalThis.crypto.subtle;
}

export async function sha256(bytes){ return new Uint8Array(await subtle().digest('SHA-256', bytes)); }
export async function payloadDigest(payload){ return sha256(payload); }

export function canonicalActionString({intent,sessionId,sequence,payloadHashHex,nonceHex,expiry}){
  return ['vinac-nus-action/0.1',intent,sessionId,String(sequence),payloadHashHex,nonceHex,String(expiry)].join('|');
}

export async function actionHash(action){ return sha256(utf8(canonicalActionString(action))); }

export async function hmacSha256(keyBytes, data){
  const key=await subtle().importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await subtle().sign('HMAC',key,data));
}

export async function deriveSessionTag(sessionId){
  const h=await sha256(utf8(`vinac-session|${sessionId}`)); return h.slice(0,4);
}

export async function shortFingerprint(bytes, len=8){ return bytesToHex((await sha256(bytes)).slice(0,len)); }

export function authenticatedBytes(frameWithoutAuthAndCrc, actionHashTruncated){ return concatBytes(frameWithoutAuthAndCrc, actionHashTruncated); }
