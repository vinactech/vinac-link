// Phone vault: lets the app open with no network (it never needs one). Caches only the app's own
// files; the vault itself lives in this browser's storage, encrypted, and is never cached here.
const CACHE = 'vinac-vault-{{version}}';
const FILES = [
  '/app/', '/app/app.js', '/app/app.css', '/app/manifest.webmanifest', '/brand/icon-128.png', '/brand/icon-512.png',
  '/app/web/phone-crypto.js', '/app/web/phone-frame.js', '/app/web/beacon.js', '/app/web/secret-frame.js',
  '/app/lab/js/audio.js', '/app/lab/js/modem.js', '/app/lab/js/frame.js', '/app/lab/js/fec.js', '/app/lab/js/bytes.js',
  '/app/lab/js/crypto.js', '/app/lab/js/logos.js', '/app/lab/worklets/vinac-tx-processor.js', '/app/lab/worklets/vinac-rx-processor.js',
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/app/') && !url.pathname.startsWith('/brand/')) return;
  // Network first (fresh after an update), the cached copy when offline.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
