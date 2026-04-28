# RAC Hub Submit

A staff-facing system that lets RAC staff submit stories to the RAC Intranet from their phones, and lets an admin review and approve them.

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

Both `backend/` and `pwa/` deploy as separate services on Railway.

## Status

In active development. Build progress tracked per build-order step in commit history.
