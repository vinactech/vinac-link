#!/usr/bin/env node
// Builds the VINAC Link installers, each with its own Node.js, into build/installers/out/:
//   Windows  VINAC-Link-Setup-<v>.exe            Inno Setup, per-user install, no admin rights
//   macOS    VINAC-Link-<v>-mac-builder.tar.gz   "VINAC Link.app" + make-dmg.sh: run that on a Mac
//                                               to get VINAC-Link-<v>.dmg (hdiutil only exists on macOS)
//   Linux    VINAC-Link-<v>-linux-x64.tar.gz     with install.sh (menu entry + the vinac command)
// Not signed yet: Windows SmartScreen and macOS Gatekeeper will warn until code signing is added.
//   node connector/tools/installers/build-installers.mjs [--only win,mac,linux]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchRuntimes, RUNTIMES, RUNTIME_DIR, NODE_VERSION } from './fetch-runtimes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const V = pkg.version;
const BUILD = path.join(ROOT, 'build', 'installers');
const OUT = path.join(BUILD, 'out');
const onlyArg = process.argv.indexOf('--only');
const ONLY = new Set(onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : ['win', 'mac', 'linux']);
const EXEC = /\.(command|sh)$|(^|\/)vinac$|(^|\/)bin\/node$|MacOS\/[^/]+$/;

// ---- what goes in: the same files as the tester package ------------------------------
function appFiles() {
  const excluded = pkg.files.filter(f => f.startsWith('!')).map(f => f.slice(1));
  const entries = new Map(); // relative path -> absolute source
  const add = rel => {
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) add(path.posix.join(rel, f)); return; }
    if (excluded.includes(rel) || /(^|\/)(node_modules|\.DS_Store|Thumbs\.db)/.test(rel)) return;
    entries.set(rel, abs);
  };
  for (const f of pkg.files.filter(f => !f.startsWith('!'))) add(f);
  for (const f of fs.readdirSync(path.join(ROOT, 'kit'))) entries.set(f, path.join(ROOT, 'kit', f));
  entries.set('package.json', path.join(ROOT, 'package.json'));
  return entries;
}
/** Text files get the line endings their platform expects (Windows scripts CRLF, shell scripts LF). */
function content(rel, abs) {
  let data = fs.readFileSync(abs);
  if (/\.(cmd|bat)$/i.test(rel)) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n'));
  else if (EXEC.test(rel) && !/node$/.test(rel)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
  if (path.basename(rel) === 'START-HERE.html') data = Buffer.from(data.toString('utf8').replaceAll('__VERSION__', V));
  return data;
}

// ---- small archive and icon writers (no dependencies) -------------------------------------
/** tar.gz with Unix permissions, so scripts and node stay executable on macOS and Linux. */
function targz(files, out) { // files: [{ name, data, mode? }]
  const blocks = [];
  const field = (buf, off, len, value) => buf.write(value, off, len, 'utf8');
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  const dirs = new Set();
  for (const f of files) { const parts = f.name.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/'); }
  const header = (name, size, mode, type) => {
    const h = Buffer.alloc(512);
    let prefix = '';
    if (Buffer.byteLength(name) > 100) { // ustar: split at a "/" so that prefix <= 155 and name <= 100 bytes
      const cut = [...name.matchAll(/\//g)].map(m => m.index).find(i => i > 0 && i < name.length - 1 && Buffer.byteLength(name.slice(0, i)) <= 155 && Buffer.byteLength(name.slice(i + 1)) <= 100);
      if (cut === undefined) throw new Error(`path too long for tar: ${name}`);
      prefix = name.slice(0, cut); name = name.slice(cut + 1);
    }
    field(h, 0, 100, name); field(h, 100, 8, octal(mode, 8)); field(h, 108, 8, octal(0, 8)); field(h, 116, 8, octal(0, 8));
    field(h, 124, 12, octal(size, 12)); field(h, 136, 12, octal(Math.floor(Date.now() / 1000), 12));
    h.fill(' ', 148, 156); h[156] = type.charCodeAt(0); field(h, 257, 6, 'ustar\0'); field(h, 263, 2, '00');
    field(h, 265, 32, 'vinac'); field(h, 297, 32, 'vinac'); field(h, 345, 155, prefix);
    let sum = 0; for (const b of h) sum += b; field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    return h;
  };
  for (const d of [...dirs].sort()) blocks.push(header(d, 0, 0o755, '5'));
  for (const f of files) {
    blocks.push(header(f.name, f.data.length, f.mode ?? (EXEC.test(f.name) ? 0o755 : 0o644), '0'), f.data);
    const pad = (512 - (f.data.length % 512)) % 512; if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  fs.writeFileSync(out, zlib.gzipSync(Buffer.concat(blocks), { level: 9 }));
}
/** .ico with PNG images inside (Windows Vista and later). */
function ico(pngs) { // [{ size, data }]
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.data)]);
}
/** .icns with PNG images inside (macOS 10.7 and later). */
function icns(pngs) { // [{ type, data }]
  const parts = pngs.map(({ type, data }) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4); return Buffer.concat([h, data]); });
  const total = 8 + parts.reduce((n, p) => n + p.length, 0);
  const h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(total, 4);
  return Buffer.concat([h, ...parts]);
}
const icon = name => fs.readFileSync(path.join(HERE, 'icons', name));

