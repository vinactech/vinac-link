// Writes docs/intents/catalog.md from connector/src/logos.js, so the docs always
// match the code. Usage: node connector/tools/logos-doc.mjs   (tests check it is up to date)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, LOGOS_VERSION, RISK_TEXT } from '../src/logos.js';
import { DEFAULTS } from '../src/firewall.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_DOC = path.resolve(here, '../../docs/intents/catalog.md');
const DEC = { allow: 'Allow', ask: 'Ask me', block: 'Block' };
const AREA = {
  calendar: 'Calendar', communication: 'Messages for the person', crm: 'CRM', document: 'Files', storage: 'Storage',
  system: 'This computer', agent: 'Agent to agent', person: 'The person on the other device', code: 'Code, pull requests and issues',
  ci: 'CI', deploy: 'Deploys', container: 'Containers', cloud: 'Cloud', database: 'Databases', config: 'Configuration',
  monitor: 'Monitoring', security: 'Security', web: 'Web', browser: 'Browser', clipboard: 'Clipboard', note: 'Notes',
  reminder: 'Reminders', docs: 'Documentation', model: 'AI models', data: 'Data',
};

export function render() {
  const all = catalog();
  const counts = Object.fromEntries(Object.keys(RISK_TEXT).map(r => [r, all.filter(i => i.risk === r).length]));
  const out = [
    `# Intent catalog v${LOGOS_VERSION}`, '',
    `Generated from \`connector/src/logos.js\` by \`node connector/tools/logos-doc.mjs\`. Do not edit by hand.`, '',
    `${all.length} intents: ${Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}. Defaults are what the receiving firewall does when the person has set no rule.`, '',
    '| Risk | Meaning | Default |', '|---|---|---|',
    ...Object.entries(RISK_TEXT).map(([r, t]) => `| ${r} | ${t} | ${DEC[DEFAULTS[r]]} |`), '',
  ];
  const domains = [...new Set(all.map(i => i.domain))].sort((a, b) => (AREA[a] || a).localeCompare(AREA[b] || b));
  for (const d of domains) {
    out.push(`## ${AREA[d] || d}`, '', '| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |', '|---:|---|---|---|---|---|---|---|');
    for (const i of all.filter(x => x.domain === d)) {
      const list = a => (a || []).map(x => `\`${x}\``).join(', ');
      out.push(`| ${i.id} | \`${i.intent}\` | ${i.risk} | ${DEC[DEFAULTS[i.risk]]} | ${list(i.args)} | ${list(i.optional)} | ${i.since} | ${i.description} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(CATALOG_DOC), { recursive: true });
  fs.writeFileSync(CATALOG_DOC, render());
  console.log(`wrote ${path.relative(process.cwd(), CATALOG_DOC)}`);
}
