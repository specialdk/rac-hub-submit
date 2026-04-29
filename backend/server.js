import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes-auth.js';
import submitRouter from './routes-submit.js';
import mySubmissionsRouter from './routes-my-submissions.js';
import adminRouter from './routes-admin.js';
import notifyRouter from './routes-notify.js';
import skillRouter from './routes-skill.js';

const app = express();

// Trust one proxy hop (Railway sits in front of the app and sets X-Forwarded-For).
// This makes req.ip reflect the real client IP so the rate limiter keys correctly.
app.set('trust proxy', 1);

// CORS:
// - Empty ALLOWED_ORIGIN (typical for local dev) → reflect the request origin
// - Comma-separated values (e.g. "https://prod-pwa.up.railway.app,http://localhost:8081")
//   → allow any of those exact origins. This lets the deployed backend
//   serve both prod traffic and a local dev PWA pointed at it.
const rawOrigin = process.env.ALLOWED_ORIGIN || '';
const allowedOrigins = rawOrigin
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length === 0 ? true : allowedOrigins,
    credentials: false,
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use(authRouter);
app.use(submitRouter);
app.use(mySubmissionsRouter);
app.use(adminRouter);
app.use(notifyRouter);
app.use(skillRouter);

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`rac-hub-submit backend listening on :${port}`);
});
