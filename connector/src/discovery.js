// Finding other VINAC Link devices on the same network, so a person can pair by picking a name
// instead of typing a code or playing a sound.
//
// Only while a person has "Pair a device" open does this device send a small UDP packet every
// 1.5 s (multicast 239.255.47.80 and broadcast, port 47809): its name and the same 25-byte beacon
// that the pairing sound or the typed code carry (address, port, one-time secret, fingerprint).
// Anyone on the network can read it. That is fine: pairing still needs both people to see the
// same 6-digit code on both screens and press Allow, and the code comes from a handshake where the
// listener commits to its random number before seeing the other's (docs/NOISE.md), so a device
// in the middle can't make the two screens agree. Invites are never sent this way.
import dgram from 'node:dgram';
import { decodeBeacon, fromHex, toHex } from '../web/beacon.js';

export const DISCOVERY_GROUP = '239.255.47.80';
export const DISCOVERY_PORT = 47809;
export const NEARBY_TTL_MS = 6000;
const KIND = 'vinac-pair';
const MAX_PACKET = 512;

/** Builds the packet a device sends while it waits to be picked. */
export function nearbyPacket({ name, beacon, proto }) {
  return Buffer.from(JSON.stringify({ v: 1, kind: KIND, name: String(name).slice(0, 64), beacon: toHex(beacon), proto }));
}

/** Reads a packet; returns null for anything that isn't a valid VINAC Link pairing packet. */
export function readNearbyPacket(buf) {
  if (!buf || buf.length > MAX_PACKET) return null;
  let m;
  try { m = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { return null; }
  if (!m || m.v !== 1 || m.kind !== KIND || typeof m.name !== 'string' || typeof m.beacon !== 'string' || !/^[0-9a-f]{50}$/.test(m.beacon)) return null;
  const b = decodeBeacon(fromHex(m.beacon));
  if (!b.ok || b.invite) return null; // invites are never broadcast
  return { name: m.name.slice(0, 64), beacon: m.beacon, proto: Number.isInteger(m.proto) ? m.proto : 2, ip: b.ip, port: b.port, fp: Buffer.from(b.fingerprint).toString('hex') };
}

/** UDP on the real network. Errors (no network, blocked by the OS) only mean nobody is found. */
export class UdpDiscovery {
  constructor({ port = DISCOVERY_PORT, group = DISCOVERY_GROUP, log = () => {} } = {}) { this.port = port; this.group = group; this.log = log; }

  start(onPacket) {
    const s = this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', e => { this.log(`discovery: ${e.code || e.message} (devices can still pair with a code)`); try { s.close(); } catch { /* closed */ } this.sock = null; });
    s.on('message', (msg, rinfo) => onPacket(msg, rinfo.address));
    s.bind(this.port, () => {
      try { s.setBroadcast(true); } catch { /* not allowed here */ }
      try { s.addMembership(this.group); s.setMulticastTTL(1); s.setMulticastLoopback(true); } catch { /* no multicast on this network */ }
    });
    s.unref();
  }

  send(buf) {
    if (!this.sock) return;
    for (const to of [this.group, '255.255.255.255']) this.sock.send(buf, this.port, to, () => { /* best effort */ });
  }

  stop() { try { this.sock?.close(); } catch { /* closed */ } this.sock = null; }
}

/** An in-process "network" for tests: every device on the same bus hears every other one. */
export class MemoryBus {
  constructor() { this.members = new Set(); }
  join() {
    const bus = this;
    const member = {
      start(onPacket) { this.onPacket = onPacket; bus.members.add(this); },
      send(buf) { for (const m of bus.members) if (m !== this) m.onPacket?.(Buffer.from(buf), '127.0.0.1'); },
      stop() { bus.members.delete(this); },
    };
    return member;
  }
}
