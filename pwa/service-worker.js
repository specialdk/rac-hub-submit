// Service worker for the RAC Hub Submit PWA.
//
// Two responsibilities:
//   1. Satisfy the "installable" PWA criteria so phones offer Add to
//      Home Screen. No offline caching — submission requires the
//      network and offline queueing is out of scope for v1.
//   2. Receive Web Push notifications and route taps back into the
//      PWA at the right deep link.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — let the network handle every request.
self.addEventListener('fetch', () => {});

// Display an incoming push. Payload shape (set by the backend):
//   { title, body, url, tag }
// `tag` is used to coalesce repeats — a second push with the same tag
// replaces the first instead of stacking, which is what we want for
// "story approved" / "new pending" notifications.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Some delivery paths send plain text — fall back to using it as the body.
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'RAC Hub';
  const options = {
    body: data.body || '',
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: data.tag || undefined,
    // Keep the notification visible until tapped on Android — without
    // this, some launchers auto-dismiss after a few seconds.
    requireInteraction: false,
    // Stash the deep-link path on the notification so notificationclick
    // can route the user to it. Stored on `data` so it survives the
    // round-trip through the OS notification shade.
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// When the user taps the notification, focus an existing PWA window if
// one is already open at any URL on this origin; otherwise open a new
// window at the deep-link URL. The PWA's boot() reads ?review= and
// ?my-story= from window.location.search and routes accordingly, so the
// service worker just hands off the URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Prefer an existing window if there is one — focus it and
      // navigate it to the target URL. Avoids piling up duplicate tabs
      // each time a notification is tapped.
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // navigate() can fail if the client is on a different
            // origin (shouldn't happen, but defensive). Falling
            // through to focus is still useful.
          }
          return client.focus();
        }
      }

      // No existing window — open a fresh one.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })(),
  );
});
