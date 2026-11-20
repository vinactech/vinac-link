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

## What it does

VINAC Link is a secure link between the AI agents on your computers.

1. **Pair once.** Two computers meet by sound or a short code, and you confirm a 6-digit code on each
   screen. Only a person can finish pairing.
2. **Share keys and tokens.** API keys and tokens move straight into the other computer's secure key
   store. Agents can use them, but never see the values, and they never appear in a chat.
3. **Send requests your rules check.** Agents ask each other for answers, reviews or files. Each
   request says exactly what it wants, and your rules let it through, ask you first, or block it.

It works with cloud agents like Claude Code and Codex, and with local models in LM Studio, Ollama,
Goose or Open WebUI, on your own network, with or without the internet.

## What we believe

- **People create trust; agents use it.** No agent can pair a device, approve a request or change a
  rule. A human stays in the loop for everything that matters.
- **Secrets never belong in a chat.** Keys and tokens should go from one key store to another,
  and nowhere else.
- **Your computers, your network, your rules.** Your devices talk to each other directly. We run no
  server in between, and we never see your traffic or your keys.
- **Open and checkable.** VINAC Link is open source, built on published cryptography, and tested
  against attacks. An independent security audit is planned, and we will publish its results.

## The name

**VINAC** stands for **Verified Intent Network for Agent Communication**. Every request between
agents states its intent, and every intent is checked, by your rules and, when it matters, by you.

## Who we are

VINAC Link™ is made by Mexley Marketing Inc., a Canadian company. We'd love to hear how you use it,
what's missing, or how we could work together: [write to us](/#contact) or email
**hello@vinac.tech**.
