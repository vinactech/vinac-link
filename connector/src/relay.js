// Relay (0.13): when a paired device can't be reached directly (same network, then Tailscale), the
// service can carry the SAME sealed frames through Supabase Realtime instead. Nothing new is trusted:
//  - Only devices paired in person (the frames are sealed with the pairing's session keys, and the
//    receiver checks them exactly as it does on the network) AND linked to the same account.
//  - The channel is private: `relay:<account id>`. Realtime Authorization policies (see
//    supabase/migrations) let a signed-in person join and send only on their own account's channel.
//  - Pairing never goes through the relay; neither do the page or agent APIs.
//  - Off until the person turns it on (page only). Supabase sees device ids, which route was asked
//    (session, message, ...), sizes and times; never contents, keys or names of what is inside.
// Speaks the Realtime WebSocket protocol (Phoenix v1 JSON) with Node's built-in WebSocket.
import { randomBytes } from 'node:crypto';
import { RateLimiter } from './net.js';

const HEARTBEAT_MS = 25_000;
const JOIN_TIMEOUT_MS = 10_000;
const TOKEN_PUSH_MS = 30 * 60_000;           // pushes a fresh access token well before it expires
export const RELAY_MAX = 200 * 1024;          // one frame as JSON (Supabase Free drops broadcasts over 256 KB)
export const RELAY_ROUTES = new Set(['/noise', '/session', '/whoami', '/msg', '/secret', '/secret-ack', '/unpair']);
const ID = /^[A-Za-z0-9_-]{16}$/;
const PEER = /^[0-9a-f]{16}$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });

export class Relay {
  /**
   * cloud: the account (token(), account()); meId: this device's id; onRequest(route, body, from) runs
   * a frame like the network side would; allowed(peerId) says if that device may use the relay.
   */
  constructor({ cloud, meId, onRequest, allowed, log = () => {}, WebSocketImpl = globalThis.WebSocket }) {
    Object.assign(this, { cloud, meId, onRequest, allowed, log, WS: WebSocketImpl });
    this.ws = null; this.state = 'off'; this.error = null; this.ref = 0; this.joinRef = null;
    this.pending = new Map();                   // request id -> { resolve, reject, timer }
    this.inLimiter = new RateLimiter(240);      // frames per device per minute, each way
    this.outLimiter = new RateLimiter(240);
    this.retryMs = 2000; this.wanted = false;
  }

  get topic() { return `realtime:relay:${this.cloud.account()?.userId}`; }
  view() { return { state: this.state, ...(this.error ? { error: this.error } : {}) }; }
  ready() { return this.state === 'connected'; }

