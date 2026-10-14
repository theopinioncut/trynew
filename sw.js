/* Kliquestart offline support.
   - Pages: try the network for up to 3 seconds, then fall back to the saved copy (slow metro signal).
   - Files (CSS, fonts, images): serve the saved copy instantly and refresh it in the background.
   Bump VERSION whenever the CORE list changes. */
const VERSION = 'ks-v1';
const CORE = [
  '/', '/about.html', '/privacy.html', '/site.webmanifest',
  '/assets/site.css', '/assets/fonts.css',
  '/assets/fonts/ChakraPetch-500.woff2', '/assets/fonts/ChakraPetch-600.woff2', '/assets/fonts/ChakraPetch-700.woff2',
  '/assets/fonts/IBMPlexMono-400.woff2', '/assets/fonts/IBMPlexMono-600.woff2',
  '/assets/icon-192.png', '/assets/red-view-card.jpg', '/assets/metro-game-card.jpg',
  '/games/metro-game/play/', '/games/red-view/', '/games/red-view/play/'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(req.mode === 'navigate' ? pageFirstFromNetwork(req) : fileFromCache(req));
});

async function pageFirstFromNetwork(req) {
  const cache = await caches.open(VERSION);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3000));
  try {
    return await Promise.race([net, timeout]);
  } catch (err) {
    const saved = await cache.match(req, { ignoreSearch: true });
    if (saved) return saved;
    try { return await net; } catch (e) { return (await cache.match('/')) || Response.error(); }
  }
}

async function fileFromCache(req) {
  const cache = await caches.open(VERSION);
  const saved = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return saved || (await net) || Response.error();
}
