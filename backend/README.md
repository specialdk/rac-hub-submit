# RAC Hub Submit — Backend

Node.js + Express service. Validates PINs, accepts submissions, writes to Google Drive, reads/writes the IntranetControl Sheet, sends notification emails.

Stateless. No database. All persistent data lives in Google Drive (submission folders, images) and the IntranetControl Sheet (rows).

## Tech

- Node.js ≥ 20 (uses ES modules and the built-in `node:test` runner)
- Express
- `googleapis` for Sheets + Drive
- `multer` for multipart uploads
- `express-rate-limit` for `/auth` brute-force protection
- `resend` for email
- No TypeScript, no build step

## Setup (local)

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in values:
   ```bash
   cp .env.example .env
   ```

   The two essentials for `/auth` are:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — base64-encoded contents of the service account JSON file
   - `INTRANET_CONTROL_SHEET_ID` — the spreadsheet ID from the Sheet's URL

   Encode the service account JSON like so:
   ```bash
   # macOS/Linux
   base64 -i path/to/service-account.json | tr -d '\n'

   # Windows PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\service-account.json"))
   ```

   Paste the resulting single-line string as the value of `GOOGLE_SERVICE_ACCOUNT_JSON`.

3. Make sure the service account email has been **shared on the IntranetControl Sheet** (Viewer is enough for `/auth`).

4. Run:
   ```bash
   npm run dev    # restarts on file changes
   # or
   npm start      # one-shot
   ```

   The server listens on `PORT` (default 3000).

## Tests

Pure-logic unit tests run with `node:test`:

```bash
npm test
```

Tests cover the PIN lookup logic against synthetic Users tab rows. They don't hit the real Sheet — that's tested manually with curl below.

## Endpoints

### `GET /health`
Liveness check. Returns `{ ok: true }`.

```bash
curl http://localhost:3000/health
```

### `POST /auth`
Validates a PIN against the Users tab.

**Request:**
```json
{ "pin": "1234" }
```

**Success — 200:**
```json
{ "ok": true, "name": "Rachael Schofield", "email": "rachael@rac.com", "role": "User" }
```

**Failure — 401:**
```json
{ "ok": false, "error": "INVALID_PIN" }
```

**Inactive user — 403:**
```json
{ "ok": false, "error": "INACTIVE_USER" }
```

**Rate-limited — 429:**
```json
{ "ok": false, "error": "RATE_LIMITED" }
```
(5 attempts per IP per minute)

**curl examples:**
```bash
# happy path
curl -X POST http://localhost:3000/auth \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234"}'

# wrong PIN
curl -i -X POST http://localhost:3000/auth \
  -H "Content-Type: application/json" \
  -d '{"pin":"9999"}'

# malformed (non-numeric)
curl -i -X POST http://localhost:3000/auth \
  -H "Content-Type: application/json" \
  -d '{"pin":"abc"}'
```

### `POST /submit`
Validates a submission, writes a folder + `submission.json` + image files to the watched Drive folder.

**Required env vars:** `INTRANET_CONTROL_SHEET_ID`, `DRIVE_SUBMISSIONS_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

**Request:** `multipart/form-data` with these fields:

| Field | Required | Notes |
|-------|----------|-------|
| `pin` | yes | numeric string |
| `destination` | yes | one of `General`, `CEO Messages`, `Business Messages`, `Operations Messages`, `Community Messages`, `Safety Messages` |
| `text` | yes | 10–1000 chars (post-trim) |
| `submitted_at` | yes | ISO 8601 string with TZ offset, e.g. `2026-04-27T14:32:11+09:30` |
| `title_suggestion` | no | optional title; `null` in JSON if absent |
| `highlight_suggestion` | no | optional highlight; `null` in JSON if absent |
| `banner` (file) | yes | banner image — JPEG/PNG/WebP |
| `body_1`, `body_2`, … `body_10` (files) | no | body images, ordered by field name |

Total upload (banner + bodies) capped at **20 MB**.

**Success — 200:**
```json
{ "ok": true, "folder_name": "2026-04-27_14-32_rachael-schofield" }
```

**Failures (per contract §6):**

| HTTP | Error code |
|------|-----------|
| 401 | `INVALID_PIN` |
| 403 | `INACTIVE_USER` |
| 400 | `INVALID_DESTINATION`, `TEXT_LENGTH`, `INVALID_SUBMITTED_AT`, `BANNER_REQUIRED`, `BANNER_FORMAT`, `BODY_FORMAT` |
| 413 | `UPLOAD_TOO_LARGE` |
| 500 | `INTERNAL_ERROR` |

**curl examples:**
```bash
# happy path: a banner only
curl -X POST http://localhost:3000/submit \
  -F "pin=1234" \
  -F "destination=General" \
  -F "text=Last week, the team did something worth telling the Hub about." \
  -F "submitted_at=2026-04-27T14:32:11+09:30" \
  -F "banner=@/path/to/banner.jpg"

# with two body images
curl -X POST http://localhost:3000/submit \
  -F "pin=1234" \
  -F "destination=General" \
  -F "text=A great story about something happening on country." \
  -F "submitted_at=2026-04-27T14:32:11+09:30" \
  -F "banner=@/path/to/banner.jpg" \
  -F "body_1=@/path/to/body1.jpg" \
  -F "body_2=@/path/to/body2.jpg"

# with explicit title and highlight
curl -X POST http://localhost:3000/submit \
  -F "pin=1234" \
  -F "destination=Safety Messages" \
  -F "text=Toolbox talk on how to manage scaffolding properly." \
  -F "submitted_at=2026-04-27T14:32:11+09:30" \
  -F "title_suggestion=Scaffolding 101" \
  -F "highlight_suggestion=Stay safe up high" \
  -F "banner=@/path/to/banner.jpg"
```

**Folder layout written to Drive (per contract §3):**
```
{DRIVE_SUBMISSIONS_FOLDER_ID}/
  2026-04-27_14-32_rachael-schofield/
    submission.json
    banner.jpg
    body-1.jpg
    body-2.jpg
```

If a submitter submits twice in the same minute, the second folder gets `_2` appended (`_3`, `_4`, … as needed).

## Sheet schema dependency

The Users tab column layout this code reads is documented in the project's memory file `project_users_tab_schema.md`. The relevant columns are:

| Column | Field | Used as |
|--------|-------|---------|
| B | FullName | `name` in response |
| E | AccessLevel | `role` (`Admin` or `User`) |
| F | Active | Auth refused if not `"TRUE"` |
| L | PIN | Lookup key |
| M | Email | `email` in response (may be empty) |

Range read: `Users!A:M`.

## Deployment

Deployed to Railway. Railway picks up `npm start` automatically. Set all `.env.example` values as Railway environment variables.

## File layout

```
backend/
├── server.js           Express app bootstrap, CORS, route mount, listen
├── routes-auth.js      POST /auth handler with rate limiter
├── routes-submit.js    POST /submit handler with multer + Drive writes
├── auth.js             Pure findUserByPin logic (testable, no I/O)
├── submit.js           Pure submission helpers: hash, slug, folder name,
│                       image-type detection, JSON construction (testable)
├── google-client.js    Service account → Sheets/Drive client factories
├── package.json
├── .env.example
└── test/
    ├── auth.test.js    node:test unit tests for findUserByPin
    └── submit.test.js  node:test unit tests for submit helpers
```
