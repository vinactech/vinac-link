// OpenClaw plugin entry for the node host on the computer that runs VINAC Link.
// Declares one node-host command per VINAC Link capability (no dispatcher), so
// the gateway's node-command allowlist can permit them one by one. The gateway
// side (../gateway) turns them into agent tools.
import { definePluginEntry, buildJsonPluginConfigSchema } from 'openclaw/plugin-sdk/plugin-entry';
import { COMMANDS, COMMAND_NAMES, runCommand } from './commands.js';

export const CONFIG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    home: { type: 'string', minLength: 1, description: 'VINAC Link home folder. Default: VINAC_HOME or ~/.vinac.' },
  },
};

const DESCRIPTIONS = {
  'vinac.status': 'This device\'s VINAC Link identity, pairing in progress, unread messages and requests waiting for the person.',
  'vinac.peers': 'Devices this computer is paired with, and whether they are online.',
  'vinac.intents': 'The intents a request can name, with their risk level.',
  'vinac.secrets': 'Names of secrets received from paired devices (never values).',
  'vinac.pair_status': 'State of the pairing in progress.',
  'vinac.pair_request': 'Open the VINAC Link page so the person can pair a device (they check the 6 digits and press Allow on both).',
  'vinac.send': 'Send a message, or a request with an intent, to a paired device.',
  'vinac.inbox': 'New messages and requests the firewall let through, from paired devices.',
  'vinac.file': 'Read a file a paired device shared (only if the firewall let it through).',
  'vinac.events': 'What is new (message ids, devices, intents, waiting count), without text and without marking anything read. Used by the gateway front desk.',
};

let config = {};

export const NODE_HOST_COMMANDS = COMMAND_NAMES.map(command => ({
  command,
  // No defaultPlatforms: the operator allowlists each command on the gateway.
  // vinac.events feeds the gateway's front desk service; it is not an agent tool.
  ...(command === 'vinac.events' ? {} : { agentTool: { name: COMMANDS[command][0], description: DESCRIPTIONS[command], parameters: { type: 'object' } } }),
  handle: paramsJSON => runCommand(command, paramsJSON, { home: typeof config.home === 'string' ? config.home : undefined }),
}));

export default definePluginEntry({
  id: 'vinac-link-node',
  name: 'VINAC Link (node)',
  description: 'VINAC Link commands on the computer that runs VINAC Link: messages, requests and status for paired devices. No pairing confirmation, secret values, firewall changes or unpairing.',
  configSchema: buildJsonPluginConfigSchema(CONFIG_JSON_SCHEMA),
  nodeHostCommands: NODE_HOST_COMMANDS,
  register(api) { config = api.pluginConfig ?? {}; },
});
