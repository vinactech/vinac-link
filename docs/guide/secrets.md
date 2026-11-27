# Secrets

Send an API key or token from one computer to the other **without it passing through any chat,
agent or tool output**.

The **Secrets** page has three actions: **Add** (keep a key here), **Send…** and **Receive…**, and
three tabs: **Keys** (your vault), **Requests** (keys your devices ask for, programs asking to use a
key, allowed runs) and **Phones**. Agent apps and their identities are on the **Agents** page. A tab shows a count when something waits for you.

1. On the **sending** computer: **Secrets** → **Send…** (or the key button in a conversation) →
   pick the device, then a key from the vault or a new one (name like `OPENAI_API_KEY` and value).
   The method follows the device: **Network** when it is reachable (same Wi-Fi or cable, or
   Tailscale), **Sound** when it looks offline. You can change it.
2. On the **receiving** computer it arrives as an **offer**: *Offered: accept?* with **Accept** /
   **Decline**. Nothing can use it before you accept. It is accepted at once when that computer
   asked for it (below), when its person chose **Receive…** in the last 3 minutes, or when the
   sending device is in **Auto** mode there.

**Receive…** lists the ways to get a key, best first:

| Choice | What happens |
|---|---|
| **Ask a computer for it** | Name the key; the other computer shows it under *Requests* with **Send**. When its person sends it, it is accepted here without another click (for an hour). |
| **Someone is sending it over the network** | For 3 minutes, a key sent from a paired computer is accepted here without asking. |
| **By sound, no network** (beta) | This computer listens with its microphone for 3 minutes; the other one chooses **Sound** when it sends (about 10 to 35 s, devices close together). See [Sound and speakers](sound.md). |
| **From your phone** (beta) | Listens for the [phone vault](#your-keys-on-your-phone-phone-vault-beta); press **Send** on the phone. With no phone paired yet, it opens *Pair a phone*. |
| **Type or paste it** | You have the value already: the same as **Add**. |

## Asking for a key

When a program on one computer needs a key the other has, its agent asks for it (intent
`person.secret.request`, for example "STRIPE_KEY: npm start needs it"). The other computer's
Secrets page shows **Asked for by your devices · STRIPE_KEY · Send**: one click sends it from the
vault, and because the asking computer asked, it is accepted there without another click (for an
hour). **Dismiss** removes the request; if the key isn't there yet, **Add it** first.

A person can ask too: **Receive…** › **Ask a computer for it**, then the key name (and why, if you
like). It shows up on the other computer's *Requests* tab the same way.

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
  that program's environment, not through the agent or VINAC Link's agent tools. (The program itself gets them, and anything it runs.) Its output comes back
  with values shown as `[hidden: NAME]`; it gets no keyboard input, and Ctrl-C stops it.
- **Allowed runs** on the Secrets page lists every grant (agent, keys, command, folder, until when,
  how often it was used) with **Revoke**. While the vault is locked, grants don't work: you're asked
  again. Every grant, use and revocation is in the [audit log](cli.md#audit).
- Whatever the command runs gets the keys. `npm test` runs that folder's `package.json` scripts, and
  an agent that can edit them can make the command leak a key. Allow only commands and folders you
  trust, for as short as works.

## Projects: keys per project and environment

With several projects (each with its own Supabase, Resend… keys), group them on **Secrets ›
Projects**:

1. **New project**: a name and its folder on this computer (the repo). Production keys ask you every
   time they're used, unless you turn that off.
2. Put each key in a project and environment with the picker next to it (**Website · dev**,
   **Website · prod**), or leave it in **No project**. The same name can live in several projects.
3. An agent working in the project's folder sees only that project's key names (and keys in no
   project); `vinac run` there uses that project's key. A key of another project is never used.

**What the project needs.** Commit a `vinac.keys.json` with the key *names* (never values):

```json
{ "dev": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "RESEND_API_KEY"], "prod": ["SUPABASE_URL"] }
```

`vinac keys check` (or `--env prod`) lists what's missing on this computer, and
`vinac run -- npm run dev` (no `--secret`) runs with exactly that list. `--env prod` uses the prod
keys and always asks you.

**In a room.** Link the room to the project (picker in the room's header). A key request card posted
there names the project; on the computer that has the key, press **Send** on the card. The value goes
sealed to the computer that asked, never to the room, and lands in the same project there.

### Your keys on your phone (phone vault, beta)

Your API key is on your phone and you need it on your laptop: send it sealed for that laptop, without
joining a Wi-Fi network or pasting it into an AI chat. Keep keys on your phone and hand them between
your phone, your computers and other phones, with no network between them.

> Sound is optional and in beta. A nearby microphone can record the tones. They are sealed for one
> paired device and a recording played again is refused, but someone who later steals that pairing
> key could open an old recording (no forward secrecy yet; see [SECURITY.md](../../SECURITY.md)).
> Use test keys until the independent security review.

1. **Pair once.** On the computer: **Secrets › Phones › Pair a phone**. Point your phone's camera at
   the code; it opens the phone vault at vinac.tech/app (the computer's one-time code is after the `#`
   in that link, which browsers never send to any server). Make the vault there with a passphrase,
   then press **Play pairing sound** close to the computer. Both screens show the same 6 digits:
   press **Allow** on the computer.
2. **Add keys** on the phone (**Add a key**). They are encrypted on the phone with your passphrase
   (AES-256, key from PBKDF2) and leave it only sealed for one paired device.
3. **Phone to computer:** on the computer, **Receive…** › **From your phone**; on the phone, **Send**
   next to the key, then **Play** (10–20 seconds, phone close to the computer). It's sealed for that
   one computer (X25519, AES-256-GCM); a recording played again is refused.
4. **Computer to phone:** on the computer, **⋯ › Send to a phone…** next to a key, then **Show the
   code**. On the phone, point its camera at the code (or open the vault and press **↓ Receive ›
   Scan**), unlock, and press **Save on this phone**. No camera handy: press **Listen** on the phone
   and **Play as sound** on the computer.

**Phone to phone.** On one phone: **Devices › Pair another phone** shows a code. The other phone opens
it (its camera, or **↓ Receive › Scan** in its vault) and presses **Show my code**; the first phone
opens that one the same way (or listens while the other plays a sound). Both show the same 6 digits:
press **Allow** on the first phone, then **The other phone says Paired** on the second. After that,
**Send** on a key shows a code that only the other phone can open, once.

Scanning inside the vault needs a browser that reads QR codes (Chrome on Android, for example); on
other phones use the camera app, which opens the link in the browser. If you added the vault to your
Home Screen on an iPhone, the camera opens links in Safari, which keeps its own copy of the vault:
there, use **Listen** and sound instead.

The phone vault locks after 5 minutes. Add it to your Home Screen so the phone keeps it; if you
forget the passphrase, its keys can't be opened. **Remove** a phone on the computer (Secrets ›
Phones), or a device in the vault's **Devices**, to stop accepting its keys. Like sound pairing, it's
in beta while we test more phones.

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
