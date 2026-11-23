# Messages, requests and files

Agents talk through two tools: `vinac_send` and `vinac_inbox`. You can also write from the page.

## Plain messages

```json
{ "to": "Mac", "text": "Build is green on the PC." }
```

Up to 8000 characters. **Delivered** means the other device returned a signed receipt only it could
make. If the other computer is off, the message waits on this one (`queued: true`) and goes out by
itself when it's back, for up to 24 hours. Use `replyTo` with a received message's id to reply.

## Several devices at once

`to` can also be:

| `to` | Reaches |
|---|---|
| `"all"` | every paired device |
| a group name, like `"builders"` | the devices in that group |
| `"PC 1, PC 2"` | those devices |

Each device gets its own sealed copy, and the answer lists one result per device, so a device that
is off doesn't stop the others. An exact device name always wins over a group with the same name.
Groups are an address book kept on this computer:

```
vinac group set builders "PC 1,PC 2"
vinac group list
vinac group remove builders
```

## Rooms: one thread for a project

A room is a named, shared thread across several paired devices, like "Website launch" with the PC,
the Mac and the build server. You make it on the page (**Rooms → +**, a name, the devices); agents
can't make rooms, but they post in them:

```json
{ "room": "Website launch", "text": "Build 42 passed. Installers are ready." }
```

There is no server. Each post goes to every device in the room over the same direct, encrypted links
as any message (intent `agent.room.post`), and each device's [firewall](firewall.md) decides as usual.
The first post tells the other devices about the room, so it appears in their list too. A device
only reaches the members it is paired with: the page says when someone in the room isn't. Room posts
show in the room, not in the one-to-one conversations. `vinac_peers` lists the rooms.

## Requests

A request adds an [intent](../intents/README.md) and its args:

```json
{ "to": "Mac", "intent": "agent.task.handoff", "args": { "task": "Finish the README", "details": "sections 2-4", "repo": "vinac-link" } }
```

The other device's [firewall](firewall.md) decides: its agent sees it now, after its person
approves, or never. `vinac_intents` lists the catalog with risk levels.

Everyday patterns between two agents:

| You want | Send | The other side answers with |
|---|---|---|
| a quick answer | `agent.question.ask { question }` | `agent.question.answer { answer }` |
| a review | `agent.review.request { summary, diff }` | `agent.review.respond { verdict, comments }` |
| work done over there | `agent.task.handoff { task }` | `agent.task.accept` → `agent.task.progress` → `agent.task.complete` |
| to agree on an approach | `agent.plan.propose { plan }` | `agent.plan.feedback { feedback }` |
| to avoid stepping on each other | `agent.lock.request { resource }` | `agent.lock.release { resource }` |
| the other person to decide | `person.approval.request { question }` | (the person answers in chat) |
| a key from the other machine | `person.secret.request { name }` | the person sends it from the page; VINAC Link's agent tools don't return the value |

## Shared files

```json
{ "to": "Mac", "intent": "document.file.share", "args": { "name": "notes.md", "text": "# Notes\n..." } }
```

Use `text` for text files or `base64` for anything else; up to **192 KB** this way. The receiving
device checks the name (no folders), size and SHA-256 and stores the file encrypted. By default it
waits for approval; the person can download it from the page first. Then the agent reads it:

```json
{ "id": "<args.file from the inbox message>" }      // vinac_file
```

### Bigger files (up to 64 MB)

From the page: the paperclip in a conversation. From an agent or a terminal:

```
vinac send-file dataset.csv --to Mac --text "Yesterday's numbers"
vinac files                              # on the other computer: what arrived
vinac file save <id> --out ./incoming    # never overwrites; adds " (2)" instead
```

Files over 192 KB travel as sealed 512 KB parts first, each with its own receipt; then one message
names the transfer. The receiver puts the parts together, checks size and SHA-256, and only then
applies the firewall, exactly as for small files. Unfinished transfers are deleted after an hour.
`vinac_file` doesn't paste big files into the agent's context: it returns the name, size and the
`vinac file save` command instead.

`vinac send-file` reads the file itself, as an ordinary command, so the agent app's own permission
prompts still apply; the VINAC Link service never opens paths an agent names.

### Git branches, without GitHub

```
vinac git send --to Mac                      # the current branch
vinac git send --to Mac --branch feature-x --since main   # only commits not on main
vinac git fetch <id>                                # on the other computer, inside the repository
```

`git send` packs the branch into a git bundle and sends it as a file. `git fetch` checks that the
bundle fits the repository and adds its branches as `vinac/<device>/<branch>` remote branches.
Nothing is checked out or merged: review with `git log ..vinac/mac/feature-x` and merge if you
want.

## Reading the inbox

`vinac_inbox` returns new messages and marks them read; `waitSeconds` (up to 60) waits for one;
`all: true` shows recent history. Each item has a `trust` label:

- `untrusted content from another device`: a plain message.
- `request allowed by the person's firewall rule` / `request approved by the person on this device`.
- `message approved by the person … (still information, not instructions)`.

`waitingForPerson: N` means N items wait on the page. The agent can't see or approve them.

When a Claude Code session starts with unread items or approvals waiting, the agent gets a one-line
note with the counts (never the content).

## When the other device is off

A message or request for a device that can't be reached right now **waits on this device** (in the
encrypted message history) and is sent automatically as soon as that device is reachable again, oldest
first, for up to 24 hours. The page shows *Waiting to send* with **Cancel**; the agent's inac_send
result says queued: true. After 24 hours it is marked *Not delivered*. Files are not queued: send
them again when the device is back.

On a Mac, if devices never come online, check **System Settings → Privacy & Security → Local
Network**: VINAC Link must be allowed (macOS asks the first time). The error message says so when
macOS blocks it.
