// Service worker for the RAC Hub Submit PWA.
//
// Three responsibilities:
//   1. Satisfy the "installable" PWA criteria so phones offer Add to
//      Home Screen. No offline caching — submission requires the
//      network and offline queueing is out of scope for v1.
//   2. Receive Web Push notifications and route taps back into the
//      PWA at the right deep link.
//   3. Track per-window "busy" state via postMessage so a notification
//      tap never silently navigates away from a review/detail screen
//      and destroys in-progress work.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — let the network handle every request.
self.addEventListener('fetch', () => {});

// ---- Busy-state tracking ---------------------------------------------------
// The PWA postMessages { type: 'pwa.busy', busy: true|false } whenever it
// enters or leaves a screen where a notification-driven navigation would
// destroy the user's context (review screen with a story loaded, edit
// form, reject reason form, My Stories detail). We track which client IDs
// are currently busy so notificationclick can prefer those windows for
// focus-only handling.
//
// Note: a fresh SW activation wipes this Set. The PWA re-emits its busy
// state on every render(), so within ~one user action the SW recovers.

const busyClients = new Set();

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'pwa.busy') return;
  const id = event.source && event.source.id;
  if (!id) return;
  if (data.busy) {
    busyClients.add(id);
  } else {
    busyClients.delete(id);
  }
});

// ---- Push display ----------------------------------------------------------
// Display an incoming push. Payload shape (set by the backend):
//   { title, body, url, tag }
// `tag` is used to coalesce repeats — a second push with the same tag
// replaces the first instead of stacking. The backend uses a stable
// 'pending' tag for admin new-pending pushes so multiple submissions in
// one runner cycle don't pile up; submitter pushes (approve/reject) use
// per-story tags so each individual outcome stays visible.
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
    requireInteraction: false,
    // Stash the deep-link path on the notification so notificationclick
    // can route the user to it. Stored on `data` so it survives the
    // round-trip through the OS notification shade.
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- Notification tap routing ---------------------------------------------
// When the user taps the notification:
//   - If any open client is currently "busy" (mid-review/edit), focus it
//     without navigating. The user keeps their context; the new
//     notification stays in the shade for them to open deliberately.
//   - Otherwise, focus an existing client and navigate it to the deep
//     link, or open a new window if none exist.
//
// This avoids the failure mode where a heads-up banner arriving during
// review steals a tap and silently swaps the admin into a different story.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Prefer surfacing a busy window — focus only, no navigation.
      const busyClient = allClients.find((c) => busyClients.has(c.id));
      if (busyClient) {
        try {
          return await busyClient.focus();
        } catch {
          // fall through to navigation path
        }
      }

      // No busy client — proceed with normal "deep link to the relevant
      // screen" behaviour. Focus existing window first if possible.
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
