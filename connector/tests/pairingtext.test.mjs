// 0.16.3: pairing is described the same way everywhere (agent tools, OpenClaw, the page).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOOLS } from '../src/mcp.js';
import { PAIR_ENDING, PAIR_CHECKLIST } from '../src/pairing-text.js';
import { TOOLS as OC_TOOLS } from '../../openclaw/gateway/tools.js';

test('pairing text: one description, no "type each other\'s codes" left', () => {
  const pair = TOOLS.find(t => t.name === 'vinac_pair_request').description;
  assert.ok(pair.includes(PAIR_ENDING), 'MCP tool uses the shared text');
  assert.ok(OC_TOOLS.vinac_pair_request.description.includes(PAIR_ENDING), 'OpenClaw keeps it word for word');
  const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes(PAIR_CHECKLIST), 'the page checklist says the same');
  for (const text of [pair, OC_TOOLS.vinac_pair_request.description, app, fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')]) {
    assert.ok(!/type each device's 6-digit code|swap 6[- ]digit|you swap 6 digits/i.test(text));
  }
});
