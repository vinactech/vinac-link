// VINAC Link node-host commands for OpenClaw (the part that runs on the computer
// where VINAC Link runs). Each command takes structured JSON, checks it strictly,
// calls this computer's VINAC Link service through the same agent API the
// Claude Code / Codex tools use, and returns a JSON string. No shell, no
// filesystem access beyond what the VINAC Link agent API itself does.
//
// What OpenClaw agents can NOT do through these commands, by design: confirm a
// pairing, see pairing codes, read or send secret values, change firewall rules,
// approve requests, or unpair a device. Those stay with the person (the page).
import { AgentApi } from '../../connector/src/mcp.js';

const MODES = ['announce', 'listen'];
const MAX_WAIT = 30; // seconds; node invocations should stay short

class BadRequest extends Error { constructor(m) { super(m); this.code = 'REQ_INVALID'; } }

/** Parses paramsJSON into a plain object that has only the allowed keys. */
function params(paramsJSON, allowed) {
  let p = {};
  if (paramsJSON != null && paramsJSON !== '') {
    try { p = JSON.parse(paramsJSON); } catch { throw new BadRequest('params must be JSON'); }
  }
  if (p == null) p = {};
  if (typeof p !== 'object' || Array.isArray(p)) throw new BadRequest('params must be an object');
  for (const k of Object.keys(p)) if (!allowed.includes(k)) throw new BadRequest(`unknown field "${k}"`);
  return p;
}
const optStr = (v, name, max) => {
  if (v == null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new BadRequest(`${name} must be a string of at most ${max} characters`);
  return v;
};

// command -> [agent tool name, allowed fields, map params to the VINAC Link tool's arguments]
export const COMMANDS = {
  'vinac.status': ['vinac_status', [], () => ({})],
  'vinac.peers': ['vinac_peers', [], () => ({})],
  'vinac.intents': ['vinac_intents', [], () => ({})],
  'vinac.secrets': ['vinac_secrets', [], () => ({})],
  'vinac.pair_status': ['vinac_pair_status', [], () => ({})],
  'vinac.pair_request': ['vinac_pair_request', ['mode'], p => {
    if (!MODES.includes(p.mode)) throw new BadRequest('mode must be "announce" or "listen"');
    return { mode: p.mode };
  }],
  'vinac.send': ['vinac_send', ['to', 'room', 'text', 'replyTo', 'intent', 'args'], p => {
    if (p.args != null && (typeof p.args !== 'object' || Array.isArray(p.args))) throw new BadRequest('args must be an object');
    return { to: optStr(p.to, 'to', 200), room: optStr(p.room, 'room', 100), text: optStr(p.text, 'text', 8000), replyTo: optStr(p.replyTo, 'replyTo', 64), intent: optStr(p.intent, 'intent', 80), args: p.args ?? undefined };
  }],
  'vinac.file': ['vinac_file', ['id'], p => ({ id: optStr(p.id, 'id', 64) || (() => { throw new BadRequest('id is required'); })() })],
  'vinac.inbox': ['vinac_inbox', ['waitSeconds', 'all'], p => {
    if (p.waitSeconds != null && (typeof p.waitSeconds !== 'number' || !(p.waitSeconds >= 0))) throw new BadRequest('waitSeconds must be a number');
    if (p.all != null && typeof p.all !== 'boolean') throw new BadRequest('all must be true or false');
    return { waitSeconds: Math.min(MAX_WAIT, p.waitSeconds || 0), all: p.all === true };
  }],
  // For the gateway's front desk: ids, devices, intents and the waiting count only.
  // Never text or args, and nothing is marked read.
  'vinac.events': ['vinac_events', ['waitSeconds', 'since'], p => {
    if (p.waitSeconds != null && (typeof p.waitSeconds !== 'number' || !(p.waitSeconds >= 0))) throw new BadRequest('waitSeconds must be a number');
    return { waitSeconds: Math.min(MAX_WAIT, p.waitSeconds || 0), since: optStr(p.since, 'since', 64) || '' };
  }],
};
export const COMMAND_NAMES = Object.keys(COMMANDS);

/** Runs one command. `home` comes from trusted plugin config only. Never throws. */
export async function runCommand(command, paramsJSON, { home } = {}) {
  const spec = COMMANDS[command];
  if (!spec) return JSON.stringify({ ok: false, code: 'UNKNOWN_COMMAND', error: `unknown command ${command}` });
  const [tool, allowed, toArgs] = spec;
  let args;
  try { args = toArgs(params(paramsJSON, allowed)); }
  catch (e) { return JSON.stringify({ ok: false, code: e.code || 'REQ_INVALID', error: e.message }); }
  try {
    const api = new AgentApi({ home });
    await api.connect();                       // uses the running service, or starts it in the background
    const result = await api.tool(tool, args);
    return JSON.stringify({ ok: true, result });
  } catch (e) {
    return JSON.stringify({ ok: false, code: 'VINAC_ERROR', error: String(e?.message || e).slice(0, 500) });
  }
}
