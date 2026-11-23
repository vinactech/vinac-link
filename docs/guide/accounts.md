# Accounts, relay and teams (beta)

VINAC Link works fully without an account: pairing, messages, the firewall, keys, files and rooms all
run directly between your computers. An optional account adds three things:

- **Your computers in one place:** which are linked, which are online, when each was last seen.
- **The relay:** your paired computers reach each other even on different networks.
- **Teams:** a Team console where teammates see each other's computers and shared monthly summaries.

Everything here is done by you, on the VINAC Link page or in the Team console. Agents can't sign
in, link a computer, turn on the relay or share a summary.

## Sign in and link this computer

1. On the VINAC Link page, open **Account (beta)** in the sidebar.
2. Type your email address and **Send me a sign-in code**. Type the 8-digit code from the email
   (it comes from no-reply@vinac.tech). There is no password.
3. **Link this computer.** This stores its name, its public identity key and fingerprint, its system,
   its VINAC Link version and *last seen* (updated about every 15 minutes while it runs). Never
   message contents, files, key values or your activity log.

Do the same on your other computers, with the same email. **Unlink** removes this computer's record
from the account; **Sign out** ends the session on this computer. Asking for a new code cancels the
previous one, so sign in on one computer at a time.

Linking an account never pairs computers: you still pair each one in person (see
[pairing](pairing.md)). The account only helps computers that already trust each other.

## The relay

When a paired computer can't be reached directly (the same network first, then Tailscale), VINAC Link
can pass the same sealed frames through your account's private relay instead. It takes about 1–2
seconds.

- **Off until you switch it on:** Account → **Relay** on each computer.
- **Only between computers paired in person and linked to the same account.** Pairing never goes
  through the relay.
- **Sealed:** the relay sees which of your computers a frame is from and to, its kind, size and time,
  never what's inside. It stores nothing: if the other computer isn't connected, the message waits on
  your computer as usual (up to 24 hours) and goes out when it can.
- **Limits:** 200 KB per frame and a rate limit per computer. Big files go faster on the same network.

Messages that went through the relay say *via relay*, and the overview shows *Online via relay*.

## The Team console

Open **vinac.tech/console** in a browser and sign in with your email code (the session stays in
that tab only).

- **Your computers:** the ones linked to your account, online or last seen.
- **Teams:** create a team (up to 5), rename it, invite people by email as *member* or *admin*.
  The console doesn't send the invitation: tell the person to sign in to the console with that email
  and accept it there. Invitations expire after 14 days.
- **Roles:** owners and admins invite people, remove members and rename the team; only owners
  change roles, invite admins or delete the team. Everyone but an owner can leave.
- **Team computers:** members see each other's email addresses and linked computers.

### Shared summaries

On a computer's VINAC Link page, Account → **Share summary** sends one month of activity to a team as
**counts only** (messages, requests, approvals, denials, allowed runs, how many agents and keys),
never names, contents or the log itself. The summary is signed by that computer's identity key, and
the console checks the signature against the computer's public key, so a teammate can tell nobody
changed it. Leaving a team deletes the summaries you shared with it.

## Deleting your data

Unlink a computer, leave a team, or (owner) delete a team in the console at any time. To delete the
whole account, write to hello@vinac.tech from its email address. See the
[privacy policy](https://vinac.tech/privacy.html).
