# Troubleshooting and FAQ

Start with `vinac doctor` (in the tester package: double-click **Check VINAC Link**).

## Problems

**"Could not reach … VINAC Link must be running there"**
The other computer's service isn't running or can't be reached. Start VINAC Link there; check
both are on the same network (or Tailscale); allow Node.js on private networks; office/hotel Wi-Fi
may block device-to-device traffic (use Tailscale). Messages and requests wait and go out by
themselves once it's reachable (up to 24 hours).

**A Mac shows its paired devices as offline, though they are on**
macOS blocks apps from the local network until you allow it: **System Settings → Privacy & Security
→ Local Network** → turn on VINAC Link, then quit and reopen it. Also check **Network → Firewall →
Options** allows incoming connections for VINAC Link.

**"… does not know the intent … yet"**
The other device has an older intent catalog. Update VINAC Link there, or send plain text.

**"… needs args.question (text)"**
That intent has required args; see the [catalog](../intents/catalog.md).

**My request never reached the other agent**
It's probably waiting for the other person (Firewall → Waiting for you) or blocked by their rules.
The sender only learns it was delivered, not what the firewall decided.

**The listening device hears nothing**
Check the microphone isn't muted (including hardware mute buttons), the page has microphone
permission, the volume is up and the devices are within a couple of metres. Or type the code.
Bluetooth speakers and microphone noise suppression are the usual cause: see
[Sound and speakers](sound.md).

**"Key store" errors**
VINAC Link refuses to keep keys in a plain file. macOS: allow Keychain access. Linux: install
`libsecret-tools` and run a keyring. Windows: DPAPI needs a normal user session.

**I updated and it still behaves the old way**
`vinac stop`; the new version starts with the next command or agent session. On macOS, opening the
new version updates a running older one by itself.

**macOS: it asks to "Install / Update" when I open it**
You opened VINAC Link from the disk image. Press **Install / Update**: it copies the app into
Applications (checking its signature first, keeping the old copy until the new one starts) and
runs it from there. Your keys, pairings and history stay as they are. You can eject the disk image
afterwards.

**macOS: it won't start, or says VINAC Link is not responding**
Run `vinac diagnose-startup` (Terminal, in the app's folder) to see what holds the ports; it changes
nothing. If a stuck VINAC Link is found, the app offers **Restart VINAC**, and **Force Stop** only as
a second, separate choice. Anything it can't verify as your VINAC Link is never stopped.

**A big file stops halfway ("Lost … after N of M parts")**
The other computer went away during the transfer. Send it again; unfinished parts are deleted after
an hour. **"… runs an older VINAC Link that only takes files up to 192 KB"**: update it there.

**`vinac git fetch` says the bundle "does not fit this repository"**
It was sent with `--since` and this repository doesn't have that starting commit. Ask for a full
branch (`vinac git send` without `--since`), or fetch the base first.

**`vinac run` waits and then says "No answer on the page in time"**
Open the page → **Secrets** and press **Approve this run** within 2 minutes.

**Auto-reply with a local model fails ("local model not reachable")**
Start Ollama (`ollama serve`) or LM Studio's local server, and check the address and model name on
the page (Ollama: `ollama list` shows the names).

**My small local model calls the wrong tools**
Connect it with `mcp --simple` (three tools only). See [connecting agents](agents.md#local-models-offline-agents).

**No network address / works only on one network**
Without a router, connect the two computers to the same hotspot or with a cable; see
[offline use](offline.md).

## FAQ

**Is there a server?** No. Devices talk directly. Delivery on a USB stick, and later an optional
relay, are on the roadmap; both would only ever carry sealed messages.

**Does it need the internet?** No. See [offline use](offline.md).

**What can an agent do on the other computer?** Only send it messages and requests. What happens
there is decided by that computer's person, rules and agent.

**Why sound?** It's quick when you're at both machines and shows the devices are near each other.
A typed code does the same job.

**Same identity for Claude Code and Codex on one computer?** Yes: one service per computer; every
agent app on it uses the same identity, pairings and firewall.

**Can I use it between two people?** Yes, pair your computer with theirs; each side keeps its own
firewall. Start strict (Plain messages → Ask me) until you trust the setup.
