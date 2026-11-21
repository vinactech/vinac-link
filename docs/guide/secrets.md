# Secrets

Send an API key or token from one computer to the other **without it passing through any chat,
agent or tool output**.

1. On the **receiving** computer: page → **Secrets** → **Receive**. It accepts secrets for
   3 minutes, by sound or Wi-Fi.
2. On the **sending** computer: **Secrets** → **Send** (or the key button in a conversation) →
   pick the device, a name (like `OPENAI_API_KEY`) and the value → **Sound** (~15 s, devices close
   together) or **Wi-Fi**.
3. The receiver stores it in the OS key store and confirms. The sender shows *received*.

## The vault

The **Secrets** page is a small vault for this device:

- **Add** keeps a key you already have (name and value) in this device's key store, without sending
  it anywhere. Adding the same name again replaces your copy.
- **Send…** on any stored secret sends it on to a paired device, by sound or Wi-Fi. The value goes
  from the key store straight into the sealed message; it never shows on the page.
- **Search** finds a secret by name or by the device it came from. Each one shows where it came
  from (added here, or from which device) and when a program last used it.

Agents see secrets only by **name** (`vinac_secrets`). They cannot add, send, reveal or delete one.
The person can Reveal or Copy a value on the page. An agent can ask for one with
`person.secret.request { name, reason }`; the person still does the sending.

## Using a secret in a program: `vinac run`

```
vinac run --secret OPENAI_API_KEY -- npm start
vinac run --secret prod_db=DATABASE_URL --secret STRIPE_KEY -- node server.js
```

`vinac run` asks the service for the named secrets, then waits. The page (**Secrets**) shows
*"Use OPENAI_API_KEY?"* with the exact command and folder, and **Approve this run** / **Deny**.
Only after you approve does the program start, with the values in its environment (under the
secret's name, or the variable after `=`). Each approval covers one run, expires after 2 minutes,
and is written to the [audit log](cli.md#audit). The value never appears in the terminal, the chat or
the agent's context, unless the program itself prints it.

An agent can use `vinac run` too: you see its command on the page before anything happens. Be
careful what you approve. A program that receives a secret can do anything with it, and a
same-user program could ask under a harmless-looking command (see [SECURITY.md](../../SECURITY.md)).

## Notes

- A second secret with the same name from the same device waits as **Replacement waiting** until
  you approve it.
- If you ever think a paired device was compromised, unpair it on the page and replace the secrets you sent it.
- For the most sensitive production keys, we suggest waiting for the published security audit.
