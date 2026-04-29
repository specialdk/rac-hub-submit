# RAC Hub Submit — PWA

Phone-first Progressive Web App. Plain HTML + vanilla JS + CSS — no framework, no TypeScript, no build pipeline.

## What's here (items 4–6)

- **Sign-in screen** — PIN entry, calls `POST /auth`, persists `pin/name/email/role` to localStorage.
- **Submit screen** — destination dropdown (General default), story text with live char counter (10–1000) **plus an in-place Dictate button** that captures speech via the Web Speech API (en-AU; works on iOS Safari and Android Chrome via the system's built-in speech engine), optional title and highlight, photo picker (multiple, camera or library — both available on phone via the native chooser), per-photo remove (✕) and reorder (◀ ▶) controls, banner-framing tip, photo previews labelled Banner / Photo 2 / Photo 3 in selection order. First photo is the banner.
- **Submitting screen** — "Resizing photos…" then "Uploading your story…", success message, retry on failure.
- **Sign-out** — clears localStorage and returns to sign-in.
- **My Recent Submissions screen** (item 6):
  - Reverse-chronological list of the current user's last 10 stories across Modal Stories + 5 Manager tabs
  - Each item shows title, destination, date, and a status badge (Approved / Waiting Approval / Archived)
  - Manual Refresh button at the top + pull-to-refresh on touch devices
  - Linked from a "View my recent submissions" button at the bottom of the Submit screen
  - Empty state for a user who has never submitted
- **On-device photo processing** (item 5):
  - Resize so longest edge ≤ 1920 px (no upscale)
  - Apply EXIF orientation by rotating canvas pixels (phones lie about orientation in metadata; the Intranet doesn't read EXIF)
  - Strip all EXIF metadata via canvas re-encode (drops GPS coords for privacy)
  - Re-encode all images as JPEG at quality 0.85
  - Hard cap of **10 photos per story** — picker disables at the cap with a clear note. Post-resize totals are tiny so the backend's 20 MB safety net rarely kicks in, but stays in place.
  - Inline EXIF parser in `photo-utils.js`, no npm dependency
  - `submitted_at` includes the device's local timezone offset (e.g. `+09:30`) so submissions made late at night don't roll into the next UTC day
- **Banner cropping is not done client-side** — the existing Intranet uses CSS `background-size: cover` with `background-position: center center`, so the browser handles cropping at display time. The picker shows a tip telling submitters to frame the subject near the centre.

- **Admin Pass 1** (item 8 — visible only when `state.user.role === 'Admin'`):
  - Pending count banner on the Submit screen — terracotta CTA "N stories waiting your approval", or a quiet greyed banner "all stories reviewed" at zero
  - Review queue screen — list of pending stories sorted by submitted date desc
  - Review Detail screen with banner image, title, highlight, body text, body images (General only), submitter + date metadata, Approve / Reject actions
  - Deep link `?review={destination}&row={n}` opens the PWA directly to Review Detail (used by admin notification emails). If the row doesn't exist or isn't `Waiting Approval` yet, shows "still being processed" message
  - Confirmation toast on action, returns to queue, count drops by one immediately
- **Admin Pass 2** (item 11):
  - Faithful preview rendering — banner becomes a hero card with destination tag and title overlaid via gradient, body text rendered as proper paragraphs (split on blank lines), submitter/date/destination grouped into a meta card
  - Live badge polling — count refreshes every 30 seconds while the Admin user is on the Submit screen, idle elsewhere. Polling auto-starts/stops based on screen + role; managed from the single render() entry point
  - Reject-reason input — Reject button reveals an in-place form with a textarea (optional), Confirm rejection / Cancel buttons. Reason is sent to backend and written to the AdminNote column when present

## File layout

```
pwa/
├── index.html          App shell — loads config, photo-utils, app, registers SW
├── config.js           window.RAC_CONFIG.apiBase — backend URL per env
├── photo-utils.js      Inline EXIF parser, canvas resize/rotate/strip-EXIF
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
