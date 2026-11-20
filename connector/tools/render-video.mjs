#!/usr/bin/env node
// Renders video/explainer.html into site/media/demo.mp4 (1920x1080, 30 fps) and a poster image.
// Draws every frame exactly with renderAt(seconds) in headless Edge or Chrome, and encodes with
// ffmpeg. No sound is played or recorded.
//   node connector/tools/render-video.mjs                    full video + poster
//   node connector/tools/render-video.mjs --stills 5,15,30   only these moments, as PNGs in --out
//   options: --fps 30  --out DIR  --crf 24
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const FPS = Number(opt('fps', 30));
const CRF = String(opt('crf', 24));
const OUT = path.resolve(opt('out', path.join(ROOT, 'site', 'media')));
const stills = opt('stills', null)?.split(',').map(Number);
const PAGE = pathToFileURL(path.join(ROOT, 'video', 'explainer.html')).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BROWSERS = [process.env.CHROME_BIN, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const exe = BROWSERS.find(b => fs.existsSync(b));
if (!exe) throw new Error('No Edge or Chrome found (set CHROME_BIN).');
if (!stills && spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg is needed for the video (winget install Gyan.FFmpeg).');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vinac-video-browser-'));
const browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });

  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });
  await sleep(800);
  await cdp('Runtime.evaluate', { expression: 'window.ready', awaitPromise: true });
  const duration = (await cdp('Runtime.evaluate', { expression: 'window.DURATION', returnByValue: true })).result.value;
  const shot = async (t, format = 'jpeg') => {
    await cdp('Runtime.evaluate', { expression: `renderAt(${t})` });
    const { data } = await cdp('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 92 } : {}), clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
    return Buffer.from(data, 'base64');
  };

  fs.mkdirSync(OUT, { recursive: true });
  if (stills) {
    for (const t of stills) fs.writeFileSync(path.join(OUT, `still-${String(t).padStart(5, '0')}.png`), await shot(t, 'png'));
    console.log(`${stills.length} stills in ${OUT}`);
  } else {
    const file = path.join(OUT, 'demo.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
    const frames = Math.round(duration * FPS);
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const jpg = await shot(i / FPS);
      if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % (FPS * 10) === 0) console.log(`  ${Math.round(i / FPS)} s of ${duration} s (${Math.round((Date.now() - t0) / 1000)} s so far)`);
    }
    ff.stdin.end();
    await done;
    fs.writeFileSync(path.join(OUT, 'poster.jpg'), await shot(86.5));
    console.log(`video: ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB, ${frames} frames)\nposter: ${path.join(OUT, 'poster.jpg')}`);
  }
  ws.close();
} finally {
  browser.kill();
}
