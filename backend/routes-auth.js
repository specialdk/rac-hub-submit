import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { findUserByPin, USERS_RANGE } from './auth.js';
import { getSheetsClient } from './google-client.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'RATE_LIMITED' },
});

function logAuth(ok, reason) {
  console.log(JSON.stringify({ endpoint: '/auth', ok, reason }));
}

router.post('/auth', authLimiter, async (req, res) => {
  const { pin } = req.body || {};

  const min = parseInt(process.env.PIN_LENGTH_MIN || '4', 10);
  const max = parseInt(process.env.PIN_LENGTH_MAX || '6', 10);

  // Reject obviously malformed PINs without burning a Sheet read.
  // Format failures look identical to wrong PINs from the client's POV.
  if (
    typeof pin !== 'string' ||
    !/^\d+$/.test(pin) ||
    pin.length < min ||
    pin.length > max
  ) {
    logAuth(false, 'INVALID_PIN_FORMAT');
    return res.status(401).json({ ok: false, error: 'INVALID_PIN' });
  }

  try {
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: USERS_RANGE,
    });
    const rows = resp.data.values || [];
    const result = findUserByPin(rows, pin);

    if (!result.ok) {
      const status = result.error === 'INACTIVE_USER' ? 403 : 401;
      logAuth(false, result.error);
      return res.status(status).json(result);
    }

    logAuth(true, result.role);
    return res.json(result);
  } catch (err) {
    console.error('auth error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

export default router;
