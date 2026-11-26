// A local stand-in for the few Supabase endpoints VINAC Link calls (127.0.0.1 only, for tests):
// email sign-in codes, session refresh, sign-out, and the devices table with "own rows only" (RLS).
import http from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

// WebSocket framing (RFC 6455), just enough for the stand-in: client frames are masked, ours are not.
function wsHeader(op, len) {
  if (len < 126) return Buffer.from([0x80 | op, len]);
  if (len < 65536) { const b = Buffer.alloc(4); b[0] = 0x80 | op; b[1] = 126; b.writeUInt16BE(len, 2); return b; }
  const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b;
}
function wsSend(socket, text) { const d = Buffer.from(text, 'utf8'); if (!socket.destroyed) { socket.write(wsHeader(1, d.length)); socket.write(d); } }
function wsFrame(buf) {
  if (buf.length < 2) return null;
  const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80);
  let len = buf[1] & 0x7f, at = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); at = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); at = 10; }
  const mask = masked ? buf.subarray(at, at + 4) : null; if (masked) at += 4;
  if (buf.length < at + len) return null;
  const data = Buffer.from(buf.subarray(at, at + len));
  if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
  return { fin, op, data, used: at + len };
}

export async function startSupabaseMock({ key = 'sb_publishable_test', signups = true, expiresIn = 3600 } = {}) {
  const users = new Map();      // email -> { id }
  const codes = new Map();      // email -> code
  const access = new Map();     // access token -> user id
  const refresh = new Map();    // refresh token -> user id
  const devices = [];           // rows
  const requests = [];          // { method, path, body } for assertions
  const teams = [];             // { id, name, members: [{ user_id, role }] }
  const reports = [];           // team_reports rows
  const mailbox = [];           // 0.16 mailbox rows
  const state = { signups, expiresIn };

  const session = userId => {
    const a = `acc_${randomBytes(12).toString('hex')}`, r = `ref_${randomBytes(12).toString('hex')}`;
    access.set(a, userId); refresh.set(r, userId);
    return { access_token: a, refresh_token: r, expires_in: state.expiresIn, token_type: 'bearer', user: { id: userId } };
  };
  const server = http.createServer(async (req, res) => {
    // Like Supabase, browser pages may call it (the app and the console in a local check).
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'apikey, authorization, content-type, prefer');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname + url.search, body });
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.headers.apikey !== key) return send(401, { message: 'Invalid API key' });
    const who = () => access.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));

    if (req.method === 'POST' && url.pathname === '/auth/v1/otp') {
      if (!users.has(body.email) && (!state.signups || body.create_user === false)) return send(422, { error_code: 'signup_disabled', msg: 'Signups not allowed for otp' });
      if (!users.has(body.email)) users.set(body.email, { id: randomUUID() });
      codes.set(body.email, String(10_000_000 + Math.floor(Math.random() * 89_999_999)));
      return send(200, {});
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/verify') {
      if (codes.get(body.email) !== body.token) return send(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      codes.delete(body.email);
      return send(200, session(users.get(body.email).id));
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const u = refresh.get(body.refresh_token);
      if (!u) return send(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refresh.delete(body.refresh_token); // rotation, as Supabase does
      return send(200, session(u));
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/logout') { const t = String(req.headers.authorization || '').slice(7); access.delete(t); return send(204); }

    if (url.pathname === '/rest/v1/devices') {
      const u = who();
      if (!u) return send(401, { message: 'JWT expired' });
      const mine = devices.filter(d => d.user_id === u);
      // "devices: teammates read": with a user_id=in.(…) filter, the rows of those users who share a team.
      const inList = (url.searchParams.get('user_id') || '').match(/^in\.\((.*)\)$/)?.[1]?.split(',') || null;
      const shares = other => other === u || teams.some(t => t.members.some(m => m.user_id === u) && t.members.some(m => m.user_id === other));
      if (req.method === 'GET') return send(200, inList ? devices.filter(d => inList.includes(d.user_id) && shares(d.user_id)) : mine);
      if (req.method === 'POST') {
        if (body.user_id !== u) return send(403, { message: 'new row violates row-level security policy' });
        let row = devices.find(d => d.user_id === u && d.fingerprint === body.fingerprint);
        if (row) Object.assign(row, body); else devices.push(row = { id: randomUUID(), linked_at: new Date().toISOString(), ...body });
        return send(201, [row]);
      }
      if (req.method === 'PATCH') {
        const fp = (url.searchParams.get('fingerprint') || '').replace(/^eq\./, '');
        const allowed = ['last_seen_at', 'name', 'app_version', 'platform'];
        if (Object.keys(body).some(k => !allowed.includes(k))) return send(403, { message: 'permission denied for table devices' });
        for (const d of devices) if (d.user_id === u && d.fingerprint === fp) Object.assign(d, body);
        return send(204);
      }
      if (req.method === 'DELETE') {
        const fp = (url.searchParams.get('fingerprint') || '').replace(/^eq\./, ''), uid = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        for (let i = devices.length - 1; i >= 0; i--) if (devices[i].user_id === u && devices[i].user_id === uid && devices[i].fingerprint === fp) devices.splice(i, 1);
        return send(204);
      }
    }
    // Teams (the console makes them; the service only lists its own and shares summaries).
    if (url.pathname === '/rest/v1/team_members' && req.method === 'GET') {
      const u = who();
      if (!u) return send(401, { message: 'JWT expired' });
      return send(200, teams.flatMap(t => t.members.filter(m => m.user_id === u).map(m => ({ team_id: t.id, role: m.role, teams: { name: t.name } }))));
    }
    // 0.16 mailbox: the rules of the mailbox migration (own account or a teammate; recipient reads/deletes).
    if (url.pathname === '/rest/v1/mailbox') {
      const u = who();
      if (!u) return send(401, { message: 'JWT expired' });
      const shares = other => other === u || teams.some(t => t.members.some(m => m.user_id === u) && t.members.some(m => m.user_id === other));
      if (req.method === 'POST') {
        if (!shares(body.to_user) || !/^[0-9a-f]{16}$/.test(body.to_device) || !/^[A-Za-z0-9_-]+$/.test(body.sealed)) return send(403, { message: 'new row violates row-level security policy' });
        mailbox.push({ id: randomUUID(), from_user: u, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), ...body });
        return send(201);
      }
      if (req.method === 'GET') {
        const to = (url.searchParams.get('to_device') || '').replace(/^eq\./, '');
        return send(200, mailbox.filter(m => (m.to_user === u || m.from_user === u) && m.to_device === to).map(({ id, from_device, sealed, created_at }) => ({ id, from_device, sealed, created_at })));
      }
      if (req.method === 'DELETE') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const i = mailbox.findIndex(m => m.id === id && (m.to_user === u || m.from_user === u));
        if (i >= 0) mailbox.splice(i, 1);
        return send(204);
      }
    }
    if (url.pathname === '/rest/v1/rpc/team_roster' && req.method === 'POST') {
      const u = who();
      if (!u) return send(401, { message: 'JWT expired' });
      const t = teams.find(x => x.id === body.team);
      if (!t?.members.some(m => m.user_id === u)) return send(200, []);
      const email = id => [...users].find(([, v]) => v.id === id)?.[0] || null;
      return send(200, t.members.map(m => ({ user_id: m.user_id, email: email(m.user_id), role: m.role, joined_at: new Date().toISOString(), display_name: null })));
    }
    if (url.pathname === '/rest/v1/team_reports' && req.method === 'POST') {
      const u = who();
      if (!u) return send(401, { message: 'JWT expired' });
      const t = teams.find(x => x.id === body.team_id);
      if (body.user_id !== u || !t?.members.some(m => m.user_id === u) || !devices.some(d => d.user_id === u && d.fingerprint === body.fingerprint)) return send(403, { message: 'new row violates row-level security policy' });
      const i = reports.findIndex(r => r.team_id === body.team_id && r.fingerprint === body.fingerprint && r.period === body.period);
      if (i >= 0) reports[i] = body; else reports.push(body);
      return send(201);
    }
    send(404, { message: 'not found' });
  });
  // ---- Realtime (relay): a minimal WebSocket + Phoenix v1 JSON server ---------------------------
  // Private channels only ("public access" off); a session may join or send only on
  // 'realtime:relay:<its own user id>' (the Realtime Authorization policies in the relay migration).
  const sockets = new Set();
  const relayed = [];   // every broadcast that crossed the stand-in: { topic, event, payload }
  const joinsRefused = [];
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/realtime/v1/websocket' || url.searchParams.get('apikey') !== key) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client = { socket, topics: new Map(), send: obj => wsSend(socket, JSON.stringify(obj)) };
    sockets.add(client);
    let buf = Buffer.alloc(0), parts = [];
    socket.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const f = wsFrame(buf); if (!f) break;
        buf = buf.subarray(f.used);
        if (f.op === 8) { socket.end(); return; }
        if (f.op === 9) { socket.write(wsHeader(10, f.data.length)); socket.write(f.data); continue; }
        if (f.op === 1 || f.op === 0) { parts.push(f.data); if (f.fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; onPhoenix(client, text); } }
      }
    });
    socket.on('close', () => sockets.delete(client));
    socket.on('error', () => sockets.delete(client));
  });
  function onPhoenix(c, text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    const reply = (status, response = {}) => c.send({ topic: m.topic, event: 'phx_reply', payload: { status, response }, ref: m.ref, join_ref: m.join_ref ?? null });
    if (m.topic === 'phoenix' && m.event === 'heartbeat') return reply('ok');
    if (m.event === 'phx_join') {
      const u = access.get(m.payload?.access_token);
      // Own account channel, or (0.16 migration) a team channel of a team this account is a member of.
      const teamId = m.topic.startsWith('realtime:relay-team:') ? m.topic.slice('realtime:relay-team:'.length) : null;
      const okTopic = m.topic === `realtime:relay:${u}` || (teamId && teams.some(t => t.id === teamId && t.members.some(x => x.user_id === u)));
      if (!u || m.payload?.config?.private !== true || !okTopic) { joinsRefused.push(m.topic); return reply('error', { reason: 'Unauthorized: You do not have permissions to read from this Channel topic: ' + m.topic }); }
      c.topics.set(m.topic, { user: u }); return reply('ok', { postgres_changes: [] });
    }
    const t = c.topics.get(m.topic);
    if (!t) return;
    if (m.event === 'access_token') { const u = access.get(m.payload?.access_token); if (u === t.user) return; c.topics.delete(m.topic); return c.send({ topic: m.topic, event: 'phx_close', payload: {}, ref: null }); }
    if (m.event === 'broadcast') {
      if (Buffer.byteLength(text) > 256 * 1024) return; // dropped, as Supabase Free does
      relayed.push({ topic: m.topic, event: m.payload?.event, payload: m.payload?.payload });
      for (const o of sockets) if (o !== c && o.topics.has(m.topic)) o.send({ topic: m.topic, event: 'broadcast', payload: m.payload, ref: null });
    }
  }

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, key, requests, devices, codes, state, relayed, joinsRefused, teams, reports, mailbox,
    /** A team with these accounts (by email) as members; the first is its owner. */
    addTeam: (name, emails) => { const t = { id: randomUUID(), name, members: emails.map((e, i) => ({ user_id: users.get(e).id, role: i ? 'member' : 'owner' })) }; teams.push(t); return t; },
    expireAccessTokens: () => access.clear(),
    dropRelay: () => { for (const c of sockets) c.socket.destroy(); },
    relayClients: () => [...sockets].filter(c => c.topics.size).length,
    close: () => new Promise(r => { for (const c of sockets) c.socket.destroy(); server.close(r); }),
  };
}
