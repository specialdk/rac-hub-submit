// Web Push helper: load subscriptions for a user (or all admins) from the
// PushSubscriptions tab, send an encrypted push payload, and prune any
// subscriptions the push service tells us are dead (HTTP 410 Gone or 404).
//
// Storage schema (PushSubscriptions tab in IntranetControl):
//   A=Username (matches Users.B/FullName — what /admin/notify already uses)
//   B=Endpoint (push service URL — natural key together with Username)
//   C=P256DH   (encryption public key from PushSubscription.getKey('p256dh'))
//   D=Auth     (encryption secret from PushSubscription.getKey('auth'))
//   E=UserAgent (diagnostic — "Rachael's phone" vs "Rachael's laptop")
//   F=SubscribedAt (ISO timestamp)

import webpush from 'web-push';
import { getSheetsClient } from './google-client.js';

export const PUSH_TAB = 'PushSubscriptions';
export const PUSH_RANGE = `${PUSH_TAB}!A:F`;

// Column indices into the PushSubscriptions tab.
const COL = {
  username: 0,
  endpoint: 1,
  p256dh: 2,
  auth: 3,
  userAgent: 4,
  subscribedAt: 5,
};

// VAPID config is set lazily on first use so unit tests can import this
// module without env vars.
let vapidConfigured = false;
function configureVapid() {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

// Read all rows of the PushSubscriptions tab (skipping the header row).
// Returns an array of { username, endpoint, p256dh, auth, userAgent,
// subscribedAt, rowNumber } — rowNumber is the 1-indexed sheet row, used
// when we need to delete a dead subscription.
async function loadAllSubscriptions(sheets, sheetId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: PUSH_RANGE,
  });
  const rows = resp.data.values || [];
  const subs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const endpoint = String(row[COL.endpoint] ?? '').trim();
    if (!endpoint) continue; // skip blank rows
    subs.push({
      username: String(row[COL.username] ?? '').trim(),
      endpoint,
      p256dh: String(row[COL.p256dh] ?? '').trim(),
      auth: String(row[COL.auth] ?? '').trim(),
      userAgent: String(row[COL.userAgent] ?? '').trim(),
      subscribedAt: String(row[COL.subscribedAt] ?? '').trim(),
      rowNumber: i + 1,
    });
  }
  return subs;
}

// Filter subscriptions to those owned by a specific user (FullName match,
// case-sensitive — matches the /my-submissions self-only check).
export async function loadSubscriptionsForUser(userName) {
  const sheets = getSheetsClient();
  const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
  if (!sheetId) throw new Error('INTRANET_CONTROL_SHEET_ID not set');
  const all = await loadAllSubscriptions(sheets, sheetId);
  return all.filter((s) => s.username === userName);
}

// Filter subscriptions to those owned by users in a given set of names.
// Used for "notify all admins" — caller resolves admins from the Users tab
// first, then passes their names here.
export async function loadSubscriptionsForUsers(userNames) {
  if (!Array.isArray(userNames) || userNames.length === 0) return [];
  const wanted = new Set(userNames.map((n) => String(n || '').trim()).filter(Boolean));
  if (wanted.size === 0) return [];
  const sheets = getSheetsClient();
  const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
  if (!sheetId) throw new Error('INTRANET_CONTROL_SHEET_ID not set');
  const all = await loadAllSubscriptions(sheets, sheetId);
  return all.filter((s) => wanted.has(s.username));
}

// Delete one row from PushSubscriptions by its 1-indexed row number.
// Used when a push attempt returns 410 Gone or 404 — the browser/OS has
// dropped the subscription and the row is dead weight.
//
// Sheets API note: deleteDimension requires the numeric sheetId (not the
// tab name). We resolve it on first use and cache.
let cachedSheetGid = null;
async function deleteSubscriptionRow(sheets, spreadsheetId, rowNumber) {
  if (cachedSheetGid === null) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const tab = (meta.data.sheets || []).find(
      (s) => s.properties?.title === PUSH_TAB,
    );
    if (!tab) throw new Error(`${PUSH_TAB} tab not found`);
    cachedSheetGid = tab.properties.sheetId;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: cachedSheetGid,
              dimension: 'ROWS',
              startIndex: rowNumber - 1, // 0-indexed
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

// Send one push to the given subscriptions. Returns a summary
// { sent, failed, pruned } for logging. Never throws — push failure is
// non-fatal to the caller (the underlying action, e.g. approve, has
// already succeeded before push fires).
//
// payload should be a small JSON-serialisable object matching the shape
// the service worker expects:
//   { title, body, url, tag }
//
// Dead-subscription pruning (410 Gone / 404 Not Found) is automatic — the
// push service has told us the user uninstalled the app, cleared
// notifications, or the browser revoked the subscription, so we drop the
// row to keep the sheet from growing stale.
export async function sendPushToSubscriptions(subscriptions, payload) {
  if (!configureVapid()) {
    console.error('VAPID env vars not set; skipping push send');
    return { sent: 0, failed: subscriptions.length, pruned: 0 };
  }
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const body = JSON.stringify(payload);
  const sheets = getSheetsClient();
  const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;

  // Rows pruned in descending order so each delete doesn't shift the
  // indices of subsequent ones.
  const toPrune = [];
  let sent = 0;
  let failed = 0;

  // Send in parallel — the push service is fast (~100ms each) and this
  // is fire-and-forget from the caller's perspective.
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        body,
      ),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sub = subscriptions[i];
    if (r.status === 'fulfilled') {
      sent++;
      continue;
    }
    failed++;
    const status = r.reason?.statusCode;
    if (status === 410 || status === 404) {
      toPrune.push(sub.rowNumber);
    } else {
      console.error(
        `push send failed for ${sub.username} (${status || 'no status'}):`,
        r.reason?.body || r.reason?.message || r.reason,
      );
    }
  }

  // Prune dead subscriptions in descending row order so deletes don't
  // shift unprocessed indices. Pruning errors are logged but never
  // propagated — push has already been attempted by this point.
  toPrune.sort((a, b) => b - a);
  let pruned = 0;
  for (const rowNumber of toPrune) {
    try {
      await deleteSubscriptionRow(sheets, sheetId, rowNumber);
      pruned++;
    } catch (err) {
      console.error(`failed to prune subscription row ${rowNumber}:`, err.message);
    }
  }

  return { sent, failed, pruned };
}

// Convenience: send to all of a user's devices.
export async function sendPushToUser(userName, payload) {
  try {
    const subs = await loadSubscriptionsForUser(userName);
    return await sendPushToSubscriptions(subs, payload);
  } catch (err) {
    console.error('sendPushToUser error:', err.message);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}

// Convenience: send to all of a set of users' devices.
export async function sendPushToUsers(userNames, payload) {
  try {
    const subs = await loadSubscriptionsForUsers(userNames);
    return await sendPushToSubscriptions(subs, payload);
  } catch (err) {
    console.error('sendPushToUsers error:', err.message);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}
