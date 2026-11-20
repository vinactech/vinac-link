# Intent catalog v0.4.0

Generated from `connector/src/logos.js` by `node connector/tools/logos-doc.mjs`. Do not edit by hand.

160 intents: 22 info, 53 read, 47 change, 38 high. Defaults are what the receiving firewall does when the person has set no rule.

| Risk | Meaning | Default |
|---|---|---|
| info | Asks or tells something | Allow |
| read | Looks things up | Ask me |
| change | Creates or changes things | Ask me |
| high | Changes files, runs code, spends or deploys | Block |

## Agent to agent

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 30 | `agent.question.ask` | info | Allow | `question` | `context` | 0.3.0 | Ask the other agent a question. |
| 31 | `agent.status.update` | info | Allow | `status` | `details` | 0.3.0 | Tell the other agent how something stands. |
| 32 | `agent.review.request` | read | Ask me | `summary` | `diff`, `repo`, `branch`, `files` | 0.3.0 | Ask the other agent to review a change. |
| 33 | `agent.task.handoff` | change | Ask me | `task` | `details`, `repo`, `branch`, `due` | 0.3.0 | Hand a task to the other agent to do on its machine. |
| 35 | `agent.question.answer` | info | Allow | `answer` | `question` | 0.4.0 | Answer a question the other agent asked. |
| 36 | `agent.task.accept` | info | Allow | `task` | `eta` | 0.4.0 | Accept a handed-off task. |
| 37 | `agent.task.decline` | info | Allow | `task` | `reason` | 0.4.0 | Decline a handed-off task. |
| 38 | `agent.task.progress` | info | Allow | `progress` | `task`, `percent` | 0.4.0 | Report progress on a task. |
| 39 | `agent.task.complete` | info | Allow | `summary` | `task`, `result` | 0.4.0 | Report that a task is done. |
| 40 | `agent.task.cancel` | info | Allow | `task` | `reason` | 0.4.0 | Ask the other agent to stop a task it is doing for you. |
| 41 | `agent.plan.propose` | info | Allow | `plan` | `goal` | 0.4.0 | Share a plan for the other agent to comment on. |
| 42 | `agent.plan.feedback` | info | Allow | `feedback` | `plan` | 0.4.0 | Comment on a proposed plan. |
| 43 | `agent.review.respond` | info | Allow | `verdict` | `comments`, `review` | 0.4.0 | Return the result of a review. |
| 44 | `agent.context.share` | info | Allow | `context` | `topic` | 0.4.0 | Share background notes or context. |
| 45 | `agent.summary.share` | info | Allow | `summary` | `topic` | 0.4.0 | Share a summary of work or findings. |
| 46 | `agent.capability.query` | info | Allow |  | `topic` | 0.4.0 | Ask what the other agent can do or has access to. |
| 47 | `agent.capability.describe` | info | Allow | `capabilities` |  | 0.4.0 | Describe what this agent can do. |
| 48 | `agent.decision.request` | info | Allow | `question` | `options`, `deadline` | 0.4.0 | Ask the other side to decide between options. |
| 49 | `agent.error.report` | info | Allow | `error` | `task`, `details` | 0.4.0 | Report a failure or a blocker. |
| 50 | `agent.lock.request` | change | Ask me | `resource` | `reason`, `minutes` | 0.4.0 | Ask to work on a file, branch or resource alone for a while. |
| 51 | `agent.lock.release` | info | Allow | `resource` |  | 0.4.0 | Release a resource the agent locked. |
| 52 | `agent.work.delegate` | change | Ask me | `task` | `details`, `parent` | 0.4.0 | Delegate a sub-task of a larger job. |

## AI models

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 155 | `model.prompt.run` | change | Ask me | `prompt` | `model` | 0.4.0 | Run a prompt on the other device's AI model (uses its quota). |
| 156 | `model.usage.read` | read | Ask me |  | `period` | 0.4.0 | Report AI model usage and cost. |

## Browser

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 140 | `browser.page.open` | change | Ask me | `url` |  | 0.4.0 | Open a page in the browser on the other device. |

## Calendar

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 0 | `calendar.appointment.create` | change | Ask me |  | `title`, `start`, `end`, `attendees` | 0.2.0 | Create a calendar appointment. |
| 1 | `calendar.appointment.list` | read | Ask me |  | `from`, `to` | 0.2.0 | List calendar appointments. |

