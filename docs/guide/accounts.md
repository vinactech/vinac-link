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
- **Only between computers paired in person and linked to the same account, or to teammates'
  accounts** (a team channel each; the other computer's key must match the team directory). Pairing
  never goes through the relay.
- **Sealed:** the relay sees which of your computers a frame is from and to, its kind, size and time,
  never what's inside.
- **The mailbox:** if the other computer isn't connected, the message is left sealed in your
  account's mailbox (up to 7 days) and that computer collects it when it connects, even if yours is
  off by then. Only the two paired computers can open it. Messages delivered this way say *via
  mailbox*.
- **Limits:** 200 KB per frame and a rate limit per computer. Big files go faster on the same network.

Messages that went through the relay say *via relay*, and the overview shows *Online via relay*.

## Working with your team across the internet

Teammates (people in the same team in the Team console) can work on one project from different
networks, each with their own computers and agents.

1. **Each person:** sign in, link the computer, and turn on the **Relay** (Account).
2. **Account › Your teams' computers** lists your teammates' linked computers, and whether yours is
   paired with each. A red *Key does not match* means a paired computer's key differs from the one
   in the team's list: stop and check with your team.
3. **Pair over the internet:** press it next to a teammate's computer. They see the request (in that
   list and in **Needs me**) and press **Accept**. Both screens then show the same 6 digits: compare
   them by phone or chat, and both press **Allow**. Nothing is confirmed automatically, and agents
   can't send, accept or confirm a pairing.
4. **Projects:** on a project's page, **Add to the room** puts a teammate's computer in the project
   room. Their agents see the project's posts and tasks from then on, each through their own firewall.

Teammates' computers use a channel for their team that only members can join, and each computer
checks the other's key against the team's list before anything goes through.

## Your computer from a browser (VINAC Web)

VINAC Web (vinac.tech/web) lets a browser, on a phone or another laptop, reach one of your computers
through your account's relay: what needs you, your projects (claim a task, mark it done) and rooms
(read and post), answers and approvals.

1. On the computer: sign in, link it and turn on the **Relay** (Account).
2. **Account › Your browsers › Add a browser.** Open the link it shows in the browser you want to add
   (or scan the code with a phone). It works for 10 minutes, once.
3. In that browser, sign in with **the same account**, name the browser and press **Add this browser**.
4. Both screens show 6 digits. If they match, press **Allow** on the computer.

The browser makes its own key (it can't be copied out of the browser) and seals every request for
that computer only; the relay sees neither the request nor the answer. Old or replayed requests are
refused. A browser can't pair devices, change firewall rules or see key values, and the computer
handles only a short list of actions from it, each recorded in the activity log. To take a browser's
access away, press **Remove** next to it in **Your browsers**.

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
