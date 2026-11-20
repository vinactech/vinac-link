// Stands in for `claude -p` in the auto-reply tests. It reads the MCP config the
// daemon wrote, uses the same agent client the MCP server uses (with the run's
// token), and records what it was given and what it could do.
// FAKE_AGENT_LOG: file to append one JSON line to. FAKE_AGENT_MODE: answer | evil | sleep | fail.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const cfgPath = argv[argv.indexOf('--mcp-config') + 1];
const server = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).mcpServers.vinac;
const home = server.args[server.args.indexOf('--home') + 1];
process.env.VINAC_API_TOKEN = server.env.VINAC_API_TOKEN;
const { AgentApi } = await import('../../src/mcp.js');

const mode = process.env.FAKE_AGENT_MODE || 'answer';
const record = { argv, envKeys: Object.keys(server.env), home, mode, tries: {} };
const tryTool = async (label, name, args) => {
  try { record.tries[label] = { ok: true, result: await api.tool(name, args) }; }
  catch (e) { record.tries[label] = { ok: false, error: e.message }; }
};

const api = new AgentApi({ home });
try {
  if (mode === 'sleep') await new Promise(r => setTimeout(r, 60_000));
  if (mode === 'fail') process.exitCode = 3;
  else {
    await api.connect({ background: false });
    const box = await api.tool('vinac_inbox', { all: true });
    record.inbox = box.messages.map(m => ({ id: m.id, intent: m.intent, text: m.text }));
    if (mode === 'evil') {
      const someId = box.messages[0]?.id;
      await tryTool('peers', 'vinac_peers');
      await tryTool('secrets', 'vinac_secrets');
      await tryTool('intents', 'vinac_intents');
      await tryTool('noReplyTo', 'vinac_send', { text: 'hello' });
      await tryTool('wrongReplyTo', 'vinac_send', { text: 'hello', replyTo: 'AAAAAAAAAAAAAAAA' });
      await tryTool('riskyIntent', 'vinac_send', { replyTo: someId, intent: 'system.command.execute', args: { command: 'whoami' } });
      await tryTool('askBack', 'vinac_send', { replyTo: someId, intent: 'agent.question.ask', args: { question: 'loop?' } });
      await tryTool('otherDevice', 'vinac_send', { to: 'Auto C', replyTo: someId, text: 'hi C' });
      await tryTool('secondInbox', 'vinac_inbox', {});
    }
    for (const m of box.messages) {
      await tryTool(`answer-${m.id}`, 'vinac_send', { replyTo: m.id, intent: 'agent.question.answer', args: { answer: 'Automatic answer.' } });
    }
    if (mode === 'evil') for (let i = 0; i < 5; i++) await tryTool(`flood-${i}`, 'vinac_send', { replyTo: box.messages[0]?.id, text: 'more' });
  }
} catch (e) { record.error = e.message; process.exitCode = 2; }
fs.appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify(record) + '\n');
