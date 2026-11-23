// VINAC Link Team console. Runs in the browser and talks only to the account service (Supabase) with
// its publishable key; Row Level Security decides what each signed-in person may see or change (see
// supabase/migrations). The session lives in this tab only (sessionStorage). No outside code.
// Text from the service is always set with textContent, never as HTML.
const CLOUD_URL = '{{cloud_url}}';
const CLOUD_KEY = '{{cloud_key}}';
const ONLINE_MS = 20 * 60_000;
const SKEY = 'vinac.console.session';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const PLATFORM = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

// ---- session -----------------------------------------------------------------------------
let session = null;
try { session = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch { session = null; }
const saveSession = s => { session = s; try { s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY); } catch { /* private window */ } };
let pendingEmail = null;

function keep(s) {
  saveSession({ access: s.access_token, refresh: s.refresh_token, expiresAt: Date.now() + (Number(s.expires_in) || 3600) * 1000 - 60_000, userId: s.user?.id || session?.userId, email: s.user?.email || session?.email });
}

function friendly(status, b) {
  const t = `${b?.error_code || b?.code || ''} ${b?.msg || b?.message || b?.error_description || ''}`;
  if (/signup.*(disabled|not allowed)|signups not allowed/i.test(t)) return 'Accounts aren\'t open for sign-up yet.';
  if (status === 429 || /rate.?limit/i.test(t)) return 'Too many tries. Wait a minute, then try again.';
  if (/otp_expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(t)) return 'That code is wrong or has expired. Ask for a new one.';
  if (/row-level security|permission denied/i.test(t)) return 'You can\'t do that in this team.';
  if (/duplicate key.*team_invites/i.test(t)) return 'That email already has an invitation to this team.';
  const m = String(b?.message || b?.msg || '').slice(0, 160);
  return m || `The account service said: error ${status}`;
}

