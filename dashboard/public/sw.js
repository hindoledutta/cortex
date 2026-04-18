// Self-destructing service worker — replaces the old workbox SW from vite-plugin-pwa.
// Once the browser picks up this new script, it clears all caches and unregisters itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => { clients.forEach((c) => c.navigate(c.url)); })
  );
});
