# Security

Security is the reason VINAC Link exists. It lets AI agents on your computers work together without
giving any of them more trust than you decided to give.

## Our technology, on proven foundations

VINAC Link combines technology we designed ourselves with cryptography the security community has
studied for years:

- **Pairing that only people can complete.** Two computers find each other on your network, both
  screens show the same 6-digit code, and a person presses Allow on each. The code comes from the
  key exchange itself, so a device in the middle can't make the two screens agree. An invite (made
  only by a person on the page, used once, valid 10 minutes) stands in for that check when the
  other computer is elsewhere. Someone nearby, someone on the network, or an agent on either
  computer can't complete a pairing on their own.
- **An intent firewall.** Agents don't send each other free-form commands. Every request names its
  purpose from a fixed, versioned list, and your rules decide (allow, ask you first, or block)
  before your agent sees anything. Pick a mode (Restricted, Standard or Auto) to set the defaults in
  one click; high-risk requests stay blocked in every mode.
- **Secrets that never touch the chat.** Keys and tokens travel straight into your operating
  system's own secure key store. A key nobody asked for arrives as an offer and can't be used until
  you accept it. Agents can ask for a key by name and use it in programs you approve; VINAC Link's
  agent tools don't return secret values. Other programs running under the same OS account can
  still read unlocked secrets from the key store: lock the vault with a passphrase and, while it's
  locked, no program can read them.
- **Published, well-studied cryptography.** Pairing and every connection are built on the Noise
  protocol framework, the same family of protocols behind WireGuard and WhatsApp's transport
  encryption, with fresh keys for every session.

## How you're protected

| Protection | What it means for you |
|---|---|
| **End-to-end encryption** | Everything between your computers is encrypted for the paired device only, with keys that change every session. |
| **No servers in between** | Your computers talk directly. We run no relay, see none of your traffic and hold none of your keys. |
| **Proof of delivery** | "Delivered" means the other computer proved it received exactly that message. Replays and altered messages are refused. |
| **Your rules first** | Requests, files and plain messages are checked against your rules before an agent sees them. Only you can change the rules or approve a request, on the VINAC Link page. |
| **Human in the loop** | Agents can use the devices you paired, but only a person can pair a device, approve a request, change a rule or reveal a secret. |
| **Keys stay protected at rest** | Pairing keys and secrets are kept by Windows, macOS or Linux's own key store, and message history is encrypted on disk. With a vault passphrase, secrets are sealed again with a key only your passphrase opens. |
| **No flood of requests** | At most 25 requests from one device wait for you at a time, and a request nobody decides on expires after 3 days. |
| **A record you can check** | A tamper-evident log of pairings, approvals and secret use, without contents: a changed or removed line is detected, though someone with full control of the computer could still replace the whole log. Search it on the Activity log page, export it, and make reports signed with the device's key that anyone can verify. It supports a compliance program; it isn't proof of compliance on its own. |
| **Agents within limits** | An allowed run lets one agent use named keys for one command in one folder until a set time. VINAC Link starts the program itself, so the values don't pass through the agent or its tools (the program itself gets them); you can revoke it any time. |
| **A private local page** | The VINAC Link page only answers on your own computer and refuses other websites. |
| **Quiet on the network** | Only while *Pair a device* is open does a computer announce itself on your local network (its name and a one-time code). That alone can't pair anything, and it stops when you leave the screen. |

## Tested, and reviewed next

These protections are covered by automated tests that attack them: replaying messages, altering
them, forcing older protocol versions, pretending to be another device. An independent security audit is
planned, and we will publish its results.

## Good to know

- VINAC Link is in early access. For the most sensitive production keys, we suggest waiting for the
  published audit.
- Like any app, VINAC Link can't fully protect you from malware that is already running on your
  computer under your account. A vault passphrase keeps your secrets sealed from it while the vault is locked.
- A message that your rules let through is still just text: an agent should treat it as information,
  not as orders.

## Report a problem

If you find a security issue, please email **hello@vinac.tech** with "Security" in the subject, and
don't post it publicly until we've fixed it. We reply within a few days and are glad to credit you.
Security reviewers can ask us for the full technical design.
