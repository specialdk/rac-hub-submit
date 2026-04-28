// Runtime config for the PWA. Loaded before app.js.
//
// Override apiBase per environment:
//   - Local dev:        http://localhost:3000
//   - Production:       the Railway URL of the deployed backend
//
// This file is the only deploy-time mutable surface in the PWA — the rest
// of the code is environment-agnostic.
// In production, the PWA at https://rac-pwa.up.railway.app talks to the
// backend at https://rac-backend.up.railway.app. For local dev, override
// this file in your worktree (it's tracked, so don't commit local changes).
window.RAC_CONFIG = {
  apiBase: 'https://rac-backend.up.railway.app',
};
