// Push subscription endpoints. Three routes:
//
//   GET  /push/public-key  — returns the VAPID public key for the client
//                            to use when subscribing. Avoids hardcoding
//                            it into the PWA bundle.
//   POST /push/subscribe   — PIN-auth. Stores (or refreshes) the caller's
//                            subscription in the PushSubscriptions tab.
//   POST /push/unsubscribe — PIN-auth. Removes a subscription by endpoint.
//
// Endpoint is the natural key (a single device produces a stable endpoint
// for a given browser+SW pairing). We dedupe on (Username, Endpoint) so
// re-subscribing from the same device updates the existing row rather
// than creating duplicates.

import { Router } from 'express';
import { findUserByPin, USERS_RANGE } from './auth.js';
import { getSheetsClient } from './google-client.js';
import { PUSH_TAB, PUSH_RANGE, getPublicKey } from './send-push.js';

const router = Router();

function logEndpoint(endpoint, ok, reason, extra = {}) {
  console.log(JSON.stringify({ endpoint, ok, reason, ...extra }));
}

function pinValidationError(req) {
  const pin =
    typeof req.body?.pin === 'string'
      ? req.body.pin.trim()
      : typeof req.query?.pin === 'string'
        ? req.query.pin.trim()
        : '';
  const min = parseInt(process.env.PIN_LENGTH_MIN || '4', 10);
  const max = parseInt(process.env.PIN_LENGTH_MAX || '6', 10);
  if (!/^\d+$/.test(pin) || pin.length < min || pin.length > max) {
    return { ok: false, status: 401, error: 'INVALID_PIN' };
  }
  return { ok: true, pin };
}

// ---- GET /push/public-key --------------------------------------------------
// Public — no PIN required. The public key is, by name, public; the PWA
// fetches it once on first subscribe.
router.get('/push/public-key', (req, res) => {
  const key = getPublicKey();
  if (!key) {
    logEndpoint('/push/public-key', false, 'NOT_CONFIGURED');
    return res.status(500).json({ ok: false, error: 'NOT_CONFIGURED' });
  }
  return res.json({ ok: true, public_key: key });
});

