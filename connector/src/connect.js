// Connect Claude Code to VINAC Link without the `claude` command (0.15).
//
// Two ways Claude Code can know VINAC Link:
//  - the plugin (tools, skills, hooks), installed with `claude plugin install vinac-link@vinac`.
//    Its commands start `node`, so it only works where a Node.js 22+ is on Claude Code's PATH.
//  - "direct": an MCP server entry in Claude Code's user config (~/.claude.json) plus the same
//    hooks in ~/.claude/settings.json, both pointing at THIS copy's own Node.js and vinac.mjs by
//    absolute path. No PATH, no `claude` command, and it follows app updates (same paths).
//
// connectClaude() keeps one of them: if the plugin is installed and enabled it removes the direct
// entries (no tool twice); otherwise it writes the direct entries. Every file it changes is backed
// up first (<file>.vinac-backup, the first time only, so the original survives repeated runs).
// Only the person runs this (CLI or the page); agents have no tool or API route for it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(ROOT, 'connector', 'bin', 'vinac.mjs');
const CURRENT = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'connector', 'package.json'), 'utf8')).version; } catch { return null; } })();
export const PLUGIN_ID = 'vinac-link@vinac';
export const SERVER = 'vinac';
const HOOKS = [
  ['SessionStart', 'session-start', { matcher: 'startup|resume', timeout: 5 }],
  ['UserPromptSubmit', 'prompt', { timeout: 5 }],
  ['PostToolUse', 'tool', { timeout: 5 }],
  ['Stop', 'wait', { timeout: 1320, asyncRewake: true }],
];

