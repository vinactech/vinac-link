// The firewall: this person's rules for what paired devices send. The daemon
// applies them when something arrives, before any agent can see it:
//   allow  the agent sees it
//   ask    it waits on the page until the person approves it
//   block  the agent never sees it; the page lists it
// Rules apply to requests (Logos intents) and to plain-text messages (the
// TEXT pseudo-intent). They are kept per device, plus one set for all devices.
// A mode (restricted, standard, auto) sets the defaults by risk, per device or
// for all devices; a rule the person set always wins over the mode. Approving a
// request can also allow that intent from that device for a while.
// Only the page (the person) can change any of this; agent tools cannot.
import { CANONICAL_INTENTS, isIntent, riskOf, domainOf, describe } from './logos.js';

export const DECISIONS = ['allow', 'ask', 'block'];
export const TEXT = '@text';                         // rule key for plain-text messages
export const ALL = '*';

/** Defaults by risk for each mode. High risk is blocked in every mode: only a rule the person sets can open it. */
export const MODES = Object.freeze({
  restricted: Object.freeze({ info: 'ask', read: 'ask', change: 'block', high: 'block', text: 'ask' }),
  standard: Object.freeze({ info: 'allow', read: 'ask', change: 'ask', high: 'block', text: 'allow' }),
  auto: Object.freeze({ info: 'allow', read: 'allow', change: 'ask', high: 'block', text: 'allow' }),
});
export const DEFAULT_MODE = 'standard';
export const DEFAULTS = MODES[DEFAULT_MODE];
export const MAX_ALLOW_FOR_MS = 8 * 60 * 60_000;   // "allow for a while": at most 8 hours

const riskKey = key => (key === TEXT ? 'text' : riskOf(key));
const validKey = key => key === TEXT || isIntent(key);
const err = (status, message) => Object.assign(new Error(message), { status });

export class Firewall {
  constructor(store) { this.store = store; }

  rules() { return this.store.firewall().rules; }
  modes() { return this.store.firewall().modes || {}; }

  /** The mode that sets this device's defaults: its own, else the one for all devices, else standard. */
  modeOf(peerId) {
    const m = this.modes();
    return MODES[m[peerId]] ? m[peerId] : MODES[m[ALL]] ? m[ALL] : DEFAULT_MODE;
  }

  /** The decision for a request (intent) or, with intent null, a plain-text message. */
  decide(peerId, intent) {
    const key = intent == null ? TEXT : intent;
    if (!validKey(key)) return { decision: 'block', source: 'unknown intent' };
    const r = this.rules();
    if (r[peerId]?.[key]) return { decision: r[peerId][key], source: 'device rule' };
    if (r[ALL]?.[key]) return { decision: r[ALL][key], source: 'rule for all devices' };
    const until = this.store.firewall().temporary?.[peerId]?.[key];
    if (until && until > Date.now() && riskKey(key) !== 'high') return { decision: 'allow', source: 'allowed for a while by the person' };
    const mode = this.modeOf(peerId);
    return { decision: MODES[mode][riskKey(key)], source: `${mode} mode` };
  }

  /** Sets (or with decision 'default', removes) one rule. `scope` is a peer id or '*'. */
  setRule(scope, intent, decision, peerIds) {
    if (scope !== ALL && !peerIds.includes(scope)) throw err(404, 'No paired device with that id.');
    if (!validKey(intent)) throw err(400, 'Unknown intent.');
    if (decision !== 'default' && !DECISIONS.includes(decision)) throw err(400, 'Decision must be allow, ask, block or default.');
    const fw = this.store.firewall();
    const scoped = { ...(fw.rules[scope] || {}) };
    if (decision === 'default') delete scoped[intent]; else scoped[intent] = decision;
    const rules = { ...fw.rules, [scope]: scoped };
    if (!Object.keys(scoped).length) delete rules[scope];
    this.store.saveFirewall({ ...fw, rules });
  }

  /** Sets the mode for one device or for all ('*'). For a device, 'default' follows the mode for all devices. */
  setMode(scope, mode, peerIds) {
    if (scope !== ALL && !peerIds.includes(scope)) throw err(404, 'No paired device with that id.');
    if (!MODES[mode] && !(mode === 'default' && scope !== ALL)) throw err(400, 'Mode must be restricted, standard or auto.');
    const fw = this.store.firewall();
    const modes = { ...(fw.modes || {}) };
    if (mode === 'default') delete modes[scope]; else modes[scope] = mode;
    this.store.saveFirewall({ ...fw, modes });
  }

  /** After the person approves a request: allow the same intent from that device until `untilMs`. Never for high risk. */
  allowFor(peerId, intent, ms) {
    const key = intent == null ? TEXT : intent;
    if (!validKey(key)) throw err(400, 'Unknown intent.');
    if (riskKey(key) === 'high') throw err(400, 'High-risk requests are approved one at a time.');
    const span = Math.min(MAX_ALLOW_FOR_MS, Math.max(60_000, Number(ms) || 0));
    const fw = this.store.firewall();
    const now = Date.now();
    const temporary = {};
    for (const [p, m] of Object.entries(fw.temporary || {})) {   // drop what has run out
      const live = Object.fromEntries(Object.entries(m).filter(([, t]) => t > now));
      if (Object.keys(live).length) temporary[p] = live;
    }
    temporary[peerId] = { ...(temporary[peerId] || {}), [key]: now + span };
    this.store.saveFirewall({ ...fw, temporary });
    return now + span;
  }

  /** Ends every "allow for a while" (for one device, or all). */
  clearTemporary(peerId) {
    const fw = this.store.firewall();
    const temporary = { ...(fw.temporary || {}) };
    if (peerId) delete temporary[peerId]; else for (const k of Object.keys(temporary)) delete temporary[k];
    this.store.saveFirewall({ ...fw, temporary });
  }

  modesView(peers) {
    const m = this.modes();
    const now = Date.now();
    const t = this.store.firewall().temporary || {};
    return {
      all: MODES[m[ALL]] ? m[ALL] : DEFAULT_MODE,
      devices: Object.fromEntries(peers.filter(p => MODES[m[p.id]]).map(p => [p.id, m[p.id]])),
      table: MODES,
      temporary: Object.fromEntries(Object.entries(t).map(([p, x]) => [p, Object.fromEntries(Object.entries(x).filter(([, u]) => u > now).map(([k, u]) => [k, new Date(u).toISOString()]))]).filter(([, x]) => Object.keys(x).length)),
    };
  }

  /** Plain messages first, then every intent, with defaults (for the mode for all devices) and the rules that apply. */
  view(peers) {
    const r = this.rules();
    const allMode = this.modeOf(null);
    return [TEXT, ...CANONICAL_INTENTS].map(intent => ({
      intent, risk: riskKey(intent), default: MODES[allMode][riskKey(intent)],
      domain: intent === TEXT ? 'text' : domainOf(intent),
      description: intent === TEXT ? 'Messages without an intent.' : describe(intent).description,
      all: r[ALL]?.[intent] || null,
      devices: Object.fromEntries(peers.filter(p => r[p.id]?.[intent]).map(p => [p.id, r[p.id][intent]])),
    }));
  }
}
