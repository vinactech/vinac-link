// Logos Lexicon: the shared, versioned catalog of intents. A request names one
// intent (what it asks the other device to do) plus its arguments, so the
// receiving device's firewall can decide by meaning instead of guessing from
// free text.
//
// Rules (see docs/intents/README.md):
//  - names are domain.object.action, lowercase;
//  - ids are positions in this list and never change: only append, never
//    reorder or remove; every release that appends bumps LOGOS_VERSION;
//  - ids 0-29 are the v0.2.0 business intents shared with the VINAC research
//    packages; 30-34 came in v0.3.0; v0.4.0 appends the agent and software library;
//    v0.5.0 appends agent.room.post (shared project rooms); v0.6.0 appends agent.card.post and
//    agent.card.update (cards).
export const LOGOS_VERSION = '0.6.0';

// How much harm a request could do if a tricked agent acted on it.
export const RISK_TEXT = {
  info: 'Asks or tells something',
  read: 'Looks things up',
  change: 'Creates or changes things',
  high: 'Changes files, runs code, spends or deploys',
};

// [intent, risk, required args, optional args, description]
// Required args are non-empty text, checked on send and on receipt.
const TABLE = [
  // ---- v0.2.0: business intents (ids 0-29) --------------------------------
  ['calendar.appointment.create', 'change', [], ['title', 'start', 'end', 'attendees'], 'Create a calendar appointment.'],
  ['calendar.appointment.list', 'read', [], ['from', 'to'], 'List calendar appointments.'],
  ['communication.message.reply', 'change', [], ['to', 'text'], 'Reply to a message on the person\'s behalf.'],
  ['communication.message.send', 'change', [], ['to', 'text'], 'Send a message on the person\'s behalf (email, chat).'],
  ['crm.contact.create', 'change', [], ['name', 'email'], 'Create a CRM contact.'],
  ['crm.contact.read', 'read', [], ['name', 'id'], 'Read a CRM contact.'],
  ['crm.contact.search', 'read', [], ['query'], 'Search CRM contacts.'],
  ['crm.contact.update', 'change', [], ['id', 'fields'], 'Update a CRM contact.'],
  ['crm.deal.create', 'change', [], ['name', 'value'], 'Create a CRM deal.'],
  ['crm.deal.list', 'read', [], ['stage'], 'List CRM deals.'],
  ['crm.deal.read', 'read', [], ['id'], 'Read a CRM deal.'],
  ['crm.deal.update', 'change', [], ['id', 'fields'], 'Update a CRM deal.'],
  ['crm.note.create', 'change', [], ['about', 'text'], 'Add a note in the CRM.'],
  ['crm.note.list', 'read', [], ['about'], 'List CRM notes.'],
  ['crm.task.complete', 'change', [], ['id'], 'Mark a CRM task done.'],
  ['crm.task.create', 'change', [], ['title', 'due'], 'Create a CRM task.'],
  ['crm.task.list', 'read', [], ['owner'], 'List CRM tasks.'],
  ['crm.task.update', 'change', [], ['id', 'fields'], 'Update a CRM task.'],
  ['document.file.list', 'read', [], ['folder'], 'List files in a folder.'],
  ['document.file.move', 'high', [], ['path', 'to'], 'Move a file.'],
  ['document.file.read', 'read', [], ['path'], 'Read a file.'],
  ['document.file.rename', 'high', [], ['path', 'name'], 'Rename a file.'],
  ['document.file.search', 'read', [], ['query'], 'Search files.'],
  ['document.file.write', 'high', [], ['path', 'text'], 'Write or overwrite a file.'],
  ['document.folder.create', 'change', [], ['path'], 'Create a folder.'],
  ['document.folder.list', 'read', [], ['path'], 'List folders.'],
  ['document.metadata.read', 'read', [], ['path'], 'Read a file\'s metadata.'],
  ['storage.account.read', 'read', [], ['account'], 'Read storage account details (usage, quota).'],
  ['system.command.execute', 'high', [], ['command', 'cwd'], 'Run a shell command.'],
  ['system.process.control', 'high', [], ['process', 'action'], 'Start, stop or signal a process.'],
  // ---- v0.3.0: everyday agent intents (ids 30-34) --------------------------
  ['agent.question.ask', 'info', ['question'], ['context'], 'Ask the other agent a question.'],
  ['agent.status.update', 'info', ['status'], ['details'], 'Tell the other agent how something stands.'],
  ['agent.review.request', 'read', ['summary'], ['diff', 'repo', 'branch', 'files'], 'Ask the other agent to review a change.'],
  ['agent.task.handoff', 'change', ['task'], ['details', 'repo', 'branch', 'due'], 'Hand a task to the other agent to do on its machine.'],
  ['document.file.share', 'change', ['name'], ['text', 'base64', 'mime'], 'Share a file (up to 192 KB in one message; bigger ones, up to 64 MB, arrive in parts first).'],
  // ---- v0.4.0: agent coordination (ids 35-) --------------------------------
  ['agent.question.answer', 'info', ['answer'], ['question'], 'Answer a question the other agent asked.'],
  ['agent.task.accept', 'info', ['task'], ['eta'], 'Accept a handed-off task.'],
  ['agent.task.decline', 'info', ['task'], ['reason'], 'Decline a handed-off task.'],
  ['agent.task.progress', 'info', ['progress'], ['task', 'percent'], 'Report progress on a task.'],
  ['agent.task.complete', 'info', ['summary'], ['task', 'result'], 'Report that a task is done.'],
  ['agent.task.cancel', 'info', ['task'], ['reason'], 'Ask the other agent to stop a task it is doing for you.'],
  ['agent.plan.propose', 'info', ['plan'], ['goal'], 'Share a plan for the other agent to comment on.'],
  ['agent.plan.feedback', 'info', ['feedback'], ['plan'], 'Comment on a proposed plan.'],
  ['agent.review.respond', 'info', ['verdict'], ['comments', 'review'], 'Return the result of a review.'],
  ['agent.context.share', 'info', ['context'], ['topic'], 'Share background notes or context.'],
  ['agent.summary.share', 'info', ['summary'], ['topic'], 'Share a summary of work or findings.'],
  ['agent.capability.query', 'info', [], ['topic'], 'Ask what the other agent can do or has access to.'],
  ['agent.capability.describe', 'info', ['capabilities'], [], 'Describe what this agent can do.'],
  ['agent.decision.request', 'info', ['question'], ['options', 'deadline'], 'Ask the other side to decide between options.'],
  ['agent.error.report', 'info', ['error'], ['task', 'details'], 'Report a failure or a blocker.'],
  ['agent.lock.request', 'change', ['resource'], ['reason', 'minutes'], 'Ask to work on a file, branch or resource alone for a while.'],
  ['agent.lock.release', 'info', ['resource'], [], 'Release a resource the agent locked.'],
  ['agent.work.delegate', 'change', ['task'], ['details', 'parent'], 'Delegate a sub-task of a larger job.'],
  // ---- people on the other device -------------------------------------------
  ['person.notification.send', 'change', ['message'], ['title'], 'Show a notification to the person on the other device.'],
  ['person.approval.request', 'info', ['question'], ['details'], 'Ask the person on the other device to approve something.'],
  ['person.secret.request', 'info', ['name'], ['reason'], 'Ask the person to send a secret (they use the page; the value never passes through agents).'],
  // ---- source code -----------------------------------------------------------
  ['code.repo.status', 'read', [], ['repo'], 'Report a repository\'s status (branch, changes).'],
  ['code.repo.clone', 'change', ['url'], ['dir'], 'Clone a repository.'],
  ['code.repo.fetch', 'change', [], ['repo', 'remote'], 'Fetch from a remote.'],
  ['code.branch.list', 'read', [], ['repo'], 'List branches.'],
  ['code.branch.create', 'change', ['name'], ['repo', 'from'], 'Create a branch.'],
  ['code.branch.switch', 'change', ['name'], ['repo'], 'Switch to a branch.'],
  ['code.branch.merge', 'high', ['source'], ['target', 'repo'], 'Merge one branch into another.'],
  ['code.branch.delete', 'high', ['name'], ['repo'], 'Delete a branch.'],
  ['code.file.read', 'read', ['path'], ['repo', 'lines'], 'Read a source file.'],
  ['code.file.search', 'read', ['query'], ['repo', 'glob'], 'Search the code.'],
  ['code.file.write', 'high', ['path'], ['repo', 'text'], 'Write a source file.'],
  ['code.symbol.lookup', 'read', ['symbol'], ['repo'], 'Find where a symbol is defined and used.'],
  ['code.diff.show', 'read', [], ['repo', 'from', 'to', 'path'], 'Show a diff.'],
  ['code.patch.share', 'change', ['patch'], ['repo', 'summary'], 'Share a patch for the other agent to look at.'],
  ['code.patch.apply', 'high', ['patch'], ['repo'], 'Apply a patch to the working tree.'],
  ['code.commit.list', 'read', [], ['repo', 'branch', 'limit'], 'List commits.'],
  ['code.commit.create', 'change', ['message'], ['repo', 'files'], 'Create a commit.'],
  ['code.commit.revert', 'high', ['commit'], ['repo'], 'Revert a commit.'],
  ['code.remote.pull', 'change', [], ['repo', 'branch'], 'Pull from a remote.'],
  ['code.remote.push', 'high', [], ['repo', 'branch'], 'Push to a remote.'],
  ['code.tag.create', 'change', ['name'], ['repo', 'commit'], 'Create a tag.'],
  ['code.stash.save', 'change', [], ['repo', 'message'], 'Stash uncommitted changes.'],
  ['code.conflict.resolve', 'high', ['path'], ['repo', 'strategy'], 'Resolve a merge conflict.'],
  ['code.refactor.request', 'change', ['description'], ['repo', 'files'], 'Ask for a refactor.'],
  ['code.docs.generate', 'change', [], ['repo', 'path'], 'Generate or update code documentation.'],
  ['code.dependency.list', 'read', [], ['repo'], 'List dependencies.'],
  ['code.dependency.audit', 'read', [], ['repo'], 'Report known vulnerabilities in dependencies.'],
  ['code.dependency.add', 'high', ['name'], ['repo', 'version'], 'Add a dependency (installs code).'],
  ['code.dependency.update', 'high', [], ['repo', 'name', 'version'], 'Update dependencies (installs code).'],
  ['code.lint.run', 'high', [], ['repo', 'path'], 'Run the linter (runs project tooling).'],
  ['code.format.run', 'high', [], ['repo', 'path'], 'Run the formatter (rewrites files).'],
  ['code.build.run', 'high', [], ['repo', 'target'], 'Run the build (runs project code).'],
  ['code.test.run', 'high', [], ['repo', 'filter'], 'Run tests (runs project code).'],
  ['code.coverage.read', 'read', [], ['repo'], 'Read the latest test coverage.'],
  ['code.benchmark.run', 'high', [], ['repo', 'filter'], 'Run benchmarks (runs project code).'],
  // ---- pull requests and issues ---------------------------------------------
  ['code.pr.list', 'read', [], ['repo', 'state'], 'List pull requests.'],
  ['code.pr.read', 'read', ['id'], ['repo'], 'Read a pull request.'],
  ['code.pr.create', 'change', ['title'], ['repo', 'branch', 'body'], 'Open a pull request.'],
  ['code.pr.comment', 'change', ['id', 'comment'], ['repo'], 'Comment on a pull request.'],
  ['code.pr.approve', 'high', ['id'], ['repo'], 'Approve a pull request as the person.'],
  ['code.pr.merge', 'high', ['id'], ['repo', 'method'], 'Merge a pull request.'],
  ['code.issue.list', 'read', [], ['repo', 'state'], 'List issues.'],
  ['code.issue.read', 'read', ['id'], ['repo'], 'Read an issue.'],
  ['code.issue.create', 'change', ['title'], ['repo', 'body'], 'Open an issue.'],
  ['code.issue.comment', 'change', ['id', 'comment'], ['repo'], 'Comment on an issue.'],
  ['code.issue.close', 'change', ['id'], ['repo', 'reason'], 'Close an issue.'],
  // ---- CI and delivery --------------------------------------------------------
  ['ci.pipeline.status', 'read', [], ['repo', 'branch'], 'Report CI status.'],
  ['ci.pipeline.run', 'change', [], ['repo', 'branch', 'workflow'], 'Start a CI pipeline.'],
  ['ci.job.retry', 'change', ['job'], ['repo'], 'Retry a CI job.'],
  ['ci.job.cancel', 'change', ['job'], ['repo'], 'Cancel a CI job.'],
  ['ci.log.read', 'read', ['job'], ['repo'], 'Read a CI job\'s log.'],
  ['ci.artifact.fetch', 'read', ['name'], ['repo', 'job'], 'Fetch a build artifact.'],
  ['deploy.status.read', 'read', [], ['service', 'environment'], 'Report what is deployed where.'],
  ['deploy.environment.list', 'read', [], [], 'List deployment environments.'],
  ['deploy.release.create', 'high', ['version'], ['notes'], 'Create a release.'],
  ['deploy.service.deploy', 'high', ['service'], ['environment', 'version'], 'Deploy a service.'],
  ['deploy.service.rollback', 'high', ['service'], ['environment', 'version'], 'Roll a service back.'],
  // ---- containers and cloud ---------------------------------------------------
  ['container.instance.list', 'read', [], [], 'List containers.'],
  ['container.instance.start', 'high', ['name'], ['image'], 'Start a container.'],
  ['container.instance.stop', 'high', ['name'], [], 'Stop a container.'],
  ['container.log.read', 'read', ['name'], ['lines'], 'Read a container\'s logs.'],
  ['container.image.build', 'high', [], ['path', 'tag'], 'Build a container image.'],
  ['cloud.resource.list', 'read', [], ['provider', 'type'], 'List cloud resources.'],
  ['cloud.resource.create', 'high', ['type'], ['provider', 'name', 'config'], 'Create a cloud resource (may cost money).'],
  ['cloud.resource.delete', 'high', ['name'], ['provider', 'type'], 'Delete a cloud resource.'],
  ['cloud.cost.read', 'read', [], ['provider', 'period'], 'Report cloud spending.'],
  // ---- databases ----------------------------------------------------------------
  ['database.schema.read', 'read', [], ['database', 'table'], 'Read a database schema.'],
  ['database.query.read', 'read', ['query'], ['database'], 'Run a read-only query.'],
  ['database.query.write', 'high', ['query'], ['database'], 'Run a query that changes data.'],
  ['database.migration.run', 'high', [], ['database', 'migration'], 'Run a schema migration.'],
  ['database.backup.create', 'change', [], ['database'], 'Back up a database.'],
  // ---- configuration --------------------------------------------------------------
  ['config.setting.read', 'read', ['key'], ['scope'], 'Read a configuration setting.'],
  ['config.setting.update', 'high', ['key'], ['value', 'scope'], 'Change a configuration setting.'],
  ['config.env.list', 'read', [], ['scope'], 'List environment variable names (never values).'],
  // ---- monitoring --------------------------------------------------------------------
  ['monitor.log.read', 'read', [], ['service', 'since', 'query'], 'Read application logs.'],
  ['monitor.metric.read', 'read', ['metric'], ['service', 'period'], 'Read a metric.'],
  ['monitor.alert.list', 'read', [], ['service'], 'List open alerts.'],
  ['monitor.alert.acknowledge', 'change', ['alert'], ['note'], 'Acknowledge an alert.'],
  ['monitor.incident.report', 'info', ['summary'], ['service', 'severity'], 'Report an incident.'],
  // ---- security -------------------------------------------------------------------------
  ['security.scan.run', 'high', [], ['target', 'tool'], 'Run a security scan (runs tooling).'],
  ['security.finding.report', 'info', ['finding'], ['severity', 'location'], 'Report a security finding.'],
  ['security.key.rotate', 'high', ['name'], ['service'], 'Rotate a key or credential.'],
  // ---- web and browser ------------------------------------------------------------------
  ['web.page.fetch', 'read', ['url'], [], 'Fetch a web page.'],
  ['web.search.query', 'read', ['query'], [], 'Search the web.'],
  ['browser.page.open', 'change', ['url'], [], 'Open a page in the browser on the other device.'],
  // ---- the computer itself -----------------------------------------------------------------
  ['system.info.read', 'read', [], [], 'Report OS, hardware and versions.'],
  ['system.resource.read', 'read', [], ['kind'], 'Report CPU, memory and disk use.'],
  ['system.service.status', 'read', ['service'], [], 'Report whether a service is running.'],
  ['system.service.restart', 'high', ['service'], [], 'Restart a service.'],
  ['system.package.install', 'high', ['name'], ['version', 'manager'], 'Install software.'],
  ['system.update.install', 'high', [], ['scope'], 'Install system updates.'],
  ['system.power.control', 'high', ['action'], [], 'Sleep, restart or shut down the computer.'],
  // ---- notes, reminders, clipboard ---------------------------------------------------------
  ['clipboard.text.share', 'change', ['text'], [], 'Put text on the other device\'s clipboard.'],
  ['note.entry.create', 'change', ['text'], ['title', 'tags'], 'Create a note.'],
  ['note.entry.list', 'read', [], ['query'], 'List or search notes.'],
  ['reminder.entry.create', 'change', ['text'], ['when'], 'Create a reminder.'],
  // ---- documentation ---------------------------------------------------------------------------
  ['docs.page.read', 'read', ['page'], ['space'], 'Read a documentation page.'],
  ['docs.page.search', 'read', ['query'], ['space'], 'Search documentation.'],
  ['docs.page.update', 'change', ['page'], ['text', 'space'], 'Update a documentation page.'],
  // ---- AI models and data ------------------------------------------------------------------------
  ['model.prompt.run', 'change', ['prompt'], ['model'], 'Run a prompt on the other device\'s AI model (uses its quota).'],
  ['model.usage.read', 'read', [], ['period'], 'Report AI model usage and cost.'],
  ['data.file.convert', 'change', ['from'], ['to', 'path'], 'Convert a data file to another format.'],
  ['data.export.create', 'change', ['source'], ['format'], 'Export data.'],
  ['data.report.generate', 'change', ['topic'], ['format', 'period'], 'Generate a report.'],
  // ---- v0.5.0: shared project rooms (ids 160-) ----------------------------------------------------
  ['agent.room.post', 'info', ['room'], ['name', 'members', 'post'], 'Post in a shared project room: a group thread across paired devices (the text is the post).'],
  // ---- v0.6.0: cards (ids 161-) ------------------------------------------------------------------
  ['agent.card.post', 'info', [], ['card'], 'Post a card in a conversation: a task, status, decision, key request (a key NAME, never a value), file or link.'],
  ['agent.card.update', 'info', [], ['cardUpdate'], 'Change a card: claim, release, finish or reopen a task (a decision is answered only by a person).'],
];

