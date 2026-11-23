# Secrets

Send an API key or token from one computer to the other **without it passing through any chat,
agent or tool output**.

1. On the **sending** computer: **Secrets** → **Send** (or the key button in a conversation) →
   pick the device, a name (like `OPENAI_API_KEY`) and the value → **Wi-Fi**.
2. On the **receiving** computer it arrives as an **offer**: *Offered: accept?* with **Accept** /
   **Decline**. Nothing can use it before you accept. It is accepted at once when that computer
   asked for it (below), or when the sending device is in **Auto** mode there.
3. **By sound** (beta, no network needed): the receiving computer first presses **Receive by
   sound** (it listens for 3 minutes), then the sender chooses **Sound** (~15 s, devices close
   together).

## Asking for a key

When a program on one computer needs a key the other has, its agent asks for it (intent
`person.secret.request`, for example "STRIPE_KEY: npm start needs it"). The other computer's
Secrets page shows **Asked for by your devices · STRIPE_KEY · Send**: one click sends it from the
vault, and because the asking computer asked, it is accepted there without another click (for an
hour). **Dismiss** removes the request; if the key isn't there yet, **Add it** first.

## The vault

The **Secrets** page is a small vault for this device:

- **Add** keeps a key you already have (name and value) in this device's key store, without sending
  it anywhere. Adding the same name again replaces your copy.
- **Send…** on any stored secret sends it on to a paired device, by sound or Wi-Fi. The value goes
  from the key store straight into the sealed message; it never shows on the page.
- **Search** finds a secret by name or by the device it came from. Each one shows where it came
  from (added here, or from which device) and when a program last used it.

- **Copy** puts a value on the clipboard and clears it again after 30 seconds (if it's still there).

## Lock the vault with a passphrase (recommended)

Without a passphrase, values are protected by the OS key store (Windows DPAPI, the macOS
Keychain, the Linux Secret Service). That stops other user accounts and a stolen disk, but other
programs running as **you** can ask the key store for them.

With a passphrase (**Secrets** → *Lock the vault with a passphrase*), every value is also sealed to a
vault key (X25519, AES-256-GCM), and that key is encrypted with your passphrase (scrypt). While the
vault is locked, **no program can read the values**, not even one running as you.

- New secrets still arrive while it's locked: they are sealed with the vault's public key.
- **Unlock** to reveal, copy or send a secret, or to approve a program run. It locks itself again
  after 15 minutes, or press **Lock now**.
- The passphrase is never stored or sent anywhere. Five wrong tries in a minute are refused.
- **If you forget it, the values are lost.** Send them again from another device, then use
  *Remove passphrase* only if you still know it (it puts values back in the key store only).

Agents see secrets only by **name** (`vinac_secrets`). They cannot add, send, reveal or delete one,
and they cannot unlock the vault.
The person can Reveal or Copy a value on the page. An agent can ask for one with
`person.secret.request { name, reason }`; the person still does the sending.

## Using a secret in a program: `vinac run`

```
vinac run --secret OPENAI_API_KEY -- npm start
vinac run --secret prod_db=DATABASE_URL --secret STRIPE_KEY -- node server.js
```

If the program prints a value, the terminal shows `[hidden: NAME]` instead (add `--show-output`
for a raw terminal with colours and prompts; nothing is hidden then). This catches a value as
printed, not one the program encodes first, so approving the run is still the real check.

`vinac run` asks the service for the named secrets, then waits. The page (**Secrets**) shows
*"Use OPENAI_API_KEY?"* with the exact command and folder, and **Approve this run** / **Deny**.
Only after you approve does the program start, with the values in its environment (under the
secret's name, or the variable after `=`). Each approval covers one run, expires after 2 minutes,
and is written to the [audit log](cli.md#audit). The value never appears in the terminal, the chat or
the agent's context, unless the program itself prints it.

### Allow a run for a while (standing grants)

Approving every run gets in the way of an agent that works on its own. Next to **Approve this run**
you can choose **Allow for 1 hour, 8 hours, 24 hours or 7 days**. That allows the same agent to run
the same command in the same folder (and its subfolders) with the same keys, without asking, until
it expires. Tick *also with more arguments after this command* to allow, say, `npm run` followed by
any script name.

- A run under a grant is **started by VINAC Link itself**: the values go from the key store into
  that program's environment and nowhere else, so the agent never sees them. Its output comes back
  with values shown as `[hidden: NAME]`; it gets no keyboard input, and Ctrl-C stops it.
- **Allowed runs** on the Secrets page lists every grant (agent, keys, command, folder, until when,
  how often it was used) with **Revoke**. While the vault is locked, grants don't work: you're asked
  again. Every grant, use and revocation is in the [audit log](cli.md#audit).
- Whatever the command runs gets the keys. `npm test` runs that folder's `package.json` scripts, and
  an agent that can edit them can make the command leak a key. Allow only commands and folders you
  trust, for as short as works.

### Your keys on your phone (phone vault, beta)

Keep keys on your phone and hand one to a computer by sound, with no network between them.

1. **Pair once.** On the computer: **Secrets › Phones › Pair a phone**. Point your phone's camera at
   the code; it opens the phone vault at vinac.tech/app (the computer's one-time code is after the `#`
   in that link, which browsers never send to any server). Make the vault there with a passphrase,
   then press **Play pairing sound** close to the computer. Both screens show the same 6 digits:
   press **Allow** on the computer.
2. **Add keys** on the phone (**Add a key**). They are encrypted on the phone with your passphrase
   (AES-256, key from PBKDF2) and never leave it except as sound.
3. **Send one:** on the computer, **Receive by sound**; on the phone, **Send** next to the key, then
   **Play** (10–20 seconds, phone close to the computer). It's sealed for that one computer (X25519,
   AES-256-GCM); a recording played again is refused.

The phone vault locks after 5 minutes. Add it to your Home Screen so the phone keeps it; if you
forget the passphrase, its keys can't be opened. **Remove** a phone on the computer (Secrets ›
Phones) to stop accepting its keys. Like sound pairing, it's in beta while we test more phones.

### Agents on this computer

Under **Secrets › Agents on this computer**, give each agent app its own name, for example "Codex on
the Mac". You get a line like `VINAC_AGENT_TOKEN=agt_…`, shown once: put it in that app's VINAC Link
settings (for Codex: `codex mcp add vinac --env VINAC_AGENT_TOKEN=agt_… -- node <folder>/connector/bin/vinac.mjs mcp`;
for a terminal, set it before `vinac run`). Then the page, the audit log and grants say which agent
did what, and a grant made from that agent's run covers only that agent. Agents can't add
themselves. **Remove** ends the token and its grants. (Like every token on your computer, a program
running as you could read it from that app's settings: identities are for accountability.)

An agent can use `vinac run` too: you see its command on the page before anything happens. Be
careful what you approve. A program that receives a secret can do anything with it, and a
same-user program could ask under a harmless-looking command (see [SECURITY.md](../../SECURITY.md)).

## Notes

- A second secret with the same name from the same device waits as **Replacement waiting** until
  you approve it.
- If you ever think a paired device was compromised, unpair it on the page and replace the secrets you sent it.
- For the most sensitive production keys, we suggest waiting for the published security audit.
