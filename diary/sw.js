// Nexora Diary — service worker.
// Objectif : app installable + shell offline en secours, MAIS toujours servir la
// dernière version fraîche du HTML quand le réseau est dispo (network-first).
// Le CSS/JS étant inliné dans index.html, ça garantit que les changements de
// design se propagent sans hard-refresh.
const CACHE = 'nexora-diary-v11';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.host.endsWith('supabase.co')) return;              // API/realtime : jamais cache
  if (url.origin !== location.origin) return;                // Autres origines : passe direct
  if (e.request.method !== 'GET') return;

  const dest = e.request.destination;
  const isHtml = dest === 'document' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHtml) {
    // Network-first : on tente le réseau, on retombe sur le cache SEULEMENT
    // si offline. Comme ça, les updates HTML sont instantanées.
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        if (fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put(e.request, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(e.request)) || (await cache.match('./index.html'));
      }
    })());
    return;
  }

  // Autres GET même origine (manifest, sw.js éventuel) : stale-while-revalidate.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const fetching = fetch(e.request).then((resp) => {
      if (resp && resp.status === 200) cache.put(e.request, resp.clone());
      return resp;
    }).catch(() => cached);
    return cached || fetching;
  })());
});