## CI

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 102 | `ci.pipeline.status` | read | Ask me |  | `repo`, `branch` | 0.4.0 | Report CI status. |
| 103 | `ci.pipeline.run` | change | Ask me |  | `repo`, `branch`, `workflow` | 0.4.0 | Start a CI pipeline. |
| 104 | `ci.job.retry` | change | Ask me | `job` | `repo` | 0.4.0 | Retry a CI job. |
| 105 | `ci.job.cancel` | change | Ask me | `job` | `repo` | 0.4.0 | Cancel a CI job. |
| 106 | `ci.log.read` | read | Ask me | `job` | `repo` | 0.4.0 | Read a CI job's log. |
| 107 | `ci.artifact.fetch` | read | Ask me | `name` | `repo`, `job` | 0.4.0 | Fetch a build artifact. |

## Clipboard

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 148 | `clipboard.text.share` | change | Ask me | `text` |  | 0.4.0 | Put text on the other device's clipboard. |

## Cloud

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 118 | `cloud.resource.list` | read | Ask me |  | `provider`, `type` | 0.4.0 | List cloud resources. |
| 119 | `cloud.resource.create` | high | Block | `type` | `provider`, `name`, `config` | 0.4.0 | Create a cloud resource (may cost money). |
| 120 | `cloud.resource.delete` | high | Block | `name` | `provider`, `type` | 0.4.0 | Delete a cloud resource. |
| 121 | `cloud.cost.read` | read | Ask me |  | `provider`, `period` | 0.4.0 | Report cloud spending. |

