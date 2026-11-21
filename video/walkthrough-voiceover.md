# VINAC Link walkthrough: voice-over script

Video: `site/media/walkthrough.mp4` (88 seconds), made from `video/walkthrough.html`.
About 190 words, read calmly (about 140 words a minute). Each line starts at the time shown;
it's fine to finish a second or two early. Never late: the next scene starts on time.

| Starts | On screen | Say |
|---|---|---|
| 0:00 | Title | This is VINAC Link: the secure link between the AI agents on your own computers. |
| 0:05 | Terminal: one-line install | Install it with one line in a terminal. Everything it needs is included, on Windows, Mac and Linux. |
| 0:13 | The VINAC Link window | It opens in its own window. No account, and no cloud. |
| 0:18 | Pair a device, sound rings | To connect a second computer, one plays a short sound and the other listens. No microphone? Type a short code instead. |
| 0:27 | The 6-digit code | Then you confirm a six-digit code on both screens. Only a person can pair a device, never an agent. |
| 0:36 | An agent asks the Mac | Now your agents can ask each other for help, across vendors: Claude Code, Codex, OpenClaw, or a local model. |
| 0:44 | The conversation | Every request says what it wants, and you can follow every conversation. |
| 0:52 | The firewall, Approve | Your firewall decides what gets through: allow it, ask you first, or block it. Here, a code review waits until I approve it. |
| 1:04 | Send a secret | API keys move straight from one computer's key store to the other. Your agents use them by name, but never see the value. |
| 1:13 | Overview | It works online or offline, over Wi‑Fi, a hotspot, or a cable. |
| 1:20 | End card | VINAC Link. Free and open source. Install it in one line, at vinac dot tech. |

## Current state: no voice

At the owner's request the published `site/media/walkthrough.mp4` has **no voice-over**: captions
carry the story, over the light generated music. The timing below (and `walkthrough-timing.js`)
still leaves room for a voice if one is added later.

## The AI voice that was tried

`site/media/walkthrough.mp4` carries an AI voice made offline with Piper 1.8.0
(github.com/OHF-Voice/piper1-gpl) and the voice **en_US-bryce-medium** (US male), whose
recordings are in the public domain (commercial use allowed, no conditions). For this voice a few
lines are worded a little shorter than the table above (for example "Meet Vinak Link: the secure
link between your AI agents."); `make_voice.py` holds the exact text. Each line was generated on its own,
placed at its start time above, and mixed with a soft ambient pad generated from scratch
(`make_music.py`, no third-party rights) that sits about 15 dB under the voice and dips further
while it speaks; the whole mix is loudness-normalised to -16 LUFS. "VINAC" is spelled "Vinak" in
the text given to the voice, for pronunciation. The scripts and voices live outside the repo, in
`D:\Claude Code\scratch\piper` (`make_voice.py <voice>`, `make_music.py`). Other voices tried,
all public domain or CC0: en_US-ljspeech-high, en_GB-cori-high, en_US-joe-medium. To swap in a
recorded human voice, use the steps below.

## Recording it

1. A quiet room with soft things around (a closet full of clothes works well). Phone or USB mic,
   about a hand's width from your mouth, slightly to the side.
2. Play the video on mute and read along with it, so the timing matches. Do it 2–3 times and keep
   the best take. Small pauses between lines are good.
3. Save it as `walkthrough-voice.m4a` (or .wav/.mp3) and put it in `D:\Shares\MacShare` or this
   folder. It's then mixed onto the video, with the levels evened out:

```
ffmpeg -i site/media/walkthrough.mp4 -i walkthrough-voice.m4a -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -af "loudnorm=I=-16:TP=-1.5:LRA=11,apad" -shortest site/media/walkthrough-voice.mp4
```