  async start() {
    this.wanted = true;
    if (this.ws) return;
    if (!this.WS) { this.state = 'error'; this.error = 'This Node.js has no WebSocket (needs Node 22 or newer).'; return; }
    if (!this.cloud.account()?.device) { this.state = 'off'; return; }
    this.state = 'connecting'; this.error = null;
    let token;
    try { token = await this.cloud.token(); }
    catch (e) { this.state = 'error'; this.error = e.message; return this.retry(); }
    if (!this.wanted) return;
    const u = new URL('/realtime/v1/websocket', this.cloud.url.replace(/^http/, 'ws'));
    u.searchParams.set('apikey', this.cloud.key); u.searchParams.set('vsn', '1.0.0');
    const ws = this.ws = new this.WS(u.toString());
    const joined = new Promise((resolve, reject) => { this.onJoin = { resolve, reject }; });
    const t = setTimeout(() => this.onJoin?.reject(new Error('The relay did not answer.')), JOIN_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      this.joinRef = String(++this.ref);
      this.push('phx_join', { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, postgres_changes: [], private: true }, access_token: token }, this.joinRef);
    });
    ws.addEventListener('message', ev => this.onFrame(ev.data));
    ws.addEventListener('close', () => { this.onJoin?.reject(new Error('The relay closed the connection.')); this.closed(); });
    ws.addEventListener('error', () => { /* close follows */ });
    try {
      await joined;
      clearTimeout(t);
      this.state = 'connected'; this.error = null; this.retryMs = 2000;
      this.log('relay connected');
      this.beat = setInterval(() => this.send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) }), HEARTBEAT_MS);
      this.refresh = setInterval(() => this.pushToken(), TOKEN_PUSH_MS);
      this.beat.unref?.(); this.refresh.unref?.();
    } catch (e) {
      clearTimeout(t);
      this.error = e.message; this.state = 'error';
      try { ws.close(); } catch { /* closed */ }
    } finally { this.onJoin = null; }
  }

  async pushToken() {
    try { this.push('access_token', { access_token: await this.cloud.token() }); } catch (e) { this.error = e.message; }
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    const ws = this.ws; this.ws = null;
    try { ws?.close(); } catch { /* closed */ }
    this.cleanup(); this.state = 'off'; this.error = null;
  }

  closed() {
    const was = this.ws; this.ws = null;
    this.cleanup();
    if (was && this.wanted) { if (this.state !== 'error') this.state = 'connecting'; this.retry(); }
  }

  cleanup() {
    clearInterval(this.beat); clearInterval(this.refresh);
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(httpError(0, 'relay closed')); }
    this.pending.clear();
  }

  retry() {
    if (!this.wanted) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.start(), this.retryMs);
    this.retryTimer.unref?.();
    this.retryMs = Math.min(this.retryMs * 2, 60_000);
  }

  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  push(event, payload, ref = String(++this.ref)) { this.send({ topic: this.topic, event, payload, ref, join_ref: this.joinRef }); }
  broadcast(event, payload) { this.push('broadcast', { type: 'broadcast', event, payload }); }

  onFrame(data) {
    let m; try { m = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.event === 'phx_reply' && m.ref === this.joinRef && this.onJoin) {
      if (m.payload?.status === 'ok') this.onJoin.resolve();
      else {
        // Supabase's reason, shortened (it never holds tokens); a brief refusal right after a settings
        // change is retried by itself.
        const reason = String(m.payload?.response?.reason || '').replace(/[^\w .:,'()-]/g, '').slice(0, 120);
        if (reason) this.log(`relay refused: ${reason}`);
        this.onJoin.reject(new Error(/unauthori[sz]ed|denied|permission/i.test(reason) ? 'The account may not use the relay (sign in again, or check the relay setup). Trying again…' : `The relay refused to connect${reason ? ` (${reason})` : ''}. Trying again…`));
      }
      return;
    }
    if (m.event === 'phx_error' || m.event === 'phx_close') { try { this.ws?.close(); } catch { /* closed */ } return; }
    if (m.event !== 'broadcast' || m.topic !== this.topic) return;
    const b = m.payload?.payload;
    if (!b || typeof b !== 'object' || b.to !== this.meId || !PEER.test(String(b.from)) || !ID.test(String(b.id))) return;
    if (m.payload.event === 'res') return this.onResponse(b);
    if (m.payload.event === 'req') return this.onRequestFrame(b);
  }

  onResponse(b) {
    const p = this.pending.get(b.id);
    if (!p || p.peer !== b.from) return;
    this.pending.delete(b.id); clearTimeout(p.timer);
    const body = b.body && typeof b.body === 'object' && !Array.isArray(b.body) ? b.body : {};
    if (b.status === 200) p.resolve(body);
    else p.reject(Object.assign(httpError(Number(b.status) || 502, typeof body.error === 'string' ? body.error.slice(0, 300) : 'relay error'), { data: body }));
  }

  async onRequestFrame(b) {
    const reply = (status, body) => this.broadcast('res', { id: b.id, from: this.meId, to: b.from, status, body });
    if (!RELAY_ROUTES.has(b.route)) return reply(404, { error: 'Not found' });
    if (!b.body || typeof b.body !== 'object' || Array.isArray(b.body) || b.body.from !== b.from) return reply(400, { error: 'BAD_REQUEST' });
    if (!this.inLimiter.allow(b.from)) return reply(429, { error: 'TOO_MANY_REQUESTS' });
    if (!(await this.allowed(b.from))) return reply(403, { error: 'NOT_ON_RELAY' });
    try { reply(200, await this.onRequest(b.route, b.body, b.from)); }
    catch (e) { reply(e.status || 500, { error: e.status ? e.message : 'Internal error' }); }
  }

  /** Like postJson to the device, but through the relay. */
  request(peerId, route, body, timeoutMs = 8000) {
    if (!this.ready()) return Promise.reject(httpError(0, 'relay not connected'));
    if (!RELAY_ROUTES.has(route)) return Promise.reject(httpError(400, 'This does not go through the relay.'));
    if (!this.outLimiter.allow(peerId)) return Promise.reject(httpError(429, 'Too many messages through the relay. Wait a minute.'));
    const id = randomBytes(12).toString('base64url');
    const payload = { id, from: this.meId, to: peerId, route, body };
    if (JSON.stringify(payload).length > RELAY_MAX) return Promise.reject(httpError(413, `Too big for the relay (${Math.round(RELAY_MAX / 1024)} KB at most). Bigger files need a direct link: the same network or Tailscale.`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(httpError(0, 'relay timeout')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, peer: peerId });
      this.broadcast('req', payload);
    });
  }
}
