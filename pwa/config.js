// Runtime config for the PWA. Loaded before app.js.
//
// Override apiBase per environment:
//   - Local dev:        http://localhost:3000
//   - Production:       the Railway URL of the deployed backend
//
// This file is the only deploy-time mutable surface in the PWA — the rest
// of the code is environment-agnostic.
window.RAC_CONFIG = {
  apiBase: 'http://localhost:3000',
};
