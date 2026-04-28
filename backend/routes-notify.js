import { Router } from 'express';
import crypto from 'node:crypto';
import { Resend } from 'resend';
import { ADMIN_DESTINATIONS } from './admin-helpers.js';
import { buildDeepLink, buildNotifyEmail } from './email.js';

const router = Router();

let cachedResend;
function getResend() {
  if (cachedResend) return cachedResend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY env var is not set');
  }
  cachedResend = new Resend(key);
  return cachedResend;
}

// Constant-time comparison of the X-Skill-Secret header against
// SKILL_NOTIFY_SECRET. Returns false on any mismatch (including
// length mismatch and missing values), without leaking timing info.
function checkSkillSecret(req) {
  const expected = process.env.SKILL_NOTIFY_SECRET;
  if (!expected) return false;
  const provided = req.headers['x-skill-secret'];
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function logNotify(ok, reason, extra = {}) {
  console.log(JSON.stringify({ endpoint: '/admin/notify', ok, reason, ...extra }));
}

router.post('/admin/notify', async (req, res) => {
  if (!checkSkillSecret(req)) {
    logNotify(false, 'BAD_SECRET');
    return res.status(401).json({ ok: false, error: 'BAD_SECRET' });
  }

  const { destination, row_number, title, submitted_by } = req.body || {};

  if (!ADMIN_DESTINATIONS.includes(destination)) {
    logNotify(false, 'INVALID_DESTINATION', { destination });
    return res.status(400).json({ ok: false, error: 'INVALID_DESTINATION' });
  }
  const rowNum = parseInt(row_number, 10);
  if (!Number.isInteger(rowNum) || rowNum < 2) {
    logNotify(false, 'INVALID_ROW', { row_number });
    return res.status(400).json({ ok: false, error: 'INVALID_ROW' });
  }
  if (typeof title !== 'string' || !title.trim()) {
    logNotify(false, 'INVALID_TITLE');
    return res.status(400).json({ ok: false, error: 'INVALID_TITLE' });
  }
  if (typeof submitted_by !== 'string' || !submitted_by.trim()) {
    logNotify(false, 'INVALID_SUBMITTED_BY');
    return res.status(400).json({ ok: false, error: 'INVALID_SUBMITTED_BY' });
  }

  const pwaUrl = process.env.PWA_URL;
  const fromAddr = process.env.EMAIL_FROM;
  const toAddr = process.env.ADMIN_NOTIFY_EMAIL;
  if (!pwaUrl || !fromAddr || !toAddr) {
    console.error('Missing email env vars: PWA_URL, EMAIL_FROM, or ADMIN_NOTIFY_EMAIL');
    logNotify(false, 'MISSING_ENV');
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }

  const deepLink = buildDeepLink(pwaUrl, destination, rowNum);
  const { subject, html, text } = buildNotifyEmail({
    title: title.trim(),
    submittedBy: submitted_by.trim(),
    destination,
    deepLink,
  });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: fromAddr,
      to: [toAddr],
      subject,
      html,
      text,
    });
    if (error) {
      console.error('Resend error:', error.message || JSON.stringify(error));
      logNotify(false, 'EMAIL_FAILED', { msg: error.message });
      return res.status(500).json({ ok: false, error: 'EMAIL_FAILED' });
    }
    logNotify(true, 'OK', { id: data?.id, destination, row_number: rowNum });
    return res.json({ ok: true });
  } catch (err) {
    console.error('admin/notify error:', err.message);
    logNotify(false, 'EMAIL_FAILED', { msg: err.message });
    return res.status(500).json({ ok: false, error: 'EMAIL_FAILED' });
  }
});

export default router;
