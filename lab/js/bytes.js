export const te = new TextEncoder();
export const td = new TextDecoder();

export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) { out.set(part, off); off += part.length; }
  return out;
}

export function utf8(text) { return te.encode(String(text)); }
export function fromUtf8(bytes) { return td.decode(bytes); }

export function u16(value) {
  const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value >>> 0, false); return b;
}
export function u32(value) {
  const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0, false); return b;
}
export function readU16(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false); }
export function readU32(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false); }

export function bytesToHex(bytes) { return [...bytes].map(x => x.toString(16).padStart(2, '0')).join(''); }
export function hexToBytes(hex) {
  if (hex.length % 2) throw new Error('hex length must be even');
  const out = new Uint8Array(hex.length / 2);
  for (let i=0;i<out.length;i++) out[i]=parseInt(hex.slice(i*2,i*2+2),16);
  return out;
}

export function bytesToBits(bytes) {
  let s='';
  for (const byte of bytes) s += byte.toString(2).padStart(8,'0');
  return s;
}
export function bitsToBytes(bits) {
  const n = Math.floor(bits.length / 8);
  const out = new Uint8Array(n);
  for (let i=0;i<n;i++) out[i] = parseInt(bits.slice(i*8,i*8+8),2);
  return out;
}

export function bytesToBase64Url(bytes) {
  let binary=''; for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function base64UrlToBytes(text) {
  const s = text.replaceAll('-','+').replaceAll('_','/');
  const padded = s + '='.repeat((4 - s.length % 4) % 4);
  if (typeof atob === 'function') {
    const bin=atob(padded); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out;
  }
  return new Uint8Array(Buffer.from(padded,'base64'));
}

export function randomBytes(length) {
  const out = new Uint8Array(length);
  if (!globalThis.crypto?.getRandomValues) throw new Error('secure random unavailable');
  globalThis.crypto.getRandomValues(out); return out;
}

export function crc16Ccitt(bytes) {
  let crc=0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i=0;i<8;i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function equalBytes(a,b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff=0; for (let i=0;i<a.length;i++) diff |= a[i]^b[i]; return diff===0;
}

export function clamp(n,min,max){return Math.min(max,Math.max(min,n));}
