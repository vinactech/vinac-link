// Phone vault: lets the app open with no network (it never needs one). Caches only the app's own
// files; the vault itself lives in this browser's storage, encrypted, and is never cached here.
// Paths are relative to this file, so the same app works at vinac.tech/app/ and at app.vinac.tech/.
const CACHE = 'vinac-vault-{{version}}';
const BASE = new URL('./', self.location.href);
const FILES = [
  './', 'app.js', 'app.css', 'manifest.webmanifest', 'icon-128.png', 'icon-512.png',
  'web/phone-crypto.js', 'web/phone-frame.js', 'web/beacon.js', 'web/secret-frame.js',
  'lab/js/audio.js', 'lab/js/modem.js', 'lab/js/frame.js', 'lab/js/fec.js', 'lab/js/bytes.js',
  'lab/js/crypto.js', 'lab/js/logos.js', 'lab/worklets/vinac-tx-processor.js', 'lab/worklets/vinac-rx-processor.js',
].map(f => new URL(f, BASE).href);
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.href.startsWith(BASE.href)) return;
  // Network first (fresh after an update), the cached copy when offline.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
