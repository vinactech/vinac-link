// The firewall: this person's rules for what paired devices send. The daemon
// applies them when something arrives, before any agent can see it:
//   allow  the agent sees it
//   ask    it waits on the page until the person approves it
//   block  the agent never sees it; the page lists it
// Rules apply to requests (Logos intents) and to plain-text messages (the
// TEXT pseudo-intent). They are kept per device, plus one set for all devices.
// Only the page (the person) can change them; agent tools cannot.
import { CANONICAL_INTENTS, isIntent, riskOf, domainOf, describe } from './logos.js';

export const DECISIONS = ['allow', 'ask', 'block'];
export const TEXT = '@text';                         // rule key for plain-text messages
export const DEFAULTS = Object.freeze({ info: 'allow', read: 'ask', change: 'ask', high: 'block', text: 'allow' });
export const ALL = '*';

const defaultFor = key => (key === TEXT ? DEFAULTS.text : DEFAULTS[riskOf(key)]);
const validKey = key => key === TEXT || isIntent(key);

export class Firewall {
  constructor(store) { this.store = store; }

  rules() { return this.store.firewall().rules; }

  /** The decision for a request (intent) or, with intent null, a plain-text message. */
  decide(peerId, intent) {
    const key = intent == null ? TEXT : intent;
    if (!validKey(key)) return { decision: 'block', source: 'unknown intent' };
    const r = this.rules();
    if (r[peerId]?.[key]) return { decision: r[peerId][key], source: 'device rule' };
    if (r[ALL]?.[key]) return { decision: r[ALL][key], source: 'rule for all devices' };
    return { decision: defaultFor(key), source: 'default' };
  }

  /** Sets (or with decision 'default', removes) one rule. `scope` is a peer id or '*'. */
  setRule(scope, intent, decision, peerIds) {
    if (scope !== ALL && !peerIds.includes(scope)) throw Object.assign(new Error('No paired device with that id.'), { status: 404 });
    if (!validKey(intent)) throw Object.assign(new Error('Unknown intent.'), { status: 400 });
    if (decision !== 'default' && !DECISIONS.includes(decision)) throw Object.assign(new Error('Decision must be allow, ask, block or default.'), { status: 400 });
    const fw = this.store.firewall();
    const scoped = { ...(fw.rules[scope] || {}) };
    if (decision === 'default') delete scoped[intent]; else scoped[intent] = decision;
    const rules = { ...fw.rules, [scope]: scoped };
    if (!Object.keys(scoped).length) delete rules[scope];
    this.store.saveFirewall({ ...fw, rules });
  }

  /** Plain messages first, then every intent, with defaults and the rules that apply. */
  view(peers) {
    const r = this.rules();
    return [TEXT, ...CANONICAL_INTENTS].map(intent => ({
      intent, risk: intent === TEXT ? 'text' : riskOf(intent), default: defaultFor(intent),
      domain: intent === TEXT ? 'text' : domainOf(intent),
      description: intent === TEXT ? 'Messages without an intent.' : describe(intent).description,
      all: r[ALL]?.[intent] || null,
      devices: Object.fromEntries(peers.filter(p => r[p.id]?.[intent]).map(p => [p.id, r[p.id][intent]])),
    }));
  }
}