/** Pulls one file out of a Node.js archive with the system tar (bsdtar reads zip, gz and xz). */
function extractNode(archive, inner, dest) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-node-'));
  const r = spawnSync('tar', ['-xf', path.join(RUNTIME_DIR, archive), '-C', tmp, inner], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not extract ${inner} from ${archive}: ${r.stderr}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(tmp, inner), dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return dest;
}
const nodeDir = archive => archive.replace(/\.(zip|tar\.gz|tar\.xz)$/, '');

// ---- Windows ----------------------------------------------------------------------------
function buildWindows(files) {
  const stage = path.join(BUILD, 'win', 'app');
  fs.rmSync(path.join(BUILD, 'win'), { recursive: true, force: true });
  for (const [rel, abs] of files) { const d = path.join(stage, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, content(rel, abs)); }
  for (const rel of ['vinac', 'Start VINAC Link.command', 'Stop VINAC Link.command', 'Check VINAC Link.command', 'Connect my agent.command', 'start-linux.sh']) fs.rmSync(path.join(stage, rel), { force: true });
  extractNode(RUNTIMES.win, `${nodeDir(RUNTIMES.win)}/node.exe`, path.join(stage, 'node', 'node.exe'));
  fs.writeFileSync(path.join(stage, 'vinac.ico'), ico([256, 48, 32, 16].map(size => ({ size, data: icon(`win-${size}.png`) }))));
  const iss = path.join(BUILD, 'win', 'vinac-link.iss');
  fs.writeFileSync(iss, innoScript(stage));
  const iscc = [process.env.ISCC, path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'), 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe', 'C:/Program Files/Inno Setup 6/ISCC.exe'].filter(Boolean).find(p => fs.existsSync(p));
  if (!iscc) throw new Error('Inno Setup 6 (ISCC.exe) not found: winget install JRSoftware.InnoSetup');
  const r = spawnSync(iscc, ['/Q', iss], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Inno Setup failed:\n${r.stdout}\n${r.stderr}`);
  return path.join(OUT, `VINAC-Link-Setup-${V}.exe`);
}

function innoScript(stage) {
  const run = (args) => `Filename: "{app}\\node\\node.exe"; Parameters: """{app}\\connector\\bin\\vinac.mjs"" ${args}"; WorkingDir: "{app}"`;
  return `; Generated by connector/tools/installers/build-installers.mjs
[Setup]
AppId={{6F1C2B7E-4E0D-4C55-9B7A-3D2E1F0A9C11}
AppName=VINAC Link
AppVersion=${V}
AppVerName=VINAC Link ${V}
AppPublisher=Mexley Marketing Inc.
AppPublisherURL=https://vinac.tech
AppSupportURL=https://vinac.tech/#contact
AppCopyright=Copyright 2026 Mexley Marketing Inc.
VersionInfoVersion=${V}.0
DefaultDirName={localappdata}\\Programs\\VINAC Link
DefaultGroupName=VINAC Link
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=${OUT}
OutputBaseFilename=VINAC-Link-Setup-${V}
SetupIconFile=${path.join(stage, 'vinac.ico')}
UninstallDisplayIcon={app}\\vinac.ico
UninstallDisplayName=VINAC Link
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
CloseApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
Name: "addtopath"; Description: "Add the vinac command (and its Node.js) to my PATH, for agent apps and the terminal"

[Files]
Source: "${stage}\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\\VINAC Link"; ${run('start')}; IconFilename: "{app}\\vinac.ico"; Comment: "Start VINAC Link and open its page"
Name: "{group}\\Connect my agent"; Filename: "{app}\\Connect my agent.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\\vinac.ico"
Name: "{group}\\Check VINAC Link"; Filename: "{app}\\Check VINAC Link.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\\vinac.ico"
Name: "{group}\\Stop VINAC Link"; Filename: "{app}\\Stop VINAC Link.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\\vinac.ico"
Name: "{group}\\Read me first"; Filename: "{app}\\START-HERE.html"
Name: "{group}\\Uninstall VINAC Link"; Filename: "{uninstallexe}"
Name: "{autodesktop}\\VINAC Link"; ${run('start')}; IconFilename: "{app}\\vinac.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app};{app}\\node"; Check: NeedsAddPath(ExpandConstant('{app}')); Tasks: addtopath

[Run]
${run('start')}; Description: "Start VINAC Link now"; Flags: postinstall nowait skipifsilent runminimized

[UninstallRun]
${run('stop')}; Flags: runhidden; RunOnceId: "StopVinacLink"

[Messages]
FinishedLabel=VINAC Link is installed. Start it from the Start menu; its page opens in your browser. If Windows asks whether Node.js may use the network, choose Private networks and Allow.

[Code]
function NeedsAddPath(Dir: string): Boolean;
var Current: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Current) then begin Result := True; exit; end;
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Current) + ';') = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  { An upgrade: stop the running service first, so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\\node\\node.exe')) then
    Exec(ExpandConstant('{app}\\node\\node.exe'), '"' + ExpandConstant('{app}\\connector\\bin\\vinac.mjs') + '" stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Current: string;
begin
  if (CurUninstallStep = usPostUninstall) and RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Current) then
  begin
    StringChangeEx(Current, ';' + ExpandConstant('{app}') + ';' + ExpandConstant('{app}\\node'), '', True);
    RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Current);
  end;
end;
`;
}

// ---- macOS --------------------------------------------------------------------------------
function buildMac(files) {
  const app = 'VINAC Link.app/Contents';
  const out = [];
  for (const [rel, abs] of files) if (!/\.cmd$/i.test(rel) && rel !== 'start-linux.sh') out.push({ name: `${app}/Resources/${rel}`, data: content(rel, abs) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-mac-'));
  for (const [arch, archive] of [['arm64', RUNTIMES.macArm], ['x64', RUNTIMES.macIntel]]) {
    const f = extractNode(archive, `${nodeDir(archive)}/bin/node`, path.join(tmp, arch, 'node'));
    out.push({ name: `${app}/Resources/node/${arch}/bin/node`, data: fs.readFileSync(f), mode: 0o755 });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  out.push({ name: `${app}/Resources/vinac.icns`, data: icns([['ic10', 'mac-1024.png'], ['ic09', 'mac-512.png'], ['ic08', 'mac-256.png'], ['ic07', 'mac-128.png']].map(([type, f]) => ({ type, data: icon(f) }))) });
  out.push({ name: `${app}/Info.plist`, data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>VINAC Link</string>
  <key>CFBundleDisplayName</key><string>VINAC Link</string>
  <key>CFBundleIdentifier</key><string>tech.vinac.link</string>
  <key>CFBundleVersion</key><string>${V}</string>
  <key>CFBundleShortVersionString</key><string>${V}</string>
  <key>CFBundleExecutable</key><string>VINAC Link</string>
  <key>LSArchitecturePriority</key>
  <array><string>arm64</string><string>x86_64</string></array>
  <key>NSLocalNetworkUsageDescription</key><string>VINAC Link connects directly to the computers you paired with on your network, so your AI agents can exchange encrypted messages, requests and keys.</string>
  <key>CFBundleIconFile</key><string>vinac.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.5</string>
  <key>NSHumanReadableCopyright</key><string>Copyright 2026 Mexley Marketing Inc.</string>
</dict>
</plist>
`) });
  out.push({ name: `${app}/MacOS/VINAC Link`, mode: 0o755, data: Buffer.from(`#!/bin/bash
# Starts VINAC Link in the background and opens its page; the service keeps running after this exits.
R="$(cd "$(dirname "$0")/../Resources" && pwd)"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH=x64
if ! "$R/node/$ARCH/bin/node" "$R/connector/bin/vinac.mjs" start; then
  osascript -e 'display alert "VINAC Link could not start" message "Open VINAC Link.app > Show Package Contents > Contents > Resources and double-click Check VINAC Link.command, or write to hello@vinac.tech."'
fi
`) });
  out.push({ name: 'make-dmg.sh', mode: 0o755, data: Buffer.from(`#!/bin/bash
# Run this on a Mac (in Terminal: sh make-dmg.sh) to make VINAC-Link-${V}.dmg next to it.
# This signs the app ad hoc (not notarized), so on other Macs people must allow it once in
# System Settings > Privacy & Security, unless it is then signed with a Developer ID and notarized
# (as 0.8.0 was on the owner's Mac; see MAC-BUILD instructions). Ad hoc builds: allow it once in
# System Settings > Privacy & Security > Open Anyway, until Apple Developer signing is added.
set -e
cd "$(dirname "$0")"
xattr -cr "VINAC Link.app" 2>/dev/null || true
codesign --force --sign - "VINAC Link.app" 2>/dev/null || codesign --force --deep --sign - "VINAC Link.app"
rm -rf dmg-stage && mkdir dmg-stage
cp -R "VINAC Link.app" dmg-stage/
ln -s /Applications dmg-stage/Applications
# Size the image explicitly (the app plus room to spare): hdiutil's own estimate can run out of space.
MB=$(( $(du -sm dmg-stage | cut -f1) * 3 / 2 + 64 ))
hdiutil create -size "\${MB}m" -volname "VINAC Link" -srcfolder dmg-stage -ov -format UDZO "VINAC-Link-${V}.dmg"
rm -rf dmg-stage
echo
echo "Made VINAC-Link-${V}.dmg. Copy it to the PC into build/installers/out/ (or upload it to the site's download folder)."
`) });
  const file = path.join(OUT, `VINAC-Link-${V}-mac-builder.tar.gz`);
  targz(out, file);
  return file;
}

// ---- Linux --------------------------------------------------------------------------------
function buildLinux(files) {
  const top = `vinac-link-${V}`;
  const out = [];
  for (const [rel, abs] of files) if (!/\.(cmd|command)$/i.test(rel)) out.push({ name: `${top}/${rel}`, data: content(rel, abs) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-linux-'));
  const f = extractNode(RUNTIMES.linux, `${nodeDir(RUNTIMES.linux)}/bin/node`, path.join(tmp, 'node'));
  out.push({ name: `${top}/node/bin/node`, data: fs.readFileSync(f), mode: 0o755 });
  fs.rmSync(tmp, { recursive: true, force: true });
  out.push({ name: `${top}/vinac.png`, data: icon('win-256.png') });
  out.push({ name: `${top}/install.sh`, mode: 0o755, data: Buffer.from(`#!/bin/sh
# Installs VINAC Link for this user (no sudo): ~/.local/share/vinac-link, a menu entry, and the
# vinac command in ~/.local/bin. Run: sh install.sh
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/vinac-link"
[ -x "$DEST/node/bin/node" ] && "$DEST/node/bin/node" "$DEST/connector/bin/vinac.mjs" stop >/dev/null 2>&1 || true
rm -rf "$DEST"; mkdir -p "$DEST"; cp -R "$SRC/." "$DEST/"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
ln -sf "$DEST/vinac" "$HOME/.local/bin/vinac"
cp "$DEST/vinac.png" "$HOME/.local/share/icons/hicolor/256x256/apps/vinac-link.png"
cat > "$HOME/.local/share/applications/vinac-link.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=VINAC Link
Comment=A secure link between your AI agents
Exec="$DEST/node/bin/node" "$DEST/connector/bin/vinac.mjs" start
Icon=vinac-link
Terminal=false
Categories=Network;Utility;
EOF
echo "VINAC Link ${V} is installed. Start it from your app menu, or run: vinac start"
command -v secret-tool >/dev/null 2>&1 || echo "Note: install libsecret-tools (Debian/Ubuntu: sudo apt install libsecret-tools) so VINAC Link can keep keys in your keyring."
`) });
  out.push({ name: `${top}/uninstall.sh`, mode: 0o755, data: Buffer.from(`#!/bin/sh
# Removes VINAC Link for this user. Your pairings and history in ~/.vinac stay (delete that folder too to remove them).
DEST="$HOME/.local/share/vinac-link"
[ -x "$DEST/node/bin/node" ] && "$DEST/node/bin/node" "$DEST/connector/bin/vinac.mjs" stop >/dev/null 2>&1 || true
rm -rf "$DEST" "$HOME/.local/bin/vinac" "$HOME/.local/share/applications/vinac-link.desktop" "$HOME/.local/share/icons/hicolor/256x256/apps/vinac-link.png"
echo "VINAC Link was removed."
`) });
  const file = path.join(OUT, `VINAC-Link-${V}-linux-x64.tar.gz`);
  targz(out, file);
  return file;
}

// ---- main --------------------------------------------------------------------------------
console.log(`VINAC Link ${V} installers, with Node.js ${NODE_VERSION}`);
await fetchRuntimes(() => {});
fs.mkdirSync(OUT, { recursive: true });
const files = appFiles();
const made = [];
if (ONLY.has('win')) made.push(buildWindows(files));
if (ONLY.has('mac')) made.push(buildMac(files));
if (ONLY.has('linux')) made.push(buildLinux(files));
for (const f of made) console.log(`  ${path.relative(ROOT, f)}  (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`);
const dmg = path.join(OUT, `VINAC-Link-${V}.dmg`);
console.log(fs.existsSync(dmg) ? `  ${path.relative(ROOT, dmg)}  (made on a Mac)` : '  Mac .dmg: copy the mac-builder file to a Mac and run sh make-dmg.sh there');
