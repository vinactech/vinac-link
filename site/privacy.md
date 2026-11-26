# Privacy Policy

*Effective November 26, 2026* · [What changed](#changes)

This policy explains what personal information Mexley Marketing Inc. ("we", "us") collects through
the website vinac.tech and the VINAC Link software, and how we handle it. We are based in Ontario,
Canada, and we follow Canada's *Personal Information Protection and Electronic Documents Act*
(PIPEDA). In short: we collect as little as we can, and the contents of what your devices exchange
never reach us.

## The VINAC Link software

VINAC Link runs on your own computers. **Without an account, it sends us nothing.** There is no
telemetry, no analytics and no automatic reporting. Your pairings, messages, requests, files, keys
and tokens stay on the computers you pair, and travel directly between them, encrypted.

Everything below about accounts, the relay and teams applies only if you choose to use them. Each
one is off until you turn it on yourself, on the VINAC Link page on your computer or in the Team
console. AI agents connected to VINAC Link can't sign in, link a computer, turn on the relay or share
a summary for you.

**Shared rooms** need no account and no server. A room is a thread between your paired devices, and
each post travels over the same direct, encrypted links as any other message.

While the *Pair a device* screen is open, VINAC Link announces the computer on your **local
network only** (its name, its network address and a one-time pairing code), so your other computer
can find it. This never goes to us or to the internet, and it stops when you leave that screen.

If you choose to connect VINAC Link to third-party AI services (for example a cloud AI agent), those
services handle your data under their own terms and privacy policies, not ours.

The **phone vault** (vinac.tech/app) runs in your phone's browser. Your keys, your passphrase and
the computers you pair stay on the phone, encrypted; the app sends nothing to us. The pairing code in
its link sits after the `#`, which browsers never send to a web server.

**VINAC Web** (vinac.tech/web) lets a browser you add reach your computer through your account's
relay. The browser keeps its own key and your sign-in session in that browser's storage; its
requests and the answers are sealed so that only that browser and that computer can read them. The
relay passes them on as described below and keeps none of them.

## Accounts (optional)

You can create an account to link your computers, use the relay and join teams. To sign in, you enter
your email address and type the code we email you. There is no password.

- **What the account holds:** your email address, when the account was made and when you last signed
  in, and the internet address you signed in from (kept briefly in our sign-in provider's security
  logs), and an optional display name.
- **For each computer you link:** its name, its public identity key and fingerprint, its operating
  system, its VINAC Link version, when you linked it and when it was **last seen**. While a computer
  is linked and running, it updates "last seen" about every 15 minutes, so you (and your teammates,
  see below) can tell whether it is online.
- **Never:** message contents, request details, files, key or token values, your activity log, or any
  key that could decrypt your messages. Your computer's private keys never leave it.
- Your sign-in session is kept in your computer's own key store (or, in the Team console, in that
  browser tab only, until you close it or sign out).

You can unlink a computer or sign out at any time on its VINAC Link page. Unlinking deletes that
computer's record from your account. To **delete your account** and everything linked to it, write to
hello@vinac.tech from the email address on the account; we delete it within 30 days, and with it
your linked computers, your team memberships and the summaries you shared.

## The relay (optional)

When two computers can't reach each other directly, VINAC Link can pass their messages through a
relay instead. The relay works only between computers that were paired by their people **and** are
linked to the same account or to the accounts of members of the same team, and only after you turn
it on. Teammates' computers use a channel for that team that only its members can join.

**Pairing with a teammate over the internet.** From the list of your team's computers, you can ask
to pair with a teammate's computer. The request and the pairing messages go through that team's
channel. Both people must act (one sends the request, the other accepts it), both computers check
the other's key against the team's list of linked computers, and both people compare 6 digits on
their screens and press Allow. The pairing messages are protected by the same pairing method we use
on a local network; the service can't complete a pairing on its own.

What goes through the relay is the same sealed, end-to-end encrypted data your computers would
otherwise send directly. We can't read it. Our provider handles, and may briefly log, only what any
relay must: which of your linked computers a frame is from and to, what kind of frame it is (for
example a message or a receipt), its size and the time.

**The mailbox.** If the other computer isn't connected, your computer can leave the message in your
account's mailbox instead, so it arrives even if your computer is off by then. A mailbox item is
sealed on your computer with a key that only the two paired computers have; we can't read it. We
store the sealed item, which computers and accounts it is from and to, the team (if any) and the
times, for at most 7 days. The receiving computer deletes it when it collects it.

## Teams and the Team console (optional)

In the Team console (vinac.tech/console) you can create a team and invite people by email address.

- **Invitations:** we keep the email address you invite, its role and when it expires (14 days). The
  console doesn't email the person; you tell them to sign in with that address.
