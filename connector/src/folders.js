// Picking a project folder from the page (0.15). A browser can't hand a web page a full folder
// path, so the service (running on the same computer, as the same person) does it:
//  - pickFolder(): the system's own folder dialog (Windows Forms, macOS `choose folder`, zenity or
//    kdialog on Linux); returns the chosen path or null if the person cancelled
//  - listFolder(): one folder's subfolders, for the page's own folder browser when no dialog works
//  - folderFacts(): what the page shows under the field (exists, git branch, vinac.keys.json)
// Only the page calls these (its token); agents have no route to them. Names only, never contents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PROMPT = 'Choose the project folder for VINAC Link';
const WIN_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = "Minimized" }',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.Description = $env:VINAC_PICK_PROMPT',
  '$d.ShowNewFolderButton = $true',
  'if ($env:VINAC_PICK_START -and (Test-Path -LiteralPath $env:VINAC_PICK_START)) { $d.SelectedPath = $env:VINAC_PICK_START }',
  'if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
].join('; ');

function which(cmd) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(dir, cmd);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ }
  }
  return null;
}

/** The command that shows a folder dialog here, or null (then the page uses its own browser). */
export function pickerCommand({ platform = process.platform, start = os.homedir() } = {}) {
  const env = { ...process.env, VINAC_PICK_PROMPT: PROMPT, VINAC_PICK_START: start };
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')], env };
  if (platform === 'darwin') return { file: '/usr/bin/osascript', args: ['-e', 'POSIX path of (choose folder with prompt (system attribute "VINAC_PICK_PROMPT"))'], env };
  const zenity = which('zenity');
  if (zenity) return { file: zenity, args: ['--file-selection', '--directory', `--title=${PROMPT}`, `--filename=${start.replace(/\/?$/, '/')}`], env };
  const kdialog = which('kdialog');
  if (kdialog) return { file: kdialog, args: ['--getexistingdirectory', start, '--title', PROMPT], env };
  return null;
}

/** Shows the dialog and waits (up to 5 minutes). Resolves { path } / { cancelled } / { unavailable }. */
export function pickFolder({ platform = process.platform, start, run = execFile } = {}) {
  const cmd = pickerCommand({ platform, start: start && fs.existsSync(start) ? start : os.homedir() });
  if (!cmd) return Promise.resolve({ unavailable: true });
  return new Promise(resolve => {
    run(cmd.file, cmd.args, { env: cmd.env, timeout: 5 * 60_000, windowsHide: false, encoding: 'utf8', maxBuffer: 64 * 1024 }, (err, stdout) => {
      const p = String(stdout || '').trim().replace(/[\\/]+$/, '') || (String(stdout || '').trim() === '/' ? '/' : '');
      if (p && path.isAbsolute(p) && fs.existsSync(p)) return resolve({ path: path.resolve(p) });
      if (err && (err.code === 'ENOENT' || err.killed)) return resolve({ unavailable: true });
      resolve({ cancelled: true });
    });
  });
}

/** Subfolders of `dir` (default: home), hidden ones left out, at most 400, sorted. */
export function listFolder(dir) {
  const d = path.resolve(dir && path.isAbsolute(String(dir)) ? String(dir) : os.homedir());
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { throw Object.assign(new Error(`Can't open ${d} (${e.code || e.message}).`), { status: 400 }); }
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !/^(node_modules|\$RECYCLE\.BIN|System Volume Information)$/i.test(e.name))
    .map(e => e.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).slice(0, 400);
  const parent = path.dirname(d);
  return { path: d, parent: parent !== d ? parent : null, home: os.homedir(), roots: process.platform === 'win32' ? winDrives() : ['/'], dirs, ...folderFacts(d) };
}

function winDrives() {
  const out = [];
  for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { fs.accessSync(`${l}:\\`); out.push(`${l}:\\`); } catch { /* none */ } }
  return out;
}

/** What the page shows under a chosen folder: exists, a git repository (and its branch), vinac.keys.json. */
export function folderFacts(dir) {
  const d = String(dir || '');
  if (!d || !path.isAbsolute(d)) return { exists: false };
  let stat; try { stat = fs.statSync(d); } catch { return { exists: false }; }
  if (!stat.isDirectory()) return { exists: false };
  let branch = null;
  try {
    const head = fs.readFileSync(path.join(d, '.git', 'HEAD'), 'utf8').trim();
    branch = head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 12);
  } catch { /* not a git repository (or a worktree file) */ }
  const git = branch !== null || fs.existsSync(path.join(d, '.git'));
  return { exists: true, name: path.basename(d) || d, git, ...(branch ? { branch } : {}), manifest: fs.existsSync(path.join(d, 'vinac.keys.json')) };
}