// Validate the body shape of a /push/subscribe request. Returns either
// { ok: true, sub } or { ok: false, error }.
// Exported for unit testing.
export function validateSubscriptionBody(body) {
  const sub = body?.subscription;
  if (!sub || typeof sub !== 'object') {
    return { ok: false, error: 'INVALID_SUBSCRIPTION' };
  }
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
  if (!endpoint || !/^https?:\/\//.test(endpoint)) {
    return { ok: false, error: 'INVALID_ENDPOINT' };
  }
  const keys = sub.keys || {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
  if (!p256dh || !auth) {
    return { ok: false, error: 'MISSING_KEYS' };
  }
  const userAgent =
    typeof body?.user_agent === 'string' ? body.user_agent.trim().slice(0, 500) : '';
  return { ok: true, sub: { endpoint, p256dh, auth, userAgent } };
}

// ---- POST /push/subscribe --------------------------------------------------
// Stores the caller's PushSubscription in the PushSubscriptions tab.
// Idempotent: if (Username, Endpoint) already exists, the existing row is
// updated in place so re-subscribing doesn't create duplicates.
router.post('/push/subscribe', async (req, res) => {
  const pinCheck = pinValidationError(req);
  if (!pinCheck.ok) {
    logEndpoint('/push/subscribe', false, pinCheck.error);
    return res.status(pinCheck.status).json({ ok: false, error: pinCheck.error });
  }

  const subCheck = validateSubscriptionBody(req.body);
  if (!subCheck.ok) {
    logEndpoint('/push/subscribe', false, subCheck.error);
    return res.status(400).json({ ok: false, error: subCheck.error });
  }

  try {
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    // Single batchGet: Users (for PIN→name) + PushSubscriptions (to dedupe).
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [USERS_RANGE, PUSH_RANGE],
    });
    const usersRows = batch.data.valueRanges?.[0]?.values || [];
    const auth = findUserByPin(usersRows, pinCheck.pin);
    if (!auth.ok) {
      const status = auth.error === 'INACTIVE_USER' ? 403 : 401;
      logEndpoint('/push/subscribe', false, auth.error);
      return res.status(status).json(auth);
    }
    const userName = auth.name;

    const pushRows = batch.data.valueRanges?.[1]?.values || [];
    const now = new Date().toISOString();
    const newRow = [
      userName,
      subCheck.sub.endpoint,
      subCheck.sub.p256dh,
      subCheck.sub.auth,
      subCheck.sub.userAgent,
      now,
    ];

    // Look for an existing row with the same (Username, Endpoint).
    let existingRowNumber = null;
    for (let i = 1; i < pushRows.length; i++) {
      const row = pushRows[i] || [];
      const u = String(row[0] ?? '').trim();
      const e = String(row[1] ?? '').trim();
      if (u === userName && e === subCheck.sub.endpoint) {
        existingRowNumber = i + 1; // 1-indexed sheet row
        break;
      }
    }

    if (existingRowNumber) {
      // Refresh: overwrite columns A–F of the existing row. Keeps the
      // sheet free of duplicates when a browser re-subscribes after
      // notification permission lapse / re-grant.
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${PUSH_TAB}'!A${existingRowNumber}:F${existingRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
      logEndpoint('/push/subscribe', true, 'REFRESHED', { user: userName });
      return res.json({ ok: true, refreshed: true });
    }

    // First time this (Username, Endpoint) pair appears — append.
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: PUSH_RANGE,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] },
    });
    logEndpoint('/push/subscribe', true, 'CREATED', { user: userName });
    return res.json({ ok: true, refreshed: false });
  } catch (err) {
    console.error('push/subscribe error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

// ---- POST /push/unsubscribe ------------------------------------------------
// Removes a subscription by endpoint. Self-only — caller can only delete
// their own row. Returns ok even if there's no matching row (idempotent).
router.post('/push/unsubscribe', async (req, res) => {
  const pinCheck = pinValidationError(req);
  if (!pinCheck.ok) {
    logEndpoint('/push/unsubscribe', false, pinCheck.error);
    return res.status(pinCheck.status).json({ ok: false, error: pinCheck.error });
  }

  const endpoint =
    typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  if (!endpoint || !/^https?:\/\//.test(endpoint)) {
    logEndpoint('/push/unsubscribe', false, 'INVALID_ENDPOINT');
    return res.status(400).json({ ok: false, error: 'INVALID_ENDPOINT' });
  }

  try {
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [USERS_RANGE, PUSH_RANGE],
    });
    const usersRows = batch.data.valueRanges?.[0]?.values || [];
    const auth = findUserByPin(usersRows, pinCheck.pin);
    if (!auth.ok) {
      const status = auth.error === 'INACTIVE_USER' ? 403 : 401;
      logEndpoint('/push/unsubscribe', false, auth.error);
      return res.status(status).json(auth);
    }
    const userName = auth.name;

    const pushRows = batch.data.valueRanges?.[1]?.values || [];
    let targetRowNumber = null;
    for (let i = 1; i < pushRows.length; i++) {
      const row = pushRows[i] || [];
      const u = String(row[0] ?? '').trim();
      const e = String(row[1] ?? '').trim();
      if (u === userName && e === endpoint) {
        targetRowNumber = i + 1;
        break;
      }
    }
    if (!targetRowNumber) {
      // Idempotent — if the row was already pruned (e.g. by a 410 in
      // send-push), still report success so the client UI matches reality.
      logEndpoint('/push/unsubscribe', true, 'NO_OP', { user: userName });
      return res.json({ ok: true, removed: false });
    }

    // Resolve the tab's numeric sheetId once (deleteDimension needs it).
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    const tab = (meta.data.sheets || []).find(
      (s) => s.properties?.title === PUSH_TAB,
    );
    if (!tab) {
      console.error(`${PUSH_TAB} tab not found`);
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: tab.properties.sheetId,
                dimension: 'ROWS',
                startIndex: targetRowNumber - 1,
                endIndex: targetRowNumber,
              },
            },
          },
        ],
      },
    });

    logEndpoint('/push/unsubscribe', true, 'REMOVED', { user: userName });
    return res.json({ ok: true, removed: true });
  } catch (err) {
    console.error('push/unsubscribe error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

export default router;
