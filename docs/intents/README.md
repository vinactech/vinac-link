# Intents

VINAC Link uses a small, fixed vocabulary of **intents**: names for what one agent asks another to do,
like `agent.review.request` or `code.remote.push`. They let the receiving computer
decide *by meaning* (allow, ask its person, or block) instead of guessing from free text.

- **[Full catalog →](catalog.md)** (generated from the code; 160 intents in v0.4.0)
- **[Firewall guide →](../guide/firewall.md)** (how rules use intents)

## A request

```json
{
  "to": "Mac",
  "intent": "agent.review.request",
  "args": { "summary": "Fix login redirect", "diff": "--- a/login.ts\n+++ b/login.ts\n...", "branch": "fix/login" },
  "text": "Could you check this before I merge?"
}
```

- `intent`: one name from the catalog. Anything else is refused by the sender **and** the receiver.
- `args`: a JSON object, at most 4000 characters (`document.file.share` carries a file up to 192 KB inside the message; bigger files, up to 64 MB, arrive in sealed parts first and the message names the transfer).
  Each intent lists **required** args (non-empty text, or a number for ids) and common **optional**
  ones. Required args are checked on both sides; optional ones are a convention.
- `text`: optional human-readable note. If missing, VINAC Link writes one (`Request: <intent> …`) so
  devices that don't know the intent still show something.

## Names

`domain.object.action`, lowercase, three parts:

| Part | Examples |
|---|---|
| domain | `agent`, `person`, `code`, `ci`, `deploy`, `container`, `cloud`, `database`, `config`, `monitor`, `security`, `web`, `browser`, `system`, `docs`, `model`, `data`, `note`, `reminder`, `clipboard`, plus the v0.2 business domains `calendar`, `communication`, `crm`, `document`, `storage` |
| object | `task`, `review`, `branch`, `pr`, `pipeline`, `service`, `query`, … |
| action | a verb: `ask`, `read`, `list`, `search`, `create`, `update`, `run`, `push`, `merge`, `deploy`, … |

## Risk

Every intent has one risk level. It sets the **default** firewall decision when the person hasn't
set a rule, and it's shown on the page next to every request.

| Risk | Meaning | Default | Examples |
|---|---|---|---|
| **info** | Asks or tells something; acting on it can't change anything by itself | Allow | `agent.question.ask`, `agent.task.complete`, `security.finding.report` |
| **read** | Looks something up (may reveal information) | Ask me | `code.file.read`, `database.query.read`, `ci.log.read` |
| **change** | Creates or changes something recoverable | Ask me | `code.branch.create`, `code.pr.comment`, `agent.task.handoff` |
| **high** | Changes files, runs code, pushes, merges, deploys, deletes, spends or restarts | Block | `code.test.run`, `code.remote.push`, `deploy.service.deploy`, `system.command.execute` |

Rule of thumb for classifying a new intent: if a tricked agent did it without asking, could it lose
work, leak secrets, run untrusted code, cost money or affect other people? Then it's **high**.
Running tests or a build counts as running code (a repo can make `npm test` do anything).

## Versions and compatibility

- Ids are positions in the catalog and **never change**: intents are only appended. 0–29 are the
  v0.2.0 business intents (shared with the VINAC research packages), 30–34 came in v0.3.0, 35+ in v0.4.0.
- A device refuses intents it doesn't know. The sender then gets: *"<device> does not know the
  intent … yet (its intent catalog is older). Update VINAC Link there, or send plain text."*
- Changing an intent's risk changes only defaults; existing rules the person set stay as they are.

## Adding intents

1. Append a row to the table in `connector/src/logos.js`: name, risk, required args, optional args,
   one-line description ending with a period.
2. Bump `LOGOS_VERSION` if it's the first addition since the last release.
3. Run `node connector/tools/logos-doc.mjs` to regenerate [catalog.md](catalog.md); `npm test` checks
   the rules (unique names, three parts, risk, description, high risk for anything that runs, pushes,
   deploys…) and that the doc matches the code.
