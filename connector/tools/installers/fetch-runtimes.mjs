#!/usr/bin/env node
// Downloads the official Node.js runtimes that the installers bundle (same version as this
// computer's Node), into build/runtimes/, and checks each file against nodejs.org's SHASUMS256.txt.
// Files already there with the right checksum are not downloaded again.
//   node connector/tools/installers/fetch-runtimes.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const NODE_VERSION = process.version; // e.g. v24.19.0
export const RUNTIME_DIR = path.join(ROOT, 'build', 'runtimes', NODE_VERSION);
export const RUNTIMES = {
  win: `node-${NODE_VERSION}-win-x64.zip`,
  macArm: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
  macIntel: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
  linux: `node-${NODE_VERSION}-linux-x64.tar.xz`,
};
const BASE = `https://nodejs.org/dist/${NODE_VERSION}/`;
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export async function fetchRuntimes(log = console.log) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const sums = await (await fetch(`${BASE}SHASUMS256.txt`)).text();
  const expected = Object.fromEntries(sums.trim().split('\n').map(l => l.trim().split(/\s+/).reverse()));
  for (const name of Object.values(RUNTIMES)) {
    const file = path.join(RUNTIME_DIR, name);
    const want = expected[name];
    if (!want) throw new Error(`${name} is not listed in SHASUMS256.txt`);
    if (fs.existsSync(file) && sha256(file) === want) { log(`  ok   ${name} (already here)`); continue; }
    const r = await fetch(BASE + name);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const got = sha256(file);
    if (got !== want) { fs.rmSync(file); throw new Error(`${name}: checksum mismatch (got ${got}, expected ${want})`); }
    log(`  ok   ${name} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB, checksum verified)`);
  }
  return RUNTIME_DIR;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Node.js ${NODE_VERSION} runtimes -> ${RUNTIME_DIR}`);
  await fetchRuntimes();
}
