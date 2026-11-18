// Offline: the app shell is cached, and always refreshed from the network when there is one.
// Notes never pass through here; they live in IndexedDB.
const C = 'cocoanotes-v2'
const A = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'sounds/hello.mp3',
  'js/main.js', 'js/ui.js', 'js/db.js', 'js/ink.js', 'js/render.js', 'js/store.js', 'js/sync.js', 'js/status.js', 'js/editor.js', 'js/library.js', 'js/settings.js', 'js/onboard.js', 'js/fx.js', 'js/tactile.js', 'js/config.js', 'js/codec.js']
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(A)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const r = e.request
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)) } return res })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))))
})