- **Inside a team,** members see each other's email addresses and display names, and the computers
  each member has linked (name, fingerprint, system, version and last seen). Don't join a team if you
  don't want its members to see that.
- **Activity summaries:** if you choose **Share summary**, your computer sends one month's activity
  as counts only, for example how many messages, requests, approvals and denials. Names of agents,
  keys and devices you talk to, and all contents, are left out. The summary is signed by your
  computer, so teammates can check it wasn't changed. Only that team's members can read it.

Leaving a team removes your membership and your shared summaries. When the owner deletes a team, its
members, invitations and summaries are deleted; each person's own account and computers stay.

## This website

- **No cookies, no tracking.** We use no analytics, advertising or tracking tools, and we set no
  cookies. If you switch between light and dark mode, your browser remembers that choice on your own
  device; it is never sent to us.
- **Server logs.** Like any website, our hosting provider automatically records basic technical
  information about requests (such as IP address, browser type, the page requested and the time) to
  keep the site running and secure. These logs are kept for a limited time and are not used to
  profile you.
- **Downloads.** Downloading VINAC Link is recorded in the same server logs. We don't ask who you are.

## The contact form and email

When you write to us through the contact form or by email, we receive your name, email address,
the topic you chose and your message. We use them **only to answer you** and to keep a record of our
conversation. Writing to us doesn't add you to our newsletter (only the newsletter form does), and
we don't sell, rent or share your details with anyone, except our email and hosting providers, who
process them on our behalf.

We keep messages for as long as needed to help you and for our normal business records, and then
delete them.

If you joined the relay waitlist, we keep your email address only to tell you about the relay, and
delete it on request or when the waitlist closes.

To stop spam, the form keeps a scrambled (hashed) version of the sender's internet address for up to
one hour, only to limit how many messages can be sent.

## The newsletter

If you subscribe (on the home page or in the bar at the bottom of every page), we keep your email
address, when you subscribed and the consent you gave, and use them only to send you VINAC Link
news a few times a year. We add you only when you tick the consent box yourself, as Canada's
anti-spam law (CASL) requires. Every newsletter has a way to unsubscribe, and you can also write to
hello@vinac.tech; we then remove your address promptly. We keep the record of your consent as long
as the law requires. The list is stored with our hosting provider; if we move it to a newsletter
service, that service processes it on our behalf only. The signup form uses the same spam
protection as the contact form.

## Supporting the project

The Support buttons take you to PayPal. PayPal processes the payment under its own privacy policy.
We receive the details PayPal shares with us (usually your name, email address and the amount) and
use them only for our records, as tax law requires, and to thank you. We don't add supporters to
the newsletter unless they subscribe themselves.

## Service providers

We use a small number of providers, who process data on our behalf and are bound to protect it:

| Provider | What for | Where |
|---|---|---|
| SiteGround | website hosting, the contact form, the newsletter list, our email | data centres they choose |
| Supabase | accounts, linked computers, the relay and teams | Canada (Central) |
| Resend | sending the sign-in code emails | United States |
| PayPal | contributions | under PayPal's own policy |

Information stored or handled outside Canada may be subject to the laws of that country.

## How long we keep it

- **Accounts, linked computers, teams and summaries:** until you unlink, leave, delete or ask us to
  delete them (see above). Our provider's backups may keep a copy for a short time after that.
- **Sign-in codes:** expire within an hour, and a new code cancels the previous one.
- **Relay frames:** not stored; our provider's technical logs are kept only briefly.
- **Mailbox items (sealed):** until the receiving computer collects them, and at most 7 days.
- **Contact messages, newsletter and contributions:** as described in their sections.

## Your choices and rights

You can ask us to access, correct or delete personal information we hold about you, or withdraw your
consent to our using it, by writing to **hello@vinac.tech**. We will answer within 30 days. If you
are not satisfied, you may contact the Office of the Privacy Commissioner of Canada. Where other
privacy laws give you additional rights (for example in the European Union or California), we will
honour them.

## Children

Our website and software are not directed at children under 13, and we do not knowingly collect
their information.

## Security

We protect the information we hold with reasonable safeguards. No method of storing or sending
information is perfectly secure. To report a security issue, see our [security page](/security.html).

## Changes

If we change this policy, we will post the new version here with a new effective date. Significant
changes will be noted on this page.

- **November 26, 2026 (VINAC Link 0.16):** the relay between teammates' computers (a channel per
  team), pairing with a teammate over the internet, and the mailbox for computers that aren't
  connected (sealed, at most 7 days).
- **November 23, 2026 (VINAC Link 0.13):** added optional accounts, linked computers and "last
  seen", the relay, teams and the Team console, shared rooms, our service providers for these, and
  how long we keep data.
- **November 22, 2026:** first version.

## Contact

Mexley Marketing Inc. · Ontario, Canada · **hello@vinac.tech**
