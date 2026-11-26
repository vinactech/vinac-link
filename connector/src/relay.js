// Relay (0.13): when a paired device can't be reached directly (same network, then Tailscale), the
// service can carry the SAME sealed frames through Supabase Realtime instead. Nothing new is trusted:
//  - Only devices paired in person (the frames are sealed with the pairing's session keys, and the
//    receiver checks them exactly as it does on the network) AND linked to the same account.
//  - The channel is private: `relay:<account id>`. Realtime Authorization policies (see
//    supabase/migrations) let a signed-in person join and send only on their own account's channel.
//  - 0.16 team relay: the same connection also joins one private channel per team the account is in,
//    `relay-team:<team id>` (members only, see the 0.16 migration). Frames to a TEAMMATE's computer go
//    there; the daemon allows it only for computers paired in person whose key matches the team directory.
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
// 0.16: pairing with a TEAMMATE over the internet. Only on a team channel, only while that pairing is
// open (the daemon's pairGate decides), and the people still compare 6 digits on both screens.
export const TEAM_PAIR_ROUTES = new Set(['/pair/offer', '/pair/hello', '/pair/reveal', '/pair/confirm', '/pair/status', '/pair/cancel']);
// 0.16 VINAC Web: a browser signed in to the SAME account (so: only on the account channel) adds itself
// (hello, check) and then sends sealed requests (call). The daemon's webGate decides each one.
export const WEB_ROUTES = new Set(['/web/hello', '/web/check', '/web/call']);
const ID = /^[A-Za-z0-9_-]{16}$/;
const PEER = /^[0-9a-f]{16}$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });

export class Relay {
  /**
   * cloud: the account (token(), account()); meId: this device's id; onRequest(route, body, from) runs
   * a frame like the network side would; allowed(peerId) says if that device may use the relay.
   */
  constructor({ cloud, meId, onRequest, allowed, topicFor = () => null, pairGate = async () => false, webGate = async () => false, log = () => {}, WebSocketImpl = globalThis.WebSocket }) {
    Object.assign(this, { cloud, meId, onRequest, allowed, topicFor, pairGate, webGate, log, WS: WebSocketImpl });
    this.teamIds = []; this.teamJoins = new Map();   // team topic -> join ref (joined) 
    this.ws = null; this.state = 'off'; this.error = null; this.ref = 0; this.joinRef = null;
    this.pending = new Map();                   // request id -> { resolve, reject, timer }
    this.inLimiter = new RateLimiter(240);      // frames per device per minute, each way
    this.outLimiter = new RateLimiter(240);
    this.retryMs = 2000; this.wanted = false; this.pendingJoins = new Map();
  }

  get topic() { return `realtime:relay:${this.cloud.account()?.userId}`; }
  teamTopic(teamId) { return `realtime:relay-team:${teamId}`; }
  joinedTopics() { return [this.topic, ...[...this.teamJoins.keys()]]; }

