# About VINAC Link

## Why we built it

We build with AI agents every day, and like many teams we ended up with several computers working
at once: a desktop for the heavy work, a laptop on the move, test machines, and some machines kept
off the internet on purpose.

The agents on those computers were good at their jobs, but they couldn't help each other. Whenever
one needed something from another (an answer, a status, an API key), a person had to carry it across
by hand: copy, paste, message yourself, and hope nothing leaked on the way. API keys ended up pasted
into chats and notes, where they don't belong. The offline machines had it worse. With no internet
and no cloud service, the only way to hand them a token was a USB stick.

We looked for a tool that would connect our own computers directly, keep secrets out of every chat,
work with or without the internet, and keep a person in charge of what each agent is allowed to do.
We didn't find one, so we built it.

## Our story

- **July 2026.** The question: why can't the agents on our own computers help each other, safely?
- **Summer 2026.** The first prototype pairs two computers with a short burst of sound.
- **October 2026.** VINAC Link becomes a product, built around a firewall the person controls.
- **November 2026.** Early access: installers, full offline use, this website, then firewall modes, a
  vault you can lock with a passphrase, messages that wait for a computer that's off, pairing with
  one Allow on each computer, invites, and asking for a key in one click.

Next come a one-step project hand-off, an independent security audit, a signed Windows installer and an
optional relay.
[See the full roadmap and our vision →](/roadmap.html)

## What it does

VINAC Link is a secure link between the AI agents on your own computers, from any vendor, online
or offline, and nothing important happens without your OK.

1. **Pair once.** Two computers find each other on your network (or with an invite). Both screens
   show the same 6-digit code, and you press Allow on each. Only a person can finish pairing.
2. **Share keys and tokens.** API keys and tokens move straight into the other computer's secure key
   store, a vault you can lock with a passphrase. They never appear in a chat, and VINAC Link's agent
   tools don't return secret values.
3. **Send requests your rules check.** Agents ask each other for answers, reviews or files. Each
   request says exactly what it wants, and your rules let it through, ask you first, or block it.
  Restricted, Standard or Auto mode sets those rules in one click.

It works with cloud agents like Claude Code and Codex, and with local models in LM Studio, Ollama,
Goose or Open WebUI, on your own network, with or without the internet.

## What we believe

- **People create trust; agents use it.** No agent can pair a device, approve a request or change a
  rule. A human stays in the loop for everything that matters.
- **Secrets never belong in a chat.** Keys and tokens should go from one key store to another,
  and nowhere else.
- **Your computers, your network, your rules.** Your devices talk to each other directly. We see no
  traffic and no keys. If you later choose our optional relay, it only passes on sealed messages it
  can't read.
- **Open and checkable.** VINAC Link is open source, built on published cryptography, and tested
  against attacks. An independent security audit is planned, and we will publish its results.

## The name

**VINAC** stands for **Verified Intent Network for Agent Communication**. Every request between
agents states its intent, and every intent is checked, by your rules and, when it matters, by you.

## Who we are

VINAC Link™ is made by Mexley Marketing Inc., a Canadian company. We'd love to hear how you use it,
what's missing, or how we could work together: [write to us](/#contact) or email
**hello@vinac.tech**. Follow us on [LinkedIn](https://www.linkedin.com/company/vinac-link) and
[GitHub](https://github.com/vinactech/vinac-link), get news a few times a year from our
[newsletter](/#news), or [support the project](/#support).
