import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes-auth.js';

const app = express();

// Trust one proxy hop (Railway sits in front of the app and sets X-Forwarded-For).
// This makes req.ip reflect the real client IP so the rate limiter keys correctly.
app.set('trust proxy', 1);

// CORS: in dev, ALLOWED_ORIGIN may be unset — reflect the request origin.
// In prod, set ALLOWED_ORIGIN to the PWA URL.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin && allowedOrigin.length > 0 ? allowedOrigin : true,
    credentials: false,
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use(authRouter);

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`rac-hub-submit backend listening on :${port}`);
});
