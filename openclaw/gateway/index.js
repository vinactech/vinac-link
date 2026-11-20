// OpenClaw gateway plugin: VINAC Link agent tools. Each tool calls one fixed
// node-host command on the node that runs VINAC Link (../node). Tools are
// optional: the operator must allowlist them per agent.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { TOOLS, TOOL_NAMES, runTool, VinacToolError } from './tools.js';
import { createFrontDesk, frontDeskConfig } from './frontdesk.js';

let nodesRef = null;
let binding = {};

const result = (text, details) => ({ content: [{ type: 'text', text }], details });

function makeTool(name) {
  const t = TOOLS[name];
  return {
    name, description: t.description, parameters: t.parameters,
    async execute(_toolCallId, params, signal) {
      try {
        if (!nodesRef) throw new VinacToolError('VINAC_NO_RUNTIME', 'VINAC Link tools must run inside the OpenClaw gateway');
        const r = await runTool(nodesRef, binding, name, params, signal);
        return result(JSON.stringify(r.result, null, 2), { ok: true, node: r.node, result: r.result });
      } catch (e) {
        const code = e instanceof VinacToolError ? e.code : 'VINAC_ERROR';
        return result(`VINAC Link error [${code}]: ${e?.message || e}`, { ok: false, error: code, message: String(e?.message || e) });
      }
    },
  };
}

export const REGISTERED_TOOLS = TOOL_NAMES.map(makeTool);

export default definePluginEntry({
  id: 'vinac-link-gateway',
  name: 'VINAC Link',
  description: 'VINAC Link tools for OpenClaw agents: messages and intent-checked requests between paired computers, through the node that runs VINAC Link.',
  register(api) {
    nodesRef = api?.runtime?.nodes ?? null;
    const cfg = api?.pluginConfig ?? {};
    binding = {
      ...(typeof cfg.nodeId === 'string' && cfg.nodeId ? { nodeId: cfg.nodeId } : {}),
      ...(typeof cfg.nodeName === 'string' && cfg.nodeName ? { nodeName: cfg.nodeName } : {}),
    };
    for (const tool of REGISTERED_TOOLS) api.registerTool(tool, { name: tool.name, optional: true });
    // Front desk (opt-in): tell an agent session, and so the person, when items arrive.
    if (frontDeskConfig(cfg.frontDesk).enabled && nodesRef && api?.runtime?.system && typeof api.registerService === 'function') {
      let desk = null;
      api.registerService({
        id: 'vinac-link-front-desk',
        start(ctx) { desk = createFrontDesk({ nodes: nodesRef, system: api.runtime.system, binding, config: cfg.frontDesk, logger: ctx?.logger ?? console }); desk.start(); },
        stop() { desk?.stop(); desk = null; },
      });
    }
  },
});
