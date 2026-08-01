// Nexora Diary — service worker minimal.
// Objectif : app installable + shell disponible offline (dernière version vue).
// Le contenu dynamique (fiches, checks) passe toujours par le network via Supabase.
const CACHE = 'nexora-diary-v5';
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
  // Ne cache jamais Supabase (API + auth + realtime).
  if (url.host.endsWith('supabase.co')) return;
  // Ne cache pas les autres origines (CDN inclus).
  if (url.origin !== location.origin) return;
  // Ne cache que GET.
  if (e.request.method !== 'GET') return;

  // Stale-while-revalidate pour le shell (HTML/manifest).
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
