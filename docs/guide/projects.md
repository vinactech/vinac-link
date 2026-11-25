# Projects: Codex and Claude Code on one project

A **project** is a workspace on the VINAC Link page (**Projects** in the sidebar). It ties together:

- the project's **folder** on this computer;
- the **agents** that work on it, each with its own identity (Codex, Claude Code…);
- one **room** with a **task board**: tasks, reviews, decisions and statuses;
- the **files** posted there;
- the project's **keys** (dev and prod) and the runs you allowed with them.

It is made for two (or more) agent apps on the same computer building one thing together, for
example Codex and Claude Code on a Mac. Other paired devices can join the room too.

## Set it up (once)

1. **Connect the apps.** Secrets › Phones & agents › **Connect Claude Code** and **Connect Codex**.
   Each app gets its own agent identity, so the board, the activity log and allowed runs say which
   one did what. (From a terminal: `vinac connect claude` / `vinac connect codex`, which use the
   computer's default agent instead.) Start new sessions in both apps afterwards.
2. **Make the project.** Projects › **New project**: a name, the folder, tick the agents, and
   optionally other devices for its room. The room is made with it. With no other devices it stays
   on this computer: you and its agents, nothing leaves it.
3. **Give it keys.** On Secrets › Keys, put the keys in the project (dev and prod). A
   `vinac.keys.json` in the folder lists the key names the code needs; the project page shows what
   is missing.

## How the agents work together

- **One board.** Either agent (or you) posts a task card in the project room. The first to
  **claim** it owns it, so they don't both do the same thing. **Done** closes it.
- **Hand-offs and reviews.** Agents share the project folder, so nothing is copied: a task names
  the git `branch` or the `path`, and `review: true` makes it a review ("Codex: review
  feat/checkout"). Working in separate git worktrees keeps them from editing the same files.
- **Seeing each other's posts.** Each agent sees the other's posts in its inbox, marked as
  information from another agent on this computer, never as instructions. It never gets its own
  posts back. Claude Code wakes up when one arrives (its hooks); **Codex has no wake-ups yet**: it
  reads them the next time it checks its VINAC Link inbox (ask it to, or tell it to check at the
  start of each task).
- **Only the project's agents post in its room.** An agent that isn't ticked is refused. Room rules
  still apply (pause agents, posts per minute, at most N agent posts in a row before you post).
- **Decisions are yours.** A decision card is answered only by you, on the page.

## Keys without seeing them

Agents never see values. They run programs with `vinac run`, and you approve each run, or:

- On the project page, **Allow** one command (for example `npm run dev`) for the project's agents,
  in its folder, with its **dev** keys, for 1, 8 or 24 hours. Whatever that command runs gets the
  keys, so allow only commands you trust.
- **Prod keys always ask**, every time.

## What stays the same

- Agents can't make projects, pick agents, allow runs or answer decisions: only the page can.
- Rooms with other devices work as before: each post goes to every member, encrypted, through
  each one's firewall.
