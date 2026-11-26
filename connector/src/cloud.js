// Optional account (0.13): sign in with an email code, link this computer to the account.
// The SERVICE talks to Supabase (plain fetch, no library); the local page never does, so its strict
// Content Security Policy stays as it is. Nothing is sent unless the person acts on the page.
// Sent to Supabase: the email address (to sign in), and for a linked computer its name, identity
// fingerprint and public key, platform and app version. Never messages, secrets or audit entries.
// The session's refresh token is kept by the OS key store (like every other key here).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { protect, unprotect, forget, detectKeystore } from './keystore.js';
import { env } from './env.js';

// The production project. Both values are public by design: the publishable key only reaches what
// Row Level Security allows each signed-in person. Tests point VINAC_CLOUD_URL at a local stand-in.
export const CLOUD_URL = 'https://qjfwfyfgjsaqlpuuyxod.supabase.co';
export const CLOUD_KEY = 'sb_publishable_upJnHy2MvsqJibxIO7lx5Q_rsIEgKEh';
const TIMEOUT_MS = 10_000;
const CODE_MS = 15 * 60_000; // matches the project's email code lifetime
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Turns a Supabase error into something a person can act on (never echoes tokens). */
function friendly(status, body) {
  const code = String(body?.error_code || body?.code || body?.error || '');
  const msg = String(body?.msg || body?.message || body?.error_description || '');
  if (/signup.*(disabled|not allowed)|signups not allowed/i.test(code + msg)) return httpError(403, 'Accounts aren\'t open for sign-up yet. VINAC Link works fully without one.');
  if (status === 429 || /rate.?limit|over_email_send_rate/i.test(code + msg)) return httpError(429, 'Too many codes asked for. Wait a minute, then try again.');
  if (/otp_expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(code + msg)) return httpError(400, 'That code is wrong or has expired. Ask for a new one.');
  if (status === 401 || status === 403) return httpError(401, 'The account session ended. Sign in again.');
  return httpError(status >= 500 ? 502 : status || 502, `The account service said: ${msg.slice(0, 160) || `error ${status}`}`);
}

export class Cloud {
  constructor(store, { url = env('CLOUD_URL') || CLOUD_URL, key = env('CLOUD_KEY') || CLOUD_KEY, fetchImpl = fetch } = {}) {
    this.store = store; this.url = url.replace(/\/+$/, ''); this.key = key; this.fetch = fetchImpl;
    this.pending = null;   // { email, until } while a code is on its way
    this.session = null;   // { access, expiresAt } in memory only
  }

  file() { return this.store.file('account.json'); }
  account() { try { return JSON.parse(fs.readFileSync(this.file(), 'utf8')); } catch { return null; } }
  saveAccount(a) { this.store.writeJson('account.json', a); }

