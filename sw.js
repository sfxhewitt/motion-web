// Offline cache for the app shell (network-first for HTML, cache-first for assets).
const V = 'kntc-v10';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/main.js', 'js/state.js', 'js/easing.js', 'js/effects.js', 'js/render.js', 'js/storage.js', 'js/export.js', 'js/ui.js',
  'fonts/SpaceGrotesk.woff2', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
});