## Code, pull requests and issues

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 56 | `code.repo.status` | read | Ask me |  | `repo` | 0.4.0 | Report a repository's status (branch, changes). |
| 57 | `code.repo.clone` | change | Ask me | `url` | `dir` | 0.4.0 | Clone a repository. |
| 58 | `code.repo.fetch` | change | Ask me |  | `repo`, `remote` | 0.4.0 | Fetch from a remote. |
| 59 | `code.branch.list` | read | Ask me |  | `repo` | 0.4.0 | List branches. |
| 60 | `code.branch.create` | change | Ask me | `name` | `repo`, `from` | 0.4.0 | Create a branch. |
| 61 | `code.branch.switch` | change | Ask me | `name` | `repo` | 0.4.0 | Switch to a branch. |
| 62 | `code.branch.merge` | high | Block | `source` | `target`, `repo` | 0.4.0 | Merge one branch into another. |
| 63 | `code.branch.delete` | high | Block | `name` | `repo` | 0.4.0 | Delete a branch. |
| 64 | `code.file.read` | read | Ask me | `path` | `repo`, `lines` | 0.4.0 | Read a source file. |
| 65 | `code.file.search` | read | Ask me | `query` | `repo`, `glob` | 0.4.0 | Search the code. |
| 66 | `code.file.write` | high | Block | `path` | `repo`, `text` | 0.4.0 | Write a source file. |
| 67 | `code.symbol.lookup` | read | Ask me | `symbol` | `repo` | 0.4.0 | Find where a symbol is defined and used. |
| 68 | `code.diff.show` | read | Ask me |  | `repo`, `from`, `to`, `path` | 0.4.0 | Show a diff. |
| 69 | `code.patch.share` | change | Ask me | `patch` | `repo`, `summary` | 0.4.0 | Share a patch for the other agent to look at. |
| 70 | `code.patch.apply` | high | Block | `patch` | `repo` | 0.4.0 | Apply a patch to the working tree. |
| 71 | `code.commit.list` | read | Ask me |  | `repo`, `branch`, `limit` | 0.4.0 | List commits. |
| 72 | `code.commit.create` | change | Ask me | `message` | `repo`, `files` | 0.4.0 | Create a commit. |
| 73 | `code.commit.revert` | high | Block | `commit` | `repo` | 0.4.0 | Revert a commit. |
| 74 | `code.remote.pull` | change | Ask me |  | `repo`, `branch` | 0.4.0 | Pull from a remote. |
| 75 | `code.remote.push` | high | Block |  | `repo`, `branch` | 0.4.0 | Push to a remote. |
| 76 | `code.tag.create` | change | Ask me | `name` | `repo`, `commit` | 0.4.0 | Create a tag. |
| 77 | `code.stash.save` | change | Ask me |  | `repo`, `message` | 0.4.0 | Stash uncommitted changes. |
| 78 | `code.conflict.resolve` | high | Block | `path` | `repo`, `strategy` | 0.4.0 | Resolve a merge conflict. |
| 79 | `code.refactor.request` | change | Ask me | `description` | `repo`, `files` | 0.4.0 | Ask for a refactor. |
| 80 | `code.docs.generate` | change | Ask me |  | `repo`, `path` | 0.4.0 | Generate or update code documentation. |
| 81 | `code.dependency.list` | read | Ask me |  | `repo` | 0.4.0 | List dependencies. |
| 82 | `code.dependency.audit` | read | Ask me |  | `repo` | 0.4.0 | Report known vulnerabilities in dependencies. |
| 83 | `code.dependency.add` | high | Block | `name` | `repo`, `version` | 0.4.0 | Add a dependency (installs code). |
| 84 | `code.dependency.update` | high | Block |  | `repo`, `name`, `version` | 0.4.0 | Update dependencies (installs code). |
| 85 | `code.lint.run` | high | Block |  | `repo`, `path` | 0.4.0 | Run the linter (runs project tooling). |
| 86 | `code.format.run` | high | Block |  | `repo`, `path` | 0.4.0 | Run the formatter (rewrites files). |
| 87 | `code.build.run` | high | Block |  | `repo`, `target` | 0.4.0 | Run the build (runs project code). |
| 88 | `code.test.run` | high | Block |  | `repo`, `filter` | 0.4.0 | Run tests (runs project code). |
| 89 | `code.coverage.read` | read | Ask me |  | `repo` | 0.4.0 | Read the latest test coverage. |
| 90 | `code.benchmark.run` | high | Block |  | `repo`, `filter` | 0.4.0 | Run benchmarks (runs project code). |
| 91 | `code.pr.list` | read | Ask me |  | `repo`, `state` | 0.4.0 | List pull requests. |
| 92 | `code.pr.read` | read | Ask me | `id` | `repo` | 0.4.0 | Read a pull request. |
| 93 | `code.pr.create` | change | Ask me | `title` | `repo`, `branch`, `body` | 0.4.0 | Open a pull request. |
| 94 | `code.pr.comment` | change | Ask me | `id`, `comment` | `repo` | 0.4.0 | Comment on a pull request. |
| 95 | `code.pr.approve` | high | Block | `id` | `repo` | 0.4.0 | Approve a pull request as the person. |
| 96 | `code.pr.merge` | high | Block | `id` | `repo`, `method` | 0.4.0 | Merge a pull request. |
| 97 | `code.issue.list` | read | Ask me |  | `repo`, `state` | 0.4.0 | List issues. |
| 98 | `code.issue.read` | read | Ask me | `id` | `repo` | 0.4.0 | Read an issue. |
| 99 | `code.issue.create` | change | Ask me | `title` | `repo`, `body` | 0.4.0 | Open an issue. |
| 100 | `code.issue.comment` | change | Ask me | `id`, `comment` | `repo` | 0.4.0 | Comment on an issue. |
| 101 | `code.issue.close` | change | Ask me | `id` | `repo`, `reason` | 0.4.0 | Close an issue. |

## Configuration

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 127 | `config.setting.read` | read | Ask me | `key` | `scope` | 0.4.0 | Read a configuration setting. |
| 128 | `config.setting.update` | high | Block | `key` | `value`, `scope` | 0.4.0 | Change a configuration setting. |
| 129 | `config.env.list` | read | Ask me |  | `scope` | 0.4.0 | List environment variable names (never values). |

## Containers

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 113 | `container.instance.list` | read | Ask me |  |  | 0.4.0 | List containers. |
| 114 | `container.instance.start` | high | Block | `name` | `image` | 0.4.0 | Start a container. |
| 115 | `container.instance.stop` | high | Block | `name` |  | 0.4.0 | Stop a container. |
| 116 | `container.log.read` | read | Ask me | `name` | `lines` | 0.4.0 | Read a container's logs. |
| 117 | `container.image.build` | high | Block |  | `path`, `tag` | 0.4.0 | Build a container image. |