  /** The teams whose channels to join (from the team directory); joins new ones, leaves old ones. */
  setTeams(ids) {
    this.teamIds = [...new Set((ids || []).filter(id => /^[0-9a-f-]{36}$/.test(String(id))))].slice(0, 5);
    if (this.ready()) this.syncTeams();
  }
  async syncTeams() {
    const want = new Set(this.teamIds.map(id => this.teamTopic(id)));
    for (const [topic, ref] of this.teamJoins) if (!want.has(topic)) { this.send({ topic, event: 'phx_leave', payload: {}, ref: String(++this.ref), join_ref: ref }); this.teamJoins.delete(topic); }
    let token; try { token = await this.cloud.token(); } catch { return; }
    for (const topic of want) if (!this.teamJoins.has(topic)) {
      const ref = String(++this.ref);
      this.pendingJoins.set(ref, topic);
      this.send({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, postgres_changes: [], private: true }, access_token: token }, ref, join_ref: ref });
    }
  }
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
      this.syncTeams();
    } catch (e) {
      clearTimeout(t);
      this.error = e.message; this.state = 'error';
      try { ws.close(); } catch { /* closed */ }
    } finally { this.onJoin = null; }
  }

  async pushToken() {
    try { const access_token = await this.cloud.token(); this.push('access_token', { access_token }); for (const [topic, ref] of this.teamJoins) this.send({ topic, event: 'access_token', payload: { access_token }, ref: String(++this.ref), join_ref: ref }); } catch (e) { this.error = e.message; }
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
    this.teamJoins.clear(); this.pendingJoins.clear();
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
  broadcast(event, payload, topic = this.topic) {
    if (topic === this.topic) return this.push('broadcast', { type: 'broadcast', event, payload });
    const ref = this.teamJoins.get(topic); if (!ref) return;
    this.send({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: String(++this.ref), join_ref: ref });
  }

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
    // A team channel's join answer: joined, or refused (not a member any more): only that channel.
    if (m.event === 'phx_reply' && this.pendingJoins.has(m.ref)) {
      const topic = this.pendingJoins.get(m.ref); this.pendingJoins.delete(m.ref);
      if (m.payload?.status === 'ok') this.teamJoins.set(topic, m.ref); else this.log(`relay: team channel refused (${topic.split(':').pop().slice(0, 8)}…)`);
      return;
    }
    if ((m.event === 'phx_error' || m.event === 'phx_close') && this.teamJoins.has(m.topic)) { this.teamJoins.delete(m.topic); return; }
    if (m.event === 'phx_error' || m.event === 'phx_close') { try { this.ws?.close(); } catch { /* closed */ } return; }
    if (m.event !== 'broadcast' || (m.topic !== this.topic && !this.teamJoins.has(m.topic))) return;
    const b = m.payload?.payload;
    if (!b || typeof b !== 'object' || b.to !== this.meId || !PEER.test(String(b.from)) || !ID.test(String(b.id))) return;
    if (m.payload.event === 'res') return this.onResponse(b);
    if (m.payload.event === 'req') return this.onRequestFrame(b, m.topic);
  }

  onResponse(b) {
    const p = this.pending.get(b.id);
    if (!p || p.peer !== b.from) return;
    this.pending.delete(b.id); clearTimeout(p.timer);
    const body = b.body && typeof b.body === 'object' && !Array.isArray(b.body) ? b.body : {};
    if (b.status === 200) p.resolve(body);
    else p.reject(Object.assign(httpError(Number(b.status) || 502, typeof body.error === 'string' ? body.error.slice(0, 300) : 'relay error'), { data: body }));
  }

  async onRequestFrame(b, topic = this.topic) {
    const reply = (status, body) => this.broadcast('res', { id: b.id, from: this.meId, to: b.from, status, body }, topic);
    const pairing = TEAM_PAIR_ROUTES.has(b.route) && topic !== this.topic;
    const web = WEB_ROUTES.has(b.route) && topic === this.topic;
    if (!RELAY_ROUTES.has(b.route) && !pairing && !web) return reply(404, { error: 'Not found' });
    if (!b.body || typeof b.body !== 'object' || Array.isArray(b.body) || b.body.from !== b.from) return reply(400, { error: 'BAD_REQUEST' });
    if (!this.inLimiter.allow(b.from)) return reply(429, { error: 'TOO_MANY_REQUESTS' });
    const ok = web ? await this.webGate(b.from, b.route) : pairing ? await this.pairGate(b.from, topic, b.route) : await this.allowed(b.from, topic === this.topic ? null : topic);
    if (!ok) return reply(403, { error: 'NOT_ON_RELAY' });
    try { reply(200, await this.onRequest(b.route, b.body, b.from)); }
    catch (e) { reply(e.status || 500, { error: e.status ? e.message : 'Internal error' }); }
  }

  /** Like postJson to the device, but through the relay. */
  request(peerId, route, body, timeoutMs = 8000, teamTopic = null) {
    if (!this.ready()) return Promise.reject(httpError(0, 'relay not connected'));
    const pairing = TEAM_PAIR_ROUTES.has(route) && teamTopic && this.teamJoins.has(teamTopic);
    const web = WEB_ROUTES.has(route) && !teamTopic; // a browser device (the web app speaks the same frames)
    if (!RELAY_ROUTES.has(route) && !pairing && !web) return Promise.reject(httpError(400, 'This does not go through the relay.'));
    if (!this.outLimiter.allow(peerId)) return Promise.reject(httpError(429, 'Too many messages through the relay. Wait a minute.'));
    const id = randomBytes(12).toString('base64url');
    const payload = { id, from: this.meId, to: peerId, route, body };
    if (JSON.stringify(payload).length > RELAY_MAX) return Promise.reject(httpError(413, `Too big for the relay (${Math.round(RELAY_MAX / 1024)} KB at most). Bigger files need a direct link: the same network or Tailscale.`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(httpError(0, 'relay timeout')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, peer: peerId });
      // A teammate's computer: on the team channel you share; your own computers: on your account's channel.
      const team = teamTopic || this.topicFor(peerId);
      this.broadcast('req', payload, team && this.teamJoins.has(team) ? team : this.topic);
    });
  }
}
