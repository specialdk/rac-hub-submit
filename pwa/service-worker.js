// Minimal service worker — exists only so the PWA satisfies the
// "installable" criteria on phones. No offline caching: the brief
// explicitly says submission requires the network, and offline
// queueing is out of scope for v1.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — let the network handle every request.
self.addEventListener('fetch', () => {});
