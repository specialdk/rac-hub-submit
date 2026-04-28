# RAC Hub Submit — PWA

Phone-first Progressive Web App. Plain HTML + vanilla JS + CSS — no framework, no TypeScript, no build pipeline.

## What's here (item 4 — sign-in + submit wiring)

- **Sign-in screen** — PIN entry, calls `POST /auth`, persists `pin/name/email/role` to localStorage.
- **Submit screen** — destination dropdown (General default), story text with live char counter (10–1000), optional title and highlight, basic photo picker (multiple, camera or library), photo previews labelled Banner / Photo 2 / Photo 3 in selection order. First photo is the banner.
- **Submitting screen** — uploading spinner, success message, retry on failure.
- **Sign-out** — clears localStorage and returns to sign-in.

What's *not* in this item yet — coming next:
- **Item 5:** canvas-based resize, EXIF orientation rotation, EXIF stripping, drag/arrow reorder, per-photo remove, client-side 20 MB total cap.
- **Item 6:** "My Recent Submissions" screen.

## File layout

```
pwa/
├── index.html          App shell — loads config, app, registers SW
├── config.js           window.RAC_CONFIG.apiBase — backend URL per env
├── app.js              Screen orchestration, state, API calls (vanilla)
├── styles.css          Cream/terracotta/ochre palette, Work Sans
├── manifest.json       PWA manifest (installable on phones)
├── service-worker.js   Minimal SW — install + claim, no caching
├── icon.svg            Vector app icon
└── serve.js            Tiny zero-dep static server for local dev only
```

## Run locally

The PWA is plain static files — any static server works. A tiny zero-dep `serve.js` is included for convenience.

1. Make sure the backend is running on `http://localhost:3000` (see `../backend/README.md`)
2. From the `pwa/` directory:
   ```bash
   node serve.js
   ```
3. Open `http://localhost:8080` in your browser.

`config.js` defaults `apiBase` to `http://localhost:3000`, which matches the backend's default port. Override that file at deploy time to point at the production backend URL.

### Why a separate server for the PWA?

The backend runs on `:3000` and the PWA is served on `:8080` so they're cleanly separated. CORS is already wired on the backend (`origin: true` in dev reflects the PWA's origin), so the cross-port request works without any extra config.

## Visual style

- **Palette:** terracotta `#C4651A`, ochre `#D4A43E`, cream `#F5E6D3`, charcoal `#2D1B0E`
- **Type:** Work Sans (loaded from Google Fonts)
- **Layout:** single column, max-width 640px, generous padding, large tap targets (≥48px)
- Mobile-first; desktop works but isn't the target.

## localStorage keys

| Key | Contents |
|-----|----------|
| `rac_hub_pin` | PIN as entered |
| `rac_hub_user_name` | Name returned by `/auth` |
| `rac_hub_user_email` | Email returned by `/auth` (may be empty) |
| `rac_hub_user_role` | `Admin` or `User` |

No drafts, no submission history, no other state stored — submission requires the network and there's no offline queueing in v1.

## Installable / "Add to Home Screen"

The manifest + service worker are enough for Chrome and modern Safari to offer "Add to Home Screen". Note: iOS may want a PNG `apple-touch-icon` for cleanest installation — the SVG works in browsers but iOS sometimes prefers raster. If iOS install looks rough on phone testing, swap `icon.svg` for a 180×180 PNG before deployment.

## Deployment

Deployed to Railway as static files. Edit `config.js` to point `apiBase` at the deployed backend URL before deploying.
