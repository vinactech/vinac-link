#!/usr/bin/env node
// Builds the ready-to-go package for testers: dist/vinac-link-<version>.zip
// (one folder with the program, start/stop/check scripts for Windows, macOS and
// Linux, START-HERE.html, and the docs), plus dist/SHA256SUMS.txt.
// Needs nothing but Node: no npm install, and the package needs none either.
//
//   node connector/tools/make-kit.mjs [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'dist'));
const NAME = `vinac-link-${pkg.version}`;
const EXEC = /\.(command|sh)$|^vinac$/;

// ---- what goes in: the npm package's files, plus the kit folder -----------------
const excluded = pkg.files.filter(f => f.startsWith('!')).map(f => f.slice(1).replaceAll('\\', '/'));
const entries = new Map(); // path inside the zip -> absolute source path
function addPath(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing: ${rel}`);
  if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) addPath(path.posix.join(rel, f)); return; }
  if (excluded.includes(rel) || /(^|\/)(node_modules|\.DS_Store|Thumbs\.db)/.test(rel)) return;
  entries.set(rel, abs);
}
for (const f of pkg.files.filter(f => !f.startsWith('!'))) addPath(f);
for (const f of fs.readdirSync(path.join(ROOT, 'kit'))) entries.set(f, path.join(ROOT, 'kit', f));
entries.set('package.json', path.join(ROOT, 'package.json'));

function contentOf(rel, abs) {
  let data = fs.readFileSync(abs);
  if (/\.(cmd|bat)$/i.test(rel)) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n'));           // Windows scripts: CRLF
  else if (EXEC.test(path.basename(rel))) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));   // shell scripts: LF
  if (rel === 'START-HERE.html') data = Buffer.from(data.toString('utf8').replaceAll('__VERSION__', pkg.version));
  return data;
}

// ---- a small zip writer (deflate, Unix modes so the Mac scripts stay executable) ----
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const { name, data, mode } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
    c.writeUInt32LE((mode << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

const files = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([rel, abs]) => ({
  name: `${NAME}/${rel}`,
  data: contentOf(rel, abs),
  mode: EXEC.test(path.basename(rel)) ? 0o100755 : 0o100644,
}));
fs.mkdirSync(OUT, { recursive: true });
const zipFile = path.join(OUT, `${NAME}.zip`);
const bytes = zip(files);
fs.writeFileSync(zipFile, bytes);
const hash = createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), `${hash}  ${NAME}.zip\n`);
console.log(`${zipFile}\n  ${files.length} files, ${(bytes.length / 1024).toFixed(0)} KB\n  sha256 ${hash}`);
