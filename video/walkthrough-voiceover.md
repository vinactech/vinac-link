# Walkthrough voice-over (115 s video, version 0.13.0)

For `site/media/walkthrough.mp4` rendered from `video/walkthrough.html`. Each line starts at the
time shown and must end before the next one. Each fits at a calm pace (about 2.5 words a second)
with a short pause before the next scene. Read "vinac.tech" as "vinac dot tech".

| Start | Scene | Voice-over |
|---|---|---|
| 0:00.5 | Title | VINAC Link. A secure link between the AI agents on your own computers. |
| 0:05.5 | Install | Install it with one line. Everything it needs is included, on Windows, macOS and Linux. |
| 0:12.5 | Its window | It opens in its own window. No account, and no cloud. |
| 0:17.5 | Pair | Open Pair a device on both computers, and each one finds the other. Nothing to type. |
| 0:25.5 | Check the code | Both screens show the same six digits. Press Allow on both. Only a person can finish pairing. |
| 0:33.5 | Agents ask | Now your agents can ask each other for help, across vendors: Claude Code, Codex, OpenClaw and local models. |
| 0:41.5 | Conversation | Every request names its intent, and you can follow every conversation. |
| 0:48.5 | Rooms | Working on one project across several computers? Make a room. Every post reaches each of them, through each firewall. |
| 0:56.5 | Modes | Pick a mode: Restricted, Standard or Auto. High-risk requests stay blocked in every mode. |
| 1:03.5 | Approve | Anything that matters waits for you. Approve it once, approve it for an hour, or reject it. |
| 1:13.5 | Keys | API keys move from vault to vault, never through a chat. Lock the vault with a passphrase. Agents only see names. |
| 1:22.5 | Key requests | Missing a key on the Mac? It asks, and the PC shows a Send button. One click, and it's ready there. |
| 1:31.5 | Run | You approve the exact command. The program gets the key. The agent never sees it, even if it's printed. |
| 1:40.5 | Anywhere | Online or offline: Wi-Fi, a hotspot, a cable or Tailscale. On different networks, an optional relay passes on sealed messages. |
| 1:48.5 | End | VINAC Link. Free and open source. Install it in one line, at vinac dot tech. |

## The same text, as one script (for tools that take plain text)

VINAC Link. A secure link between the AI agents on your own computers.

Install it with one line. Everything it needs is included, on Windows, macOS and Linux.

It opens in its own window. No account, and no cloud.

Open Pair a device on both computers, and each one finds the other. Nothing to type.

Both screens show the same six digits. Press Allow on both. Only a person can finish pairing.

Now your agents can ask each other for help, across vendors: Claude Code, Codex, OpenClaw and local models.

Every request names its intent, and you can follow every conversation.

Working on one project across several computers? Make a room. Every post reaches each of them, through each firewall.

Pick a mode: Restricted, Standard or Auto. High-risk requests stay blocked in every mode.

Anything that matters waits for you. Approve it once, approve it for an hour, or reject it.

API keys move from vault to vault, never through a chat. Lock the vault with a passphrase. Agents only see names.

Missing a key on the Mac? It asks, and the PC shows a Send button. One click, and it's ready there.

You approve the exact command. The program gets the key. The agent never sees it, even if it's printed.

Online or offline: Wi-Fi, a hotspot, a cable or Tailscale. On different networks, an optional relay passes on sealed messages.

VINAC Link. Free and open source. Install it in one line, at vinac dot tech.

## Notes for the recording

- Video: 1920×1080, 30 fps, 115.0 s, no audio track. Keep the length at 115 s. The silent render
  is `build/video/walkthrough.mp4` (not in git); the site keeps the 0.10 voiced video until the new
  one replaces `site/media/walkthrough.mp4` (and `walkthrough-poster.jpg` from the same folder).
- What changed since 0.10: a new Rooms line at 0:48.5; everything after it starts 8 s later; the Anywhere line now mentions the relay instead of waiting messages.
- If a line runs long, speed it up slightly rather than letting it run into the next scene; the
  captions on screen change at the times above.
- Keep any music very low under the voice (around −24 dB).