async function call(method, path, { body, headers = {}, auth = true } = {}) {
  if (auth) await fresh();
  let r;
  try {
    r = await fetch(`${CLOUD_URL}${path}`, { method, headers: { apikey: CLOUD_KEY, 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${session.access}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error('Could not reach the account service. Check the connection.'); }
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (r.status === 401 && auth) { saveSession(null); show(); throw new Error('The session ended. Sign in again.'); }
  if (!r.ok) throw new Error(friendly(r.status, data));
  return data;
}

async function fresh() {
  if (!session) throw new Error('Sign in first.');
  if (Date.now() < session.expiresAt) return;
  const r = await fetch(`${CLOUD_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: CLOUD_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh }) }).catch(() => null);
  if (!r?.ok) { saveSession(null); show(); throw new Error('The session ended. Sign in again.'); }
  keep(await r.json());
}
const rpc = (fn, args) => call('POST', `/rest/v1/rpc/${fn}`, { body: args });
const q = encodeURIComponent;

// ---- small UI helpers ----------------------------------------------------------------------
let toastTimer;
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.hidden = true; }, 4200); }
async function act(fn, done) { try { const r = await fn(); if (done) toast(done); return r; } catch (e) { toast(e.message); return undefined; } }
function none(ul, text) { ul.replaceChildren(el('li', 'none', text)); }
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
function deviceRow(d, owner) {
  const li = el('li');
  const t = el('div', 'txt');
  t.append(el('b', null, d.name), el('small', 'mono', [d.fingerprint, PLATFORM[d.platform] || '', d.app_version ? `v${d.app_version}` : '', owner || ''].filter(Boolean).join(' · ')));
  const on = d.last_seen_at && Date.now() - Date.parse(d.last_seen_at) < ONLINE_MS;
  li.append(t, el('span', `pill ${on ? 'ok' : ''}`, on ? 'Online' : `Last seen ${ago(d.last_seen_at)}`));
  return li;
}

// ---- views -----------------------------------------------------------------------------------
function show() {
  const signedIn = !!session;
  $('vSignIn').hidden = signedIn; $('vMain').hidden = !signedIn; $('who').hidden = !signedIn;
  $('emailForm').hidden = !!pendingEmail; $('codeForm').hidden = !pendingEmail;
  $('codeTo').textContent = pendingEmail || '';
  if (signedIn) { $('whoEmail').textContent = session.email || ''; load(); }
}

$('emailForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('email').value.trim().toLowerCase();
  await act(async () => { await call('POST', '/auth/v1/otp', { auth: false, body: { email, create_user: true } }); pendingEmail = email; show(); $('code').focus(); }, 'Code sent. Check your email.');
};
$('codeForm').onsubmit = async e => {
  e.preventDefault();
  const token = $('code').value.replace(/\s+/g, ''); $('code').value = '';
  await act(async () => { const s = await call('POST', '/auth/v1/verify', { auth: false, body: { type: 'email', email: pendingEmail, token } }); keep(s); pendingEmail = null; show(); });
};
$('otherEmail').onclick = () => { pendingEmail = null; show(); $('email').focus(); };
$('signOut').onclick = async () => {
  try { await call('POST', '/auth/v1/logout?scope=local'); } catch { /* ends locally anyway */ }
  saveSession(null); selected = null; show();
};

// ---- the signed-in console -------------------------------------------------------------------
let teams = [], selected = null;

async function load() {
  await Promise.all([loadInvites(), loadMyDevices(), loadTeams()]);
}

async function loadInvites() {
  const rows = await act(() => call('GET', `/rest/v1/team_invites?select=id,role,expires_at,teams(name)&email=eq.${q(session.email || '')}`)) || [];
  $('invitesForMe').hidden = !rows.length;
  $('myInvites').replaceChildren(...rows.map(i => {
    const li = el('li'); const t = el('div', 'txt');
    t.append(el('b', null, i.teams?.name || 'A team'), el('small', null, `As ${i.role} · until ${new Date(i.expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`));
    const accept = el('button', 'btn small primary', 'Accept'), decline = el('button', 'btn small quiet', 'Decline');
    accept.onclick = async () => { if (await act(() => rpc('accept_invite', { invite: i.id }), 'You joined the team.') !== undefined) load(); };
    decline.onclick = async () => { await act(() => call('DELETE', `/rest/v1/team_invites?id=eq.${q(i.id)}`), 'Invitation declined.'); loadInvites(); };
    li.append(t, accept, decline); return li;
  }));
}

async function loadMyDevices() {
  const rows = await act(() => call('GET', `/rest/v1/devices?select=name,fingerprint,platform,app_version,last_seen_at&user_id=eq.${q(session.userId)}&order=linked_at.asc`)) || [];
  if (!rows.length) return none($('myDevices'), 'No computers linked yet. In VINAC Link, open Account, sign in with this email and choose "Link this computer".');
  $('myDevices').replaceChildren(...rows.map(d => deviceRow(d)));
}

async function loadTeams() {
  teams = (await act(() => call('GET', `/rest/v1/team_members?select=team_id,role,teams(name)&user_id=eq.${q(session.userId)}`)) || []).map(r => ({ id: r.team_id, role: r.role, name: r.teams?.name || '' }));
  if (!teams.length) { none($('teamList'), 'No teams yet. Create one below, or accept an invitation.'); selected = null; }
  else {
    if (!teams.some(t => t.id === selected)) selected = teams[0].id;
    $('teamList').replaceChildren(...teams.map(t => {
      const li = el('li', `pick${t.id === selected ? ' sel' : ''}`); li.tabIndex = 0;
      const tx = el('div', 'txt'); tx.append(el('b', null, t.name));
      li.append(tx, el('span', 'pill', t.role));
      li.onclick = li.onkeydown = ev => { if (ev.type === 'keydown' && ev.key !== 'Enter') return; selected = t.id; loadTeams(); };
      return li;
    }));
  }
  await loadTeam();
}

$('newTeamForm').onsubmit = async e => {
  e.preventDefault();
  const id = await act(() => rpc('create_team', { team_name: $('newTeamName').value.trim() }), 'Team created.');
  if (id) { $('newTeamName').value = ''; selected = id; loadTeams(); }
};

async function loadTeam() {
  const t = teams.find(x => x.id === selected);
  $('teamPanel').hidden = !t;
  if (!t) return;
  const admin = t.role === 'owner' || t.role === 'admin';
  $('teamName').textContent = t.name;
  $('renameTeam').hidden = !admin; $('deleteTeam').hidden = t.role !== 'owner'; $('leaveTeam').hidden = t.role === 'owner';
  $('inviteBox').hidden = !admin;
  $('inviteRole').querySelector('[value=admin]').disabled = t.role !== 'owner';

  const roster = await act(() => rpc('team_roster', { team: t.id })) || [];
  $('members').replaceChildren(...roster.map(m => {
    const li = el('li'); const tx = el('div', 'txt');
    tx.append(el('b', null, m.display_name || m.email), el('small', null, `${m.email}${m.user_id === session.userId ? ' (you)' : ''} · joined ${ago(m.joined_at)}`));
    li.append(tx);
    if (t.role === 'owner' && m.role !== 'owner') {
      const sel = el('select'); sel.setAttribute('aria-label', `Role of ${m.email}`);
      for (const r of ['member', 'admin']) { const o = new Option(r[0].toUpperCase() + r.slice(1), r); o.selected = m.role === r; sel.append(o); }
      sel.onchange = async () => { await act(() => call('PATCH', `/rest/v1/team_members?team_id=eq.${q(t.id)}&user_id=eq.${q(m.user_id)}`, { body: { role: sel.value } }), 'Role changed.'); loadTeam(); };
      li.append(sel);
    } else li.append(el('span', 'pill', m.role));
    if (admin && m.role !== 'owner' && m.user_id !== session.userId) {
      const rm = el('button', 'btn small danger', 'Remove');
      rm.onclick = async () => { if (!confirm(`Remove ${m.email} from ${t.name}?`)) return; await act(() => call('DELETE', `/rest/v1/team_members?team_id=eq.${q(t.id)}&user_id=eq.${q(m.user_id)}`), 'Removed.'); loadTeam(); };
      li.append(rm);
    }
    return li;
  }));

  if (admin) {
    const inv = await act(() => call('GET', `/rest/v1/team_invites?select=id,email,role,expires_at&team_id=eq.${q(t.id)}&order=created_at.asc`)) || [];
    if (!inv.length) none($('pendingInvites'), 'No invitations waiting.');
    else $('pendingInvites').replaceChildren(...inv.map(i => {
      const li = el('li'); const tx = el('div', 'txt');
      const expired = Date.parse(i.expires_at) < Date.now();
      tx.append(el('b', null, i.email), el('small', null, `${i.role} · ${expired ? 'expired' : `until ${new Date(i.expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`}`));
      const rv = el('button', 'btn small quiet', 'Revoke');
      rv.onclick = async () => { await act(() => call('DELETE', `/rest/v1/team_invites?id=eq.${q(i.id)}`), 'Invitation revoked.'); loadTeam(); };
      li.append(tx, el('span', `pill ${expired ? 'warn' : ''}`, expired ? 'Expired' : 'Waiting'), rv); return li;
    }));
  }

  // Team computers: every linked computer of every member (RLS shows teammates' devices).
  const ids = roster.map(m => m.user_id);
  const devices = ids.length ? (await act(() => call('GET', `/rest/v1/devices?select=user_id,name,fingerprint,public_key,platform,app_version,last_seen_at&user_id=in.(${ids.map(q).join(',')})&order=name.asc`)) || []) : [];
  const emailOf = Object.fromEntries(roster.map(m => [m.user_id, m.email]));
  if (!devices.length) none($('teamDevices'), 'No member has linked a computer yet.');
  else $('teamDevices').replaceChildren(...devices.map(d => deviceRow(d, emailOf[d.user_id])));

  const reports = await act(() => call('GET', `/rest/v1/team_reports?select=user_id,fingerprint,period,payload,signature,created_at&team_id=eq.${q(t.id)}&order=period.desc,created_at.desc&limit=100`)) || [];
  if (!reports.length) { none($('reports'), 'Nothing shared yet.'); return; }
  const keyOf = Object.fromEntries(devices.map(d => [d.fingerprint, d.public_key]));
  $('reports').replaceChildren(...await Promise.all(reports.map(async r => {
    const li = el('li'); const tx = el('div', 'txt');
    let p = null; try { p = JSON.parse(r.payload); } catch { p = null; }
    const check = await verify(keyOf[r.fingerprint], r.payload, r.signature, p, t.id, r);
    tx.append(el('b', null, `${r.period} · ${p?.device?.name || r.fingerprint}`), el('small', null, `${emailOf[r.user_id] || 'former member'} · shared ${ago(r.created_at)}`));
    li.append(tx, el('span', `pill ${check.ok ? 'ok' : check.ok === false ? 'bad' : 'warn'}`, check.label));
    if (p?.summary) {
      const s = p.summary, c = el('div', 'counts');
      const add = (k, v) => c.append(el('span', null, `${k}: ${v}`));
      add('Events', s.total);
      for (const [k, v] of Object.entries(s.byCategory || {})) add(k, v);
      add('Approvals', s.approvals); add('Denials', s.denials); add('Agents', s.agents); add('Keys used', s.keysUsed);
      if (p.chainOk === false) c.append(el('span', null, 'Log chain: broken'));
      li.append(c);
    }
    return li;
  })));
}

/** Checks a summary's signature with the computer's public key (WebCrypto Ed25519). */
async function verify(publicKey, payload, signature, p, teamId, row) {
  if (!p || p.team !== teamId || p.period !== row.period || p.device?.fingerprint !== row.fingerprint) return { ok: false, label: 'Does not match' };
  if (!publicKey) return { ok: null, label: 'Computer no longer linked' };
  try {
    const b = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', b(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return (await crypto.subtle.verify({ name: 'Ed25519' }, key, b(signature), new TextEncoder().encode(payload))) ? { ok: true, label: 'Signature OK' } : { ok: false, label: 'Signature wrong' };
  } catch { return { ok: null, label: 'This browser can\'t check signatures' }; }
}

$('inviteForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('inviteEmail').value.trim().toLowerCase();
  const ok = await act(() => call('POST', '/rest/v1/team_invites', { body: { team_id: selected, email, role: $('inviteRole').value } }), `Invitation saved. Ask ${email} to sign in here with that email to accept.`);
  if (ok !== undefined) { $('inviteEmail').value = ''; loadTeam(); }
};
$('renameTeam').onclick = async () => {
  const t = teams.find(x => x.id === selected); const name = prompt('Team name', t?.name || '');
  if (!name || !name.trim()) return;
  await act(() => call('PATCH', `/rest/v1/teams?id=eq.${q(selected)}`, { body: { name: name.trim().slice(0, 60) } }), 'Renamed.'); loadTeams();
};
$('deleteTeam').onclick = async () => {
  const t = teams.find(x => x.id === selected);
  if (!confirm(`Delete the team "${t?.name}"? Its members, invitations and shared summaries are removed. Computers stay linked to their own accounts.`)) return;
  await act(() => call('DELETE', `/rest/v1/teams?id=eq.${q(selected)}`), 'Team deleted.'); selected = null; loadTeams();
};
$('leaveTeam').onclick = async () => {
  const t = teams.find(x => x.id === selected);
  if (!confirm(`Leave "${t?.name}"?`)) return;
  await act(() => call('DELETE', `/rest/v1/team_members?team_id=eq.${q(selected)}&user_id=eq.${q(session.userId)}`), 'You left the team.'); selected = null; load();
};

show();
