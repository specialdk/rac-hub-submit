# RAC Hub Submit

A staff-facing system that lets RAC staff submit stories to the RAC Intranet from their phones, and lets an admin review and approve them.

> **📘 [Handbook](docs/HANDBOOK.md)** — product overview, system architecture, and standard operating procedures. Start here if you're new to the project or need to operate / troubleshoot it.

## What's in this repo

- **`pwa/`** — Phone-first Progressive Web App (plain HTML + vanilla JS + CSS). Two roles: `User` (submit only) and `Admin` (submit + review/approve).
- **`backend/`** — Node.js + Express service deployed on Railway. Validates PINs, accepts submissions, writes to Google Drive, reads/writes Google Sheets, sends notification emails.
- **`skill/`** — *Out of scope for this repo.* The CoWork skill that picks up Drive submissions and writes "Waiting Approval" rows to the Intranet sheet is built separately.
- **`docs/`** — Authoritative spec.
  - [`rac-hub-submit-contract.txt`](docs/rac-hub-submit-contract.txt) — the contract between PWA, backend, and skill. Single source of truth for data shapes.
  - [`claude-code-brief.txt`](docs/claude-code-brief.txt) — build brief.

## End-to-end flow

1. Staff member opens PWA on phone, signs in with PIN, fills story form, submits.
2. PWA resizes photos on device, uploads everything to backend.
3. Backend validates PIN, writes a folder to Google Drive containing `submission.json` + photos.
4. *(Out of scope)* CoWork skill processes the folder hourly, writes "Waiting Approval" rows to the IntranetControl Sheet, calls `POST /admin/notify`.
5. Backend sends admin an email with a deep link to the review screen.
6. Admin opens link, sees preview, taps Approve or Reject. Backend flips the `Status` cell.
7. Intranet renders the new "Approved" row on next refresh.

## Local development

See [`backend/README.md`](backend/README.md) and [`pwa/README.md`](pwa/README.md) once those services are built out.

## Deployment

Both `backend/` and `pwa/` deploy as separate services on Railway, both pointed at the same GitHub repo with different **Root Directory** settings.

### One-time Railway setup

1. Create a Railway account and connect your GitHub.
2. New Project → "Deploy from GitHub repo" → pick `rac-hub-submit`.
3. The first service deploys from the repo root by default — rename it to **`backend`** and in **Settings → Source → Root Directory** set `backend`. Railway re-detects Node from `backend/package.json` and runs `npm start`.
4. Add a second service to the same project: **+ New → GitHub Repo → same repo**. Name it **`pwa`**, set Root Directory to `pwa`. Same auto-detect → `npm start` runs the zero-dep static server.

### Environment variables

Backend service env vars (everything in `backend/.env.example` except `PORT`, which Railway sets automatically):

- Google: `GOOGLE_SERVICE_ACCOUNT_JSON`, `INTRANET_CONTROL_SHEET_ID`
- OAuth (for Drive writes): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `DRIVE_SUBMISSIONS_FOLDER_ID`
- Auth: `PIN_LENGTH_MIN`, `PIN_LENGTH_MAX`, `SKILL_NOTIFY_SECRET`
- Email: `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL`
- Network: `ALLOWED_ORIGIN` (the deployed PWA URL), `PWA_URL` (same — used in email deep links)

PWA service: no env vars needed at runtime. The `apiBase` is hardcoded into `pwa/config.js` and changes via a commit + redeploy.

### Order of operations

Because each service depends on the other's URL, the deployment is a two-pass dance:

1. Deploy backend first — it boots without `ALLOWED_ORIGIN` / `PWA_URL` set; `/health` works regardless. Note the assigned URL (e.g. `https://rac-hub-backend.up.railway.app`).
2. Update `pwa/config.js` to point `apiBase` at the backend URL → commit + push → PWA auto-redeploys. Note its URL.
3. On the backend service, set `ALLOWED_ORIGIN` and `PWA_URL` to the PWA URL → backend auto-redeploys.
4. Smoke test: open PWA URL on phone, sign in, submit a test story, verify Drive folder appears. Run a `/admin/notify` curl with the prod URL to verify Resend email lands in the configured inbox.

### What does NOT change for prod

- **Google Cloud Console OAuth redirect URI** stays as `http://localhost:3001/oauth/callback`. The OAuth flow is a one-time local-only bootstrap that mints the refresh token; the deployed backend never does OAuth at runtime, only token-refresh against Google's token endpoint using the stored refresh token. Re-minting (rotation, scope change) still runs locally with `node oauth-bootstrap.js`.
- **Resend sender domain** — for v1, sandbox `onboarding@resend.dev` continues to work; it only delivers to the Resend account's verified email. Adding a verified domain (e.g. `rirratjingu.com`) is optional polish for v1.1.

## Status

v1.5 in production. See [Handbook](docs/HANDBOOK.md) for the current feature surface and how to operate the system.