/** Where Claude Code keeps its settings: CLAUDE_CONFIG_DIR, else ~/.claude. VINAC_CLAUDE_DIR is for tests. */
export function claudePaths({ dir, env = process.env } = {}) {
  const custom = dir || env.VINAC_CLAUDE_DIR || env.CLAUDE_CONFIG_DIR;
  const base = custom || path.join(os.homedir(), '.claude');
  return {
    dir: base,
    settings: path.join(base, 'settings.json'),
    // With a custom config dir Claude Code keeps .claude.json inside it; by default it sits in the home folder.
    config: custom ? path.join(base, '.claude.json') : path.join(os.homedir(), '.claude.json'),
    installed: path.join(base, 'plugins', 'installed_plugins.json'),
  };
}

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`${f} is not valid JSON, so it was left alone (${e.message}).`); } };
function writeJson(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f) && !fs.existsSync(`${f}.vinac-backup`)) fs.copyFileSync(f, `${f}.vinac-backup`);
  const tmp = `${f}.vinac-tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

const slash = p => p.replace(/\\/g, '/');
/** The command line a hook runs: this copy's Node.js and vinac.mjs, quoted (works in sh and cmd). */
export const hookCommand = (event, { node = process.execPath, bin = BIN, as = '' } = {}) => `"${slash(node)}" "${slash(bin)}" hook ${event}${as ? ` --as ${as}` : ''}`;
const isOurHook = cmd => typeof cmd === 'string' && /vinac\.mjs"?\s+hook\s/.test(cmd);
const isOurServer = s => !!s && Array.isArray(s.args) && s.args.some(a => /vinac\.mjs$/.test(String(a))) && s.args.includes('mcp');

/** What Claude Code on this computer knows about VINAC Link. Reads only. */
export function claudeStatus({ dir, env, node = process.execPath, bin = BIN } = {}) {
  const p = claudePaths({ dir, env });
  const present = fs.existsSync(p.dir) || fs.existsSync(p.config);
  let settings = null, config = null, installed = null, error = null;
  try { settings = readJson(p.settings); config = readJson(p.config); installed = readJson(p.installed); } catch (e) { error = e.message; }
  const inst = installed?.plugins?.[PLUGIN_ID];
  const plugin = {
    enabled: settings?.enabledPlugins?.[PLUGIN_ID] === true,
    installed: Array.isArray(inst) ? inst.length > 0 : !!inst,
    version: Array.isArray(inst) ? inst[0]?.version || null : null,
  };
  // The plugin is a copy Claude Code made when it was installed: it can fall behind this VINAC Link.
  plugin.outdated = !!(plugin.installed && plugin.version && CURRENT && plugin.version !== CURRENT);
  const server = config?.mcpServers?.[SERVER] || null;
  const hooks = HOOKS.filter(([ev]) => (settings?.hooks?.[ev] || []).some(g => (g.hooks || []).some(h => isOurHook(h.command)))).length;
  const direct = {
    server: !!server && isOurServer(server),
    current: !!server && slash(server.command || '') === slash(node) && (server.args || []).map(slash).includes(slash(bin)),
    identity: !!server?.env?.VINAC_AGENT_TOKEN,   // its own agent identity (never the token itself here)
    hooks,
  };
  // An entry named vinac that someone added by hand (e.g. `claude mcp add vinac -- node …`): it starts
  // `node` from the PATH, and it duplicates the plugin's tools.
  const manual = !!server && !direct.current;
  const mode = plugin.enabled && plugin.installed ? 'plugin' : direct.current && hooks === HOOKS.length ? 'direct' : direct.server || server ? 'partial' : 'none';
  return { present, mode, plugin, direct, manual, error, paths: { settings: p.settings, config: p.config } };
}

/** Refuses a copy that would vanish (a mounted disk image, a temp or download folder). */
export function connectableCopy(bin = BIN) {
  const b = slash(bin);
  if (/^\/Volumes\//.test(b)) return 'VINAC Link is running from the disk image. Drag it to Applications, open it from there, then connect.';
  if (/\/AppTranslocation\//.test(b)) return 'macOS is running VINAC Link from a temporary place. Move it to Applications, open it from there, then connect.';
  return null;
}

/**
 * Connects Claude Code to this copy of VINAC Link (or tidies up when the plugin already does).
 * Returns { ok, mode, changed: [files], message, status }.
 */
export function connectClaude({ dir, env, node = process.execPath, bin = BIN, agent = null, replacePlugin = false } = {}) {
  const p = claudePaths({ dir, env });
  const before = claudeStatus({ dir, env, node, bin });
  if (before.error) return { ok: false, mode: before.mode, changed: [], message: before.error, status: before };
  const changed = [];
  const settings = readJson(p.settings) || {};
  const config = readJson(p.config) || {};

  // Switch from the plugin to the direct connection (own identity, always this copy's code): turn the
  // plugin off in Claude Code's settings (it stays installed; turning it on again is one click there).
  if (replacePlugin && before.plugin.enabled) {
    const why = connectableCopy(bin);
    if (why) return { ok: false, mode: before.mode, changed: [], message: why, status: before };
    settings.enabledPlugins = { ...(settings.enabledPlugins || {}), [PLUGIN_ID]: false };
    writeJson(p.settings, settings); changed.push(p.settings);
    before.plugin.enabled = false;
  }

  if (before.plugin.enabled && before.plugin.installed) {
    // The plugin already brings tools and hooks: remove our direct entries and a hand-made one.
    const r = removeDirect(settings, config, { keepManual: false });
    if (r.settings) { writeJson(p.settings, settings); changed.push(p.settings); }
    if (r.config) { writeJson(p.config, config); changed.push(p.config); }
    return { ok: true, mode: 'plugin', changed, status: claudeStatus({ dir, env, node, bin }),
      message: changed.length ? 'Claude Code already has the VINAC Link plugin; removed the extra entries so no tool shows twice.' : 'Claude Code already has the VINAC Link plugin. Nothing to change.' };
  }

  const why = connectableCopy(bin);
  if (why) return { ok: false, mode: before.mode, changed: [], message: why, status: before };

  config.mcpServers ||= {};
  // With an agent identity (made when the person presses Connect on the page), the tools act as that
  // agent and the hooks leave out its own posts. Without one, the computer's default agent token.
  const as = agent?.id || '';
  const server = { type: 'stdio', command: node, args: [bin, 'mcp'], env: agent?.token ? { VINAC_AGENT_TOKEN: agent.token } : {} };
  if (JSON.stringify(config.mcpServers[SERVER]) !== JSON.stringify(server)) { config.mcpServers[SERVER] = server; writeJson(p.config, config); changed.push(p.config); }

  const ours = Object.entries(settings.hooks || {}).flatMap(([ev, gs]) => (Array.isArray(gs) ? gs : []).flatMap(g => (g.hooks || []).filter(h => isOurHook(h.command)).map(h => `${ev} ${h.command}`)));
  const want = HOOKS.map(([ev, arg]) => `${ev} ${hookCommand(arg, { node, bin, as })}`);
  if (ours.length !== want.length || want.some(w => !ours.includes(w))) {
    removeDirect(settings, null);
    settings.hooks ||= {};
    for (const [ev, arg, { matcher, ...extra }] of HOOKS) {
      const group = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCommand(arg, { node, bin, as }), ...extra }] };
      (settings.hooks[ev] ||= []).push(group);
    }
    writeJson(p.settings, settings); changed.push(p.settings);
  }

  return { ok: true, mode: 'direct', changed: [...new Set(changed)], status: claudeStatus({ dir, env, node, bin }),
    message: changed.length ? `Connected${replacePlugin ? ' directly (the plugin is turned off)' : ''}. Start a new Claude Code session (or restart the app) to use VINAC Link.` : 'Already connected. Nothing to change.' };
}

/** Removes the hooks (and, with config, the MCP entry) that point at a vinac.mjs. Returns what changed. */
function removeDirect(settings, config, { keepManual = true } = {}) {
  const out = { settings: false, config: false };
  for (const [ev] of HOOKS) {
    const groups = settings.hooks?.[ev];
    if (!Array.isArray(groups)) continue;
    const kept = groups.map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurHook(h.command)) })).filter(g => g.hooks.length);
    if (kept.length !== groups.length || kept.some((g, i) => g.hooks.length !== groups[i].hooks?.length)) out.settings = true;
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  const s = config?.mcpServers?.[SERVER];
  if (s && (isOurServer(s) || !keepManual)) { delete config.mcpServers[SERVER]; out.config = true; }
  return out;
}

/** Undoes connectClaude's direct entries (the plugin, if any, is left to `claude plugin uninstall`). */
export function disconnectClaude({ dir, env, node = process.execPath, bin = BIN } = {}) {
  const p = claudePaths({ dir, env });
  let settings, config;
  try { settings = readJson(p.settings); config = readJson(p.config); } catch (e) { return { ok: false, changed: [], message: e.message }; }
  const changed = [];
  const r = removeDirect(settings || {}, config || {});
  if (r.settings) { writeJson(p.settings, settings); changed.push(p.settings); }
  if (r.config) { writeJson(p.config, config); changed.push(p.config); }
  return { ok: true, changed, status: claudeStatus({ dir, env, node, bin }),
    message: changed.length ? 'Removed VINAC Link from Claude Code. Restart Claude Code sessions.' : 'Claude Code had no VINAC Link entries from this tool.' };
}

/** One line for people: how Claude Code is connected. */
export function describeClaude(s) {
  if (!s.present) return 'Claude Code was not found on this computer (no ~/.claude folder).';
  if (s.mode === 'plugin') return `Connected through the VINAC Link plugin${s.plugin.version ? ` (${s.plugin.version})` : ''}, as this computer's default agent (no identity of its own).${s.plugin.outdated ? ` The plugin is older than this VINAC Link (${CURRENT}), so Claude has older tools.` : ''} Switch to VINAC Link's own connection for its own identity and the current tools.${s.manual || s.direct.server ? ' An extra VINAC Link entry duplicates its tools.' : ''}`;
  if (s.mode === 'direct') return `Connected: tools and wake-ups, using this copy of VINAC Link${s.direct.identity ? ', as its own agent' : ''}.`;
  if (s.mode === 'partial') return s.manual ? 'Added by hand (tools only, and it needs Node.js on the PATH): no wake-ups. Connect again to fix it.' : 'Partly connected (tools without wake-ups, or an older copy). Connect again to fix it.';
  return 'Not connected yet.';
}

// ---- Codex (0.15) ---------------------------------------------------------------------------
// Codex reads MCP servers from $CODEX_HOME/config.toml (default ~/.codex). We keep one marked block:
//   [mcp_servers.vinac]  command, args, and env.VINAC_AGENT_TOKEN when the page made Codex an identity.
// Codex has no hooks yet, so it sees new posts when it next checks vinac_inbox (no wake-ups).
const MARK = '# VINAC Link (added by "vinac connect codex"; remove with "vinac connect codex --remove")';

export function codexPaths({ dir, env = process.env } = {}) {
  const base = dir || env.VINAC_CODEX_DIR || env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return { dir: base, config: path.join(base, 'config.toml') };
}

const tomlStr = s => JSON.stringify(String(s));   // TOML basic strings take JSON escapes
const isVinacHeader = l => /^\s*\[\s*mcp_servers\s*\.\s*("vinac"|vinac)(\s*\.[^\]]*)?\s*\]\s*(#.*)?$/.test(l);
const isHeader = l => /^\s*\[/.test(l);

/** The config without any [mcp_servers.vinac] tables (and our marker line). */
function withoutVinac(text) {
  const out = []; let skipping = false;
  for (const l of String(text).split(/\r?\n/)) {
    if (l.trim() === MARK) continue;
    if (isHeader(l)) skipping = isVinacHeader(l);
    if (!skipping) out.push(l);
  }
  while (out.length && out.at(-1).trim() === '') out.pop();
  return out.join('\n');
}

export function codexStatus({ dir, env, bin = BIN } = {}) {
  const p = codexPaths({ dir, env });
  const present = fs.existsSync(p.dir);
  let text = '';
  try { text = fs.readFileSync(p.config, 'utf8'); } catch { /* none yet */ }
  const lines = text.split(/\r?\n/);
  const has = lines.some(isVinacHeader);
  const ours = has && text.includes(tomlStr(slash(bin)));
  return { present, mode: ours ? 'direct' : has ? 'partial' : 'none', identity: has && /VINAC_AGENT_TOKEN/.test(text), paths: { config: p.config } };
}

export function connectCodex({ dir, env, node = process.execPath, bin = BIN, agent = null } = {}) {
  const p = codexPaths({ dir, env });
  const why = connectableCopy(bin);
  if (why) return { ok: false, changed: [], message: why, status: codexStatus({ dir, env, bin }) };
  let text = '';
  try { text = fs.readFileSync(p.config, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return { ok: false, changed: [], message: e.message }; }
  const block = [MARK, '[mcp_servers.vinac]', `command = ${tomlStr(slash(node))}`, `args = [${tomlStr(slash(bin))}, "mcp"]`,
    ...(agent?.token ? [`env = { VINAC_AGENT_TOKEN = ${tomlStr(agent.token)} }`] : [])].join('\n');
  const base = withoutVinac(text);
  const next = `${base ? `${base}\n\n` : ''}${block}\n`;
  if (next === text) return { ok: true, mode: 'direct', changed: [], message: 'Already connected. Nothing to change.', status: codexStatus({ dir, env, bin }) };
  fs.mkdirSync(p.dir, { recursive: true });
  if (fs.existsSync(p.config) && !fs.existsSync(`${p.config}.vinac-backup`)) fs.copyFileSync(p.config, `${p.config}.vinac-backup`);
  const tmp = `${p.config}.vinac-tmp-${process.pid}`;
  fs.writeFileSync(tmp, next); fs.renameSync(tmp, p.config);
  return { ok: true, mode: 'direct', changed: [p.config], message: 'Connected. Start a new Codex session to use VINAC Link.', status: codexStatus({ dir, env, bin }) };
}

export function disconnectCodex({ dir, env, bin = BIN } = {}) {
  const p = codexPaths({ dir, env });
  let text;
  try { text = fs.readFileSync(p.config, 'utf8'); } catch { return { ok: true, changed: [], message: 'Codex had no VINAC Link entry.' }; }
  const base = withoutVinac(text);
  if (base === text.replace(/\s+$/, '')) return { ok: true, changed: [], message: 'Codex had no VINAC Link entry.', status: codexStatus({ dir, env, bin }) };
  if (!fs.existsSync(`${p.config}.vinac-backup`)) fs.copyFileSync(p.config, `${p.config}.vinac-backup`);
  fs.writeFileSync(p.config, base ? `${base}\n` : '');
  return { ok: true, changed: [p.config], message: 'Removed VINAC Link from Codex. Restart Codex sessions.', status: codexStatus({ dir, env, bin }) };
}

// ---- OpenClaw (0.16.3) --------------------------------------------------------------
// OpenClaw reaches VINAC Link through two plugins it loads itself (openclaw/README.md): the node
// plugin on this computer and the gateway plugin wherever the gateway runs. VINAC Link never edits
// OpenClaw's settings. Connecting from the page only gives OpenClaw its own agent identity: the
// token goes into <VINAC home>/agent-tokens/openclaw.token, which the node plugin reads.

export function openclawPaths({ dir, env = process.env } = {}) {
  const base = dir || env.VINAC_OPENCLAW_DIR || env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
  return { dir: base, config: path.join(base, 'openclaw.json') };
}
export const openclawTokenFile = home => path.join(home, 'agent-tokens', 'openclaw.token');

/** What OpenClaw on this computer knows about VINAC Link. Reads only. */
export function openclawStatus({ dir, env, home } = {}) {
  const p = openclawPaths({ dir, env });
  const present = fs.existsSync(p.dir);
  let cfg = null;
  try { cfg = readJson(p.config); } catch { cfg = null; }
  const entry = cfg?.plugins?.entries?.['vinac-link-node'];
  const plugin = !!entry && entry.enabled !== false;
  const identity = !!home && fs.existsSync(openclawTokenFile(home));
  return { present, plugin, identity, mode: plugin ? (identity ? 'own' : 'plugin') : 'none', paths: { config: p.config } };
}

export function connectOpenclaw({ home, agent, dir, env } = {}) {
  const s = openclawStatus({ dir, env, home });
  if (!s.plugin) return { ok: false, changed: [], message: 'Install the VINAC Link node plugin in OpenClaw first (guide: openclaw/README.md, or vinac.tech/docs/openclaw.html).', status: s };
  const f = openclawTokenFile(home);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${agent.token}\n`, { mode: 0o600 });
  fs.renameSync(tmp, f);
  return { ok: true, mode: 'own', changed: [f], message: 'OpenClaw now acts as its own agent ("OpenClaw") on its next VINAC Link call.', status: openclawStatus({ dir, env, home }) };
}