## CRM

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 4 | `crm.contact.create` | change | Ask me |  | `name`, `email` | 0.2.0 | Create a CRM contact. |
| 5 | `crm.contact.read` | read | Ask me |  | `name`, `id` | 0.2.0 | Read a CRM contact. |
| 6 | `crm.contact.search` | read | Ask me |  | `query` | 0.2.0 | Search CRM contacts. |
| 7 | `crm.contact.update` | change | Ask me |  | `id`, `fields` | 0.2.0 | Update a CRM contact. |
| 8 | `crm.deal.create` | change | Ask me |  | `name`, `value` | 0.2.0 | Create a CRM deal. |
| 9 | `crm.deal.list` | read | Ask me |  | `stage` | 0.2.0 | List CRM deals. |
| 10 | `crm.deal.read` | read | Ask me |  | `id` | 0.2.0 | Read a CRM deal. |
| 11 | `crm.deal.update` | change | Ask me |  | `id`, `fields` | 0.2.0 | Update a CRM deal. |
| 12 | `crm.note.create` | change | Ask me |  | `about`, `text` | 0.2.0 | Add a note in the CRM. |
| 13 | `crm.note.list` | read | Ask me |  | `about` | 0.2.0 | List CRM notes. |
| 14 | `crm.task.complete` | change | Ask me |  | `id` | 0.2.0 | Mark a CRM task done. |
| 15 | `crm.task.create` | change | Ask me |  | `title`, `due` | 0.2.0 | Create a CRM task. |
| 16 | `crm.task.list` | read | Ask me |  | `owner` | 0.2.0 | List CRM tasks. |
| 17 | `crm.task.update` | change | Ask me |  | `id`, `fields` | 0.2.0 | Update a CRM task. |

## Data

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 157 | `data.file.convert` | change | Ask me | `from` | `to`, `path` | 0.4.0 | Convert a data file to another format. |
| 158 | `data.export.create` | change | Ask me | `source` | `format` | 0.4.0 | Export data. |
| 159 | `data.report.generate` | change | Ask me | `topic` | `format`, `period` | 0.4.0 | Generate a report. |

## Databases

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 122 | `database.schema.read` | read | Ask me |  | `database`, `table` | 0.4.0 | Read a database schema. |
| 123 | `database.query.read` | read | Ask me | `query` | `database` | 0.4.0 | Run a read-only query. |
| 124 | `database.query.write` | high | Block | `query` | `database` | 0.4.0 | Run a query that changes data. |
| 125 | `database.migration.run` | high | Block |  | `database`, `migration` | 0.4.0 | Run a schema migration. |
| 126 | `database.backup.create` | change | Ask me |  | `database` | 0.4.0 | Back up a database. |

## Deploys

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 108 | `deploy.status.read` | read | Ask me |  | `service`, `environment` | 0.4.0 | Report what is deployed where. |
| 109 | `deploy.environment.list` | read | Ask me |  |  | 0.4.0 | List deployment environments. |
| 110 | `deploy.release.create` | high | Block | `version` | `notes` | 0.4.0 | Create a release. |
| 111 | `deploy.service.deploy` | high | Block | `service` | `environment`, `version` | 0.4.0 | Deploy a service. |
| 112 | `deploy.service.rollback` | high | Block | `service` | `environment`, `version` | 0.4.0 | Roll a service back. |

## Documentation

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 152 | `docs.page.read` | read | Ask me | `page` | `space` | 0.4.0 | Read a documentation page. |
| 153 | `docs.page.search` | read | Ask me | `query` | `space` | 0.4.0 | Search documentation. |
| 154 | `docs.page.update` | change | Ask me | `page` | `text`, `space` | 0.4.0 | Update a documentation page. |

## Files

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 18 | `document.file.list` | read | Ask me |  | `folder` | 0.2.0 | List files in a folder. |
| 19 | `document.file.move` | high | Block |  | `path`, `to` | 0.2.0 | Move a file. |
| 20 | `document.file.read` | read | Ask me |  | `path` | 0.2.0 | Read a file. |
| 21 | `document.file.rename` | high | Block |  | `path`, `name` | 0.2.0 | Rename a file. |
| 22 | `document.file.search` | read | Ask me |  | `query` | 0.2.0 | Search files. |
| 23 | `document.file.write` | high | Block |  | `path`, `text` | 0.2.0 | Write or overwrite a file. |
| 24 | `document.folder.create` | change | Ask me |  | `path` | 0.2.0 | Create a folder. |
| 25 | `document.folder.list` | read | Ask me |  | `path` | 0.2.0 | List folders. |
| 26 | `document.metadata.read` | read | Ask me |  | `path` | 0.2.0 | Read a file's metadata. |
| 34 | `document.file.share` | change | Ask me | `name` | `text`, `base64`, `mime` | 0.3.0 | Share a file (up to 192 KB in one message; bigger ones, up to 64 MB, arrive in parts first). |