export const CANONICAL_INTENTS = Object.freeze(TABLE.map(r => r[0]));
const BY_NAME = new Map(TABLE.map((r, id) => [r[0], { intent: r[0], id, risk: r[1], required: r[2], optional: r[3], description: r[4] }]));

export const isIntent = v => typeof v === 'string' && BY_NAME.has(v);
export const riskOf = intent => BY_NAME.get(intent)?.risk ?? 'high';
export const domainOf = intent => String(intent).split('.')[0];
export const describe = intent => BY_NAME.get(intent) || null;

/** The version that added each id range (for docs and compatibility notes). */
export const sinceVersion = id => (id < 30 ? '0.2.0' : id < 35 ? '0.3.0' : id < 160 ? '0.4.0' : id < 161 ? '0.5.0' : '0.6.0');

// Required args per intent (checked on send and on receipt).
export const ARG_SHAPES = Object.fromEntries(TABLE.filter(r => r[2].length).map(r => [r[0], { required: r[2] }]));

export function catalog() {
  return TABLE.map((r, id) => ({ intent: r[0], id, risk: r[1], domain: domainOf(r[0]), description: r[4], since: sinceVersion(id), ...(r[2].length ? { args: r[2] } : {}), ...(r[3].length ? { optional: r[3] } : {}) }));
}
