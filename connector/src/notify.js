// Wake-up and desktop notifications (0.14 step 1).
//  - Settings the person sets on the page (agent tools have no route): desktop notifications on/off,
//    waking idle agents on/off, and how many wake-ups per hour a session may get.
//  - Desktop notifications from the service: device name + kind only, never message text.
//    Windows: a toast through PowerShell's WinRT bindings; macOS: osascript; Linux: notify-send.
//    Texts reach the helper through environment variables, never through the command line or a script.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { writeAtomic } from './store.js';

export const NOTIFY_DEFAULTS = { desktop: true, wakeAgents: true, wakesPerHour: 12 };
const GAP_MS = 8000;            // at most one desktop notification per 8 s; later ones are summed

/** A short plain label (device or room name chosen on another device). */
export const plainName = n => (String(n ?? '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._'()-]/gu, '').replace(/ +/g, ' ').trim().slice(0, 32) || 'a paired device');

export function readNotifySettings(home) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(home, 'notify.json'), 'utf8')) || {}; } catch { /* defaults */ }
  return {
    desktop: typeof s.desktop === 'boolean' ? s.desktop : NOTIFY_DEFAULTS.desktop,
    wakeAgents: typeof s.wakeAgents === 'boolean' ? s.wakeAgents : NOTIFY_DEFAULTS.wakeAgents,
    wakesPerHour: Number.isInteger(s.wakesPerHour) && s.wakesPerHour >= 1 && s.wakesPerHour <= 60 ? s.wakesPerHour : NOTIFY_DEFAULTS.wakesPerHour,
  };
}

/** The page changes these (validated); returns the new settings. */
export function writeNotifySettings(home, body) {
  const s = readNotifySettings(home);
  if (body.desktop != null) { if (typeof body.desktop !== 'boolean') throw Object.assign(new Error('BAD_FIELD'), { status: 400 }); s.desktop = body.desktop; }
  if (body.wakeAgents != null) { if (typeof body.wakeAgents !== 'boolean') throw Object.assign(new Error('BAD_FIELD'), { status: 400 }); s.wakeAgents = body.wakeAgents; }
  if (body.wakesPerHour != null) {
    const n = Number(body.wakesPerHour);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw Object.assign(new Error('Wake-ups per hour: 1 to 60.'), { status: 400 });
    s.wakesPerHour = n;
  }
  writeAtomic(path.join(home, 'notify.json'), JSON.stringify(s, null, 1));
  return s;
}

/** What one incoming item says in a notification (no text, no args). */
export function describe(m) {
  const from = plainName(m.peer?.name);
  if (m.firewall?.status === 'pending') return { title: 'Waiting for your approval', body: `A request from ${from} waits on the VINAC Link page.` };
  if (m.intent === 'agent.room.post') return { title: `Room: ${plainName(m.args?.name || 'Room')}`, body: `New post from ${from}.` };
  if (m.kind === 'secret') return { title: 'VINAC Link', body: `Key update from ${from}.` };
  if (m.intent) return { title: 'VINAC Link', body: `New request from ${from}.` };
  return { title: 'VINAC Link', body: `New message from ${from}.` };
}

// Windows toast: the AppUserModelID of Windows PowerShell is always registered, so the toast shows.
const WIN_SCRIPT = [
  '$ErrorActionPreference="Stop"',
  '[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]',
  '[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]',
  '$x=New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$x.LoadXml("<toast><visual><binding template=""ToastGeneric""><text/><text/></binding></visual></toast>")',
  '$t=$x.GetElementsByTagName("text")',
  '[void]$t.Item(0).AppendChild($x.CreateTextNode($env:VINAC_N_TITLE))',
  '[void]$t.Item(1).AppendChild($x.CreateTextNode($env:VINAC_N_BODY))',
  '$id="{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))',
].join(';');

/** Shows one desktop notification; never throws (a missing helper only means no notification). */
export function showDesktop({ title, body }, { platform = process.platform, run = execFile } = {}) {
  const env = { ...process.env, VINAC_N_TITLE: String(title).slice(0, 80), VINAC_N_BODY: String(body).slice(0, 200) };
  const done = () => {};
  try {
    if (platform === 'win32') {
      const encoded = Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64');
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { env, windowsHide: true, timeout: 15000 }, done);
    } else if (platform === 'darwin') {
      run('/usr/bin/osascript', ['-e', 'display notification (system attribute "VINAC_N_BODY") with title (system attribute "VINAC_N_TITLE")'], { env, timeout: 15000 }, done);
    } else {
      run('notify-send', ['--app-name=VINAC Link', env.VINAC_N_TITLE, env.VINAC_N_BODY], { env, timeout: 15000 }, done);
    }
    return true;
  } catch { return false; }
}

/**
 * Collects incoming items and shows at most one notification per GAP_MS (a burst becomes
 * "3 new items from Mac"). Off in tests (node --test) and with VINAC_NO_NOTIFY=1.
 */
export class Notifier {
  constructor({ home, show = showDesktop, enabled } = {}) {
    this.home = home; this.show = show;
    this.enabled = enabled ?? !(process.env.VINAC_NO_NOTIFY === '1' || process.env.NODE_TEST_CONTEXT);
    this.pending = []; this.timer = null; this.lastAt = 0; this.gapMs = GAP_MS;
  }
  incoming(m) {
    if (!this.enabled || m?.dir !== 'in') return;
    if (!readNotifySettings(this.home).desktop) return;
    this.pending.push(describe(m));
    if (this.timer) return;
    const wait = Math.max(0, this.lastAt + this.gapMs - Date.now());
    this.timer = setTimeout(() => this.flush(), wait);
    this.timer.unref?.();
  }
  flush() {
    this.timer = null;
    const items = this.pending.splice(0);
    if (!items.length) return;
    this.lastAt = Date.now();
    this.show(items.length === 1 ? items[0] : { title: 'VINAC Link', body: `${items.length} new items. Open VINAC Link to see them.` });
  }
  stop() { clearTimeout(this.timer); this.timer = null; this.pending = []; }
}