  async call(method, path, { body, token, headers = {} } = {}) {
    let r;
    try {
      r = await this.fetch(`${this.url}${path}`, {
        method, signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { apikey: this.key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw httpError(502, 'Could not reach the account service. Check the internet connection; everything else keeps working without it.'); }
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) throw friendly(r.status, data);
    return data;
  }

  /** What the page shows. Never includes tokens. */
  view() {
    const a = this.account();
    return {
      signedIn: !!a, email: a?.email || null, linked: !!a?.device, device: a?.device || null,
      pendingEmail: this.pending && Date.now() < this.pending.until ? this.pending.email : null,
      service: new URL(this.url).host,
    };
  }

  /** Step 1: email a sign-in code. */
  async start(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(e)) throw httpError(400, 'Type a valid email address.');
    if (this.account()) throw httpError(409, 'This computer is already signed in. Sign out first.');
    await this.call('POST', '/auth/v1/otp', { body: { email: e, create_user: true } });
    this.pending = { email: e, until: Date.now() + CODE_MS };
    return this.view();
  }

  /** Step 2: the code from the email. Keeps the refresh token in the OS key store. */
  async verify(code) {
    const c = String(code || '').replace(/\s+/g, '');
    if (!this.pending || Date.now() > this.pending.until) throw httpError(409, 'Ask for a sign-in code first.');
    if (!/^\d{6,10}$/.test(c)) throw httpError(400, 'The code is the digits from the email.');
    const s = await this.call('POST', '/auth/v1/verify', { body: { type: 'email', email: this.pending.email, token: c } });
    if (!s?.access_token || !s?.refresh_token || !s?.user?.id) throw httpError(502, 'The account service gave an incomplete answer. Try again.');
    this.keepSession(s, { email: this.pending.email, userId: s.user.id });
    this.pending = null;
    return this.view();
  }

  keepSession(s, base) {
    // One label per VINAC Link home, so test homes never touch the real one's key store entry.
    const label = `agentlink.account.${createHash('sha256').update(this.store.home).digest('hex').slice(0, 16)}`;
    const w = protect(detectKeystore(), label, Buffer.from(s.refresh_token, 'utf8'));
    const old = this.account() || {};
    this.saveAccount({ v: 1, ...old, ...base, keystore: w.kind, keyLabel: label, wrapped: w.stored, signedInAt: old.signedInAt || new Date().toISOString() });
    this.session = { access: s.access_token, expiresAt: Date.now() + Math.max(60, Number(s.expires_in) || 3600) * 1000 - 60_000 };
  }

  /** A valid access token, refreshed when needed. */
  async token() {
    const a = this.account();
    if (!a) throw httpError(401, 'Sign in first.');
    if (this.session && Date.now() < this.session.expiresAt) return this.session.access;
    const refresh = unprotect(a.keystore, a.keyLabel, a.wrapped).toString('utf8');
    const s = await this.call('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refresh } });
    if (!s?.access_token || !s?.refresh_token) throw httpError(401, 'The account session ended. Sign in again.');
    this.keepSession(s, { email: a.email, userId: a.userId });
    return this.session.access;
  }

  /** Links this computer: its name, fingerprint, public key, platform and version. */
  async link({ name, fingerprint, publicKey, platform = process.platform, version }) {
    const a = this.account();
    if (!a) throw httpError(401, 'Sign in first.');
    const row = { user_id: a.userId, fingerprint, public_key: publicKey, name: String(name).slice(0, 60), platform: ['win32', 'darwin', 'linux'].includes(platform) ? platform : null, app_version: version || null, last_seen_at: new Date().toISOString() };
    const out = await this.call('POST', '/rest/v1/devices?on_conflict=user_id,fingerprint', { token: await this.token(), body: row, headers: { prefer: 'resolution=merge-duplicates,return=representation' } });
    const d = Array.isArray(out) ? out[0] : out;
    this.saveAccount({ ...this.account(), device: { id: d?.id || null, fingerprint, name: row.name, linkedAt: d?.linked_at || new Date().toISOString() } });
    return this.view();
  }

  async unlink() {
    const a = this.account();
    if (!a?.device) return this.view();
    await this.call('DELETE', `/rest/v1/devices?user_id=eq.${encodeURIComponent(a.userId)}&fingerprint=eq.${encodeURIComponent(a.device.fingerprint)}`, { token: await this.token() });
    const { device, ...rest } = a;
    this.saveAccount(rest);
    return this.view();
  }

  /** The computers linked to this account (names, fingerprints, platform, version, last seen). */
  async devices() {
    const rows = await this.call('GET', '/rest/v1/devices?select=id,fingerprint,name,platform,app_version,linked_at,last_seen_at&order=linked_at.asc', { token: await this.token() });
    return Array.isArray(rows) ? rows : [];
  }

  /** While linked: "last seen" (and name, version) for the console, every 15 minutes. */
  async touch({ name, version }) {
    const a = this.account();
    if (!a?.device) return;
    await this.call('PATCH', `/rest/v1/devices?user_id=eq.${encodeURIComponent(a.userId)}&fingerprint=eq.${encodeURIComponent(a.device.fingerprint)}`, {
      token: await this.token(), body: { last_seen_at: new Date().toISOString(), name: String(name).slice(0, 60), app_version: version || null },
    });
  }

  /** The teams this account belongs to: [{ id, name, role }]. */
  async teams() {
    const a = this.account();
    if (!a) throw httpError(401, 'Sign in first.');
    const rows = await this.call('GET', `/rest/v1/team_members?select=team_id,role,teams(name)&user_id=eq.${encodeURIComponent(a.userId)}`, { token: await this.token() });
    return (Array.isArray(rows) ? rows : []).map(r => ({ id: r.team_id, name: r.teams?.name || '', role: r.role }));
  }

  /**
   * 0.16 team directory: each team with its members (email, role) and their linked computers (name,
   * fingerprint, public key, platform, version, last seen). Row Level Security lets a member read
   * only teams they belong to and teammates' computers. Read only.
   */
  async teamDirectory() {
    const teams = (await this.teams()).slice(0, 5);
    const token = await this.token();
    const out = [];
    for (const t of teams) {
      const roster = await this.call('POST', '/rest/v1/rpc/team_roster', { token, body: { team: t.id } });
      out.push({ ...t, members: (Array.isArray(roster) ? roster : []).slice(0, 50).map(r => ({ userId: r.user_id, email: r.email || null, role: r.role, name: r.display_name || null, devices: [] })) });
    }
    const ids = [...new Set(out.flatMap(t => t.members.map(m => m.userId)))].filter(id => /^[0-9a-f-]{36}$/.test(id));
    const rows = ids.length ? await this.call('GET', `/rest/v1/devices?select=user_id,fingerprint,public_key,name,platform,app_version,last_seen_at&user_id=in.(${ids.join(',')})`, { token }) : [];
    for (const t of out) for (const m of t.members) m.devices = (Array.isArray(rows) ? rows : []).filter(d => d.user_id === m.userId)
      .map(d => ({ fingerprint: d.fingerprint, publicKey: d.public_key, name: d.name, platform: d.platform, version: d.app_version, lastSeenAt: d.last_seen_at }));
    return out;
  }

  // ---- 0.16 mailbox: sealed items for a computer that isn't connected (up to 7 days) ----------
  // The service stores only the sealed bytes, which device it is from and to, and times. Only the two
  // computers can open an item (it is sealed with their pairing key).
  async mailboxPut({ teamId = null, toUser, fromDevice, toDevice, sealed }) {
    await this.call('POST', '/rest/v1/mailbox', { token: await this.token(), body: { team_id: teamId, to_user: toUser, from_device: fromDevice, to_device: toDevice, sealed }, headers: { prefer: 'return=minimal' } });
  }
  async mailboxTake(toDevice) {
    const rows = await this.call('GET', `/rest/v1/mailbox?select=id,from_device,sealed,created_at&to_device=eq.${encodeURIComponent(toDevice)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.asc&limit=50`, { token: await this.token() });
    return Array.isArray(rows) ? rows : [];
  }
  async mailboxDelete(id) {
    await this.call('DELETE', `/rest/v1/mailbox?id=eq.${encodeURIComponent(id)}`, { token: await this.token() });
  }

  /** Shares one month's signed activity summary (counts only) with a team; again for the same month replaces it. */
  async shareReport({ team, fingerprint, period, payload, signature }) {
    const a = this.account();
    if (!a?.device) throw httpError(409, 'Link this computer to your account first.');
    await this.call('POST', '/rest/v1/team_reports?on_conflict=team_id,fingerprint,period', {
      token: await this.token(), headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { team_id: team, user_id: a.userId, fingerprint, period, payload, signature, created_at: new Date().toISOString() },
    });
  }

  /** Signs out here: ends the session at Supabase (best effort) and forgets it locally. */
  async signOut() {
    const a = this.account();
    if (!a) return this.view();
    try { await this.call('POST', '/auth/v1/logout?scope=local', { token: await this.token() }); } catch { /* offline: forget locally anyway */ }
    try { forget(a.keystore, a.keyLabel); } catch { /* already gone */ }
    try { fs.rmSync(this.file(), { force: true }); } catch { /* gone */ }
    this.session = null; this.pending = null;
    return this.view();
  }
}