## Messages for the person

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 2 | `communication.message.reply` | change | Ask me |  | `to`, `text` | 0.2.0 | Reply to a message on the person's behalf. |
| 3 | `communication.message.send` | change | Ask me |  | `to`, `text` | 0.2.0 | Send a message on the person's behalf (email, chat). |

## Monitoring

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 130 | `monitor.log.read` | read | Ask me |  | `service`, `since`, `query` | 0.4.0 | Read application logs. |
| 131 | `monitor.metric.read` | read | Ask me | `metric` | `service`, `period` | 0.4.0 | Read a metric. |
| 132 | `monitor.alert.list` | read | Ask me |  | `service` | 0.4.0 | List open alerts. |
| 133 | `monitor.alert.acknowledge` | change | Ask me | `alert` | `note` | 0.4.0 | Acknowledge an alert. |
| 134 | `monitor.incident.report` | info | Allow | `summary` | `service`, `severity` | 0.4.0 | Report an incident. |

## Notes

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 149 | `note.entry.create` | change | Ask me | `text` | `title`, `tags` | 0.4.0 | Create a note. |
| 150 | `note.entry.list` | read | Ask me |  | `query` | 0.4.0 | List or search notes. |

## Reminders

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 151 | `reminder.entry.create` | change | Ask me | `text` | `when` | 0.4.0 | Create a reminder. |

## Security

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 135 | `security.scan.run` | high | Block |  | `target`, `tool` | 0.4.0 | Run a security scan (runs tooling). |
| 136 | `security.finding.report` | info | Allow | `finding` | `severity`, `location` | 0.4.0 | Report a security finding. |
| 137 | `security.key.rotate` | high | Block | `name` | `service` | 0.4.0 | Rotate a key or credential. |

## Storage

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 27 | `storage.account.read` | read | Ask me |  | `account` | 0.2.0 | Read storage account details (usage, quota). |

## The person on the other device

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 53 | `person.notification.send` | change | Ask me | `message` | `title` | 0.4.0 | Show a notification to the person on the other device. |
| 54 | `person.approval.request` | info | Allow | `question` | `details` | 0.4.0 | Ask the person on the other device to approve something. |
| 55 | `person.secret.request` | info | Allow | `name` | `reason` | 0.4.0 | Ask the person to send a secret (they use the page; the value never passes through agents). |

## This computer

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 28 | `system.command.execute` | high | Block |  | `command`, `cwd` | 0.2.0 | Run a shell command. |
| 29 | `system.process.control` | high | Block |  | `process`, `action` | 0.2.0 | Start, stop or signal a process. |
| 141 | `system.info.read` | read | Ask me |  |  | 0.4.0 | Report OS, hardware and versions. |
| 142 | `system.resource.read` | read | Ask me |  | `kind` | 0.4.0 | Report CPU, memory and disk use. |
| 143 | `system.service.status` | read | Ask me | `service` |  | 0.4.0 | Report whether a service is running. |
| 144 | `system.service.restart` | high | Block | `service` |  | 0.4.0 | Restart a service. |
| 145 | `system.package.install` | high | Block | `name` | `version`, `manager` | 0.4.0 | Install software. |
| 146 | `system.update.install` | high | Block |  | `scope` | 0.4.0 | Install system updates. |
| 147 | `system.power.control` | high | Block | `action` |  | 0.4.0 | Sleep, restart or shut down the computer. |

## Web

| Id | Intent | Risk | Default | Required | Optional | Since | What it asks |
|---:|---|---|---|---|---|---|---|
| 138 | `web.page.fetch` | read | Ask me | `url` |  | 0.4.0 | Fetch a web page. |
| 139 | `web.search.query` | read | Ask me | `query` |  | 0.4.0 | Search the web. |