export function disconnectOpenclaw({ home, dir, env } = {}) {
  const f = openclawTokenFile(home);
  if (!fs.existsSync(f)) return { ok: true, changed: [], message: 'OpenClaw had no identity of its own here.', status: openclawStatus({ dir, env, home }) };
  fs.rmSync(f, { force: true });
  return { ok: true, changed: [f], message: 'OpenClaw acts as the default agent again. To stop it using VINAC Link at all, turn off the plugins in OpenClaw.', status: openclawStatus({ dir, env, home }) };
}

export function describeOpenclaw(s) {
  if (!s.present) return 'OpenClaw was not found on this computer (no ~/.openclaw folder).';
  if (s.mode === 'own') return 'Connected through its plugins, as its own agent ("OpenClaw").';
  if (s.mode === 'plugin') return 'Connected through its plugins, as this computer\'s default agent (no identity of its own).';
  return 'Not connected: OpenClaw needs the two VINAC Link plugins (node and gateway); see the guide.';
}

export function describeCodex(s) {
  if (!s.present) return 'Codex was not found on this computer (no ~/.codex folder).';
  if (s.mode === 'direct') return `Connected: tools${s.identity ? ', as its own agent' : ''}. Codex has no wake-ups yet: it sees new posts when it checks its VINAC Link inbox.`;
  if (s.mode === 'partial') return 'A VINAC Link entry was added by hand (it may need Node.js on the PATH). Connect again to fix it.';
  return 'Not connected yet.';
}
