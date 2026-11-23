// Listens to the microphone stream, decodes frames, verifies them and keeps a
// record of every outcome. It never executes the requested action.
import { decodeFskFrame } from './modem.js';
import { parseFrame, verifyFrame } from './frame.js';

const BUFFER_SECONDS = 75, TICK_MS = 700;

// Plain-language results for the message feed.
export const OUTCOMES = Object.freeze({
  VERIFIED: ['Verified', 'Signature, session and freshness all check out.'],
  ALREADY_CONSUMED: ['Replay blocked', 'This exact message was already accepted once.'],
  EXPIRED: ['Expired', 'It arrived after its time limit.'],
  AUTH_FAIL: ['Wrong key', 'The signature does not match this session’s key.'],
  SESSION_MISMATCH: ['Other session', 'Sent from a different pairing link.'],
  ACTION_HASH_MISMATCH: ['Tampered', 'The request does not match what was signed.'],
  NON_CANONICAL_INTENT: ['Unknown request', 'The intent is not in the shared intent catalog.'],
  DAMAGED: ['Too damaged', 'Heard, but too much was lost to repair it.'],
});
const describe = reason => OUTCOMES[reason] || OUTCOMES[['CRC_FAIL', 'BAD_MAGIC', 'BAD_VERSION', 'INCOMPLETE_FRAME'].includes(reason) ? 'DAMAGED' : ''] || [reason, ''];

export class Receiver {
  constructor({ engine, getConfig, onEvent }) {
    this.engine = engine; this.getConfig = getConfig; this.onEvent = onEvent;
    this.chunks = []; this.samples = 0; this.timer = null; this.busy = false;
    this.replayCache = new Set();
  }

  push(chunk) {
    this.chunks.push(chunk); this.samples += chunk.length;
    const max = Math.round((this.engine.sampleRate || 48000) * BUFFER_SECONDS);
    while (this.samples > max && this.chunks.length > 1) this.samples -= this.chunks.shift().length;
  }

  get listening() { return !!this.timer; }

  async start() {
    await this.engine.startReceiver();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    this.engine.stopReceiver(); this.clear();
  }

  clear() { this.chunks = []; this.samples = 0; }

  merged() {
    const out = new Float32Array(this.samples); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  async tick() {
    if (this.busy || !this.samples || !this.engine.sampleRate) return;
    this.busy = true;
    try {
      const { session, speed, tones } = this.getConfig();
      const pcm = this.merged(), sr = this.engine.sampleRate;
      const d = decodeFskFrame(pcm, { sampleRate: sr, rawBps: speed.bps, tones });
      if (!d.ok) return;
      // Drop the decoded audio so the same frame is not read twice.
      const keep = pcm.slice(Math.min(pcm.length, d.endSample + Math.round(sr * 0.05)));
      this.chunks = keep.length ? [keep] : []; this.samples = keep.length;
      const parsed = parseFrame(d.frameBytes);
      const v = parsed.ok
        ? await verifyFrame(d.frameBytes, { sessionId: session.id, sessionKey: session.key, replayCache: this.replayCache })
        : parsed;
      const [title, detail] = describe(v.ok ? 'VERIFIED' : v.reason);
      this.onEvent({
        kind: 'received', at: new Date(), status: v.ok ? 'verified' : 'rejected', reason: v.ok ? 'VERIFIED' : v.reason,
        title, detail, text: v.ok ? v.payloadText : null, intent: v.ok ? v.intent : null, sequence: v.ok ? v.sequence : null,
        repaired: d.fecCorrected ?? null, format: d.formatVersion === 2 ? `v2 · ${d.fecStrength} repair bytes` : 'v1',
        signalDb: Number.isFinite(d.snrProxyDb) ? Math.round(d.snrProxyDb) : null,
        durationMs: Math.round((d.endSample - d.startSample) / sr * 1000),
      });
    } catch (e) {
      this.onEvent({ kind: 'error', at: new Date(), title: 'Decoder error', detail: e.message });
    } finally { this.busy = false; }
  }
}
