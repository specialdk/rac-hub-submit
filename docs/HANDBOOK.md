# RAC Hub Submit — Handbook

Master overview of the product, the technical architecture, and the day-to-day standard operating procedures. Keep this in sync as the system evolves — it's the document a new admin or developer should be handed first.

For component-level deep-dives, see:

- [`README.md`](../README.md) — top-level orientation
- [`backend/README.md`](../backend/README.md) — Express API reference (most detailed)
- [`pwa/README.md`](../pwa/README.md) — phone-first PWA notes
- [`../rac-hub-intranet-post-runner/README.md`](https://github.com/specialdk/rac-hub-intranet-post-runner) — Python skill runner
- [`docs/rac-hub-submit-contract.txt`](rac-hub-submit-contract.txt) — original API/data contracts (historical reference)

---

## 1. The Product

### What it is

A phone-first submission and review system that lets RAC staff publish stories to the RAC Hub intranet without touching Google Sheets or the Hub's editing interface directly.

A submitter (anyone with an active staff account) opens the PWA on their phone, dictates or types a short story, snaps a few photos, and taps Submit. Within ~15 minutes an editorial pass runs (Claude cleans the text, generates a title and highlight if blank), the story lands in a "Waiting Approval" row in the IntranetControl Google Sheet, and an admin gets a push + email to review it. The admin reads a faithful preview of how it'll appear on the live Hub, then taps Approve, Reject (with reason), or Edit. Approval flips the row's Status to Approved — the Hub picks it up on its next render and it goes live. The submitter gets a push back letting them know.

### Who uses it

- **Submitters** — every active staff member listed in the IntranetControl `Users` tab. They submit stories, see their submissions in My Stories with status, and (since v1.5) can subscribe to push notifications about review outcomes.
- **Admins** — staff with `AccessLevel = Admin` on the `Users` tab. Same submitter capabilities plus access to the Review queue, the ability to Approve / Reject / Edit, and admin-side push notifications when new submissions arrive.

### Why it exists

The pre-existing flow required staff to write directly into Google Sheets, navigate column layouts, paste image URLs from Drive, and self-publish without review. In practice almost no one did this — only a couple of people were comfortable with the sheet, and they became a bottleneck. Stories sat in heads, on phones, in Slack DMs.

The PWA removes the sheet from the submitter's loop entirely (they never see it), adds editorial polish (filler removal, title generation), keeps a human in the loop for tone/safety review (the admin), and uses the phone as the primary surface — which is where the photos already live and where dictation works.

### Key features (as of v1.5)

| Feature | Surface | Notes |
|---|---|---|
| PIN sign-in | PWA sign-in screen | 4-6 digit PIN, hashed with SHA-256 in the sheet, rate-limited |
| Story submission | PWA submit screen | Destination dropdown (General + 5 Manager Messages), 10-1000 char body, banner + up to 9 body photos, dictation via Web Speech API |
| Submitter preview | PWA preview screen | Faithful render of how the story will appear on the Hub before submit — saves admin round-trips for typos |
| Auto-cleanup + AdminNote | Runner (background) | Claude Opus 4.7 removes fillers, swears, stutters, adds paragraph breaks; counters fed into a human-readable AdminNote on the row |
| Title + highlight generation | Runner (background) | If submitter left them blank, Claude generates them based on real published RAC titles |
| My Stories | PWA | List of own submissions with banner thumbnail, friendly status labels, tap-through to a faithful preview, Show older for >10 |
| Self-mode story view | PWA review screen, mode='self' | Same render as admin review but no controls; shows "Awaiting review" or "Not published + reason" banners |
| Admin Review queue | PWA queue screen | Live count badge on submit screen polling every 30s, full list with destination + submitter + date |
| Faithful preview | PWA review screen | Replicates the live Hub modal exactly — terracotta header, carousel, body, key highlights card, Approve/Reject/Edit footer |
| Admin Edit | PWA review screen, edit mode | In-place editing of title/highlight/text without flipping status |
| Approve / Reject | PWA review screen | Status flip, optional rejection reason saved to AdminNote |
| Notify-by-email | Resend | Admin email when new submission lands |
| Push notifications | Web Push (VAPID) | Admin-side: new pending. Submitter-side: approved / rejected. Tap → deep-link |
| Deep links | URL params | `?review=` (admin) and `?my-story=` (submitter) — used by emails and pushes |
| Auto-quarantine | Runner | Claude refusals quarantine immediately; malformed submissions quarantine immediately; transient errors retry indefinitely with a 5-cycle warning |

---

## 2. Technical Architecture

### Component diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          USER'S PHONE (or laptop)                          │
│                                                                            │
│   ┌──────────────────────┐                                                 │
│   │   PWA (vanilla JS)   │  Installed via Add-to-Home-Screen on Android    │
│   │   served from Railway│  Service worker handles push + notification tap │
│   └──────────────┬───────┘                                                 │
└──────────────────┼─────────────────────────────────────────────────────────┘
                   │ HTTPS
                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              RAILWAY (cloud)                               │
│                                                                            │
│   ┌──────────────────────┐         ┌──────────────────────┐                │
│   │   Express backend    │────────▶│   Resend (email)     │                │
│   │   Node.js 20+        │         └──────────────────────┘                │
│   │   /auth, /submit,    │         ┌──────────────────────┐                │
│   │   /admin/*, /skill/*,│────────▶│   web-push (VAPID)   │                │
│   │   /push/*, /my-*     │         └──────────────────────┘                │
│   └──────┬───────────────┘                                                 │
└──────────┼─────────────────────────────────────────────────────────────────┘
           │ Google API (Sheets read/write, Drive read/write)
           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              GOOGLE WORKSPACE                              │
│                                                                            │
│   ┌──────────────────────┐         ┌──────────────────────────────────┐    │
│   │ IntranetControl      │         │ Drive: Submissions/, Photos/,    │    │
│   │ Sheet                │         │ Processed/, Quarantine/          │    │
│   │ Users, Modal Stories,│         │                                  │    │
│   │ {N} Messages tabs,   │         │ One folder per submission with   │    │
│   │ Hero Content,        │         │ submission.json + image files.   │    │
│   │ PushSubscriptions    │         │ Owned by Duane's personal Drive  │    │
│   │                      │         │ via OAuth refresh token.         │    │
│   └──────────────────────┘         └──────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
                   ▲
                   │ Polls /skill/pending every 15 min via Task Scheduler
                   │
┌──────────────────┴─────────────────────────────────────────────────────────┐
│                   LOCAL LAPTOP (Duane's, runs 8-5 weekdays)                │
│                                                                            │
│   ┌──────────────────────┐         ┌──────────────────────┐                │
│   │ Python skill runner  │────────▶│ Anthropic API        │                │
│   │ Windows Task         │         │ (Claude Opus 4.7,    │                │
│   │ Scheduler 15-min     │         │ structured outputs)  │                │
│   │ trigger              │         └──────────────────────┘                │
│   └──────────────────────┘                                                 │
└────────────────────────────────────────────────────────────────────────────┘
                                                                          
                                                                          
                   ▲
                   │ Reads Modal Stories, Hero Content
                   │
                   │
┌──────────────────┴─────────────────────────────────────────────────────────┐
│             RAC HUB INTRANET (separate codebase, not in scope)             │
│             Renders approved rows. Status field controls visibility.       │
└────────────────────────────────────────────────────────────────────────────┘
```

### Tech stack

| Layer | Tech | Why |
|---|---|---|
| PWA | Vanilla HTML/JS/CSS, no framework | Phone-first, fast load, no build step on Railway |
| PWA install | Web App Manifest + service worker | Add-to-Home-Screen produces a "WebAPK" on Android — gives the app real notification permissions and a home-screen icon |
| Backend | Node.js 20+, Express | Standard, well-supported, Railway-friendly |
| Auth | SHA-256 of PIN against Users tab | Simple, no JWT, no passwords. PIN length range is configurable (`PIN_LENGTH_MIN`/`MAX`) |
| Storage (data) | Google Sheets via service account | The Hub already reads from this sheet — no separate database needed |
| Storage (files) | Google Drive via OAuth refresh token | Service account has no quota in personal Drives, so OAuth was required for write |
| Image upload | multer (multipart) → Drive | Banner + up to 10 body images per submission |
| Email | Resend | Cheap, reliable, no SMTP setup |
| Push | Web Push API + VAPID | First-party, no Firebase Cloud Messaging account needed (FCM is the underlying transport but we don't use Google's API directly) |
| LLM | Anthropic API (Claude Opus 4.7) | Editorial nuance — handles Yolŋu words, Aboriginal English, reported speech without "improving" them away |
| Structured outputs | Pydantic + `messages.parse()` | Guaranteed shape for cleaning counters, generated titles, highlights |
| Prompt caching | `cache_control: ephemeral` on system prefix | Reference material is large (~30KB across cleaning rules + voice guide + examples) and stable — cache hit saves ~90% on input cost from the second submission's call onward |
| Runner trigger | Windows Task Scheduler, 15 min | Free, runs on Duane's laptop, simple to debug |
| Deployment | Railway (PWA + backend) | Auto-deploy on push to `main`, environment variable management, free tier sufficient |

### Repos

| Repo | Contains | Deploys to |
|---|---|---|
| `rac-hub-submit` | Backend, PWA, docs | Railway (auto on push to main) |
| `rac-hub-intranet-post-runner` | Python skill runner, scheduled-task scripts | Local laptop (manual `git pull` to update) |

### Data: the IntranetControl Google Sheet

This is the system's source of truth. Anything the Hub reads, anything the runner or backend writes, lives here.

| Tab | Purpose | Written by |
|---|---|---|
| `Users` | Account list. Cols: A=Username, B=FullName, C=Department, D=Role (job role/title), E=AccessLevel (User/Admin), F=Active (TRUE/FALSE), L=PIN, M=Email | Manual (or HR) |
| `Modal Stories` | "General" destination submissions. Cols A-K incl. PhotoTitles | Backend (`/skill/process`) |
| `Hero Content` | Mirror entries for General submissions. Title + subtitle render in the Hub's hero carousel | Backend (`/skill/process`); status flips with `/admin/approve` |
| `CEO Messages`, `Business Messages`, `Operations Messages`, `Community Messages`, `Safety Messages` | Manager destinations. Cols A-J | Backend (`/skill/process`) |
| `PushSubscriptions` | Cols A=Username, B=Endpoint, C=P256DH, D=Auth, E=UserAgent, F=SubscribedAt | Backend (`/push/subscribe`) — auto-pruned on 410/404 |

Status field uses three string literals: `Waiting Approval`, `Approved`, `Archived`. These are exact-match — no trimming, no case folding. Don't edit them by hand unless you know what you're doing; misspellings (like the historical `Achived`) cause silent rendering issues.

### Drive folders

Owned by Duane's personal Drive via OAuth refresh token in `GOOGLE_OAUTH_REFRESH_TOKEN`. Service account has read-only on these (it's used by the backend to enumerate folders during `/skill/pending`).

| Folder | Purpose |
|---|---|
| `Submissions/` | New submissions land here. One folder per submission named `{date}_{time}_{user-slug}` containing `submission.json` + image files. Runner polls this. |
| `Processed/` | Where successfully-handled submission folders end up. Idempotent — once moved, the runner won't see them on `/skill/pending` again. |
| `Quarantine/` | Where folders end up when something goes wrong: malformed JSON, Claude refusal, validation failure on `/skill/process`. Admin reviews these manually. |
| `Photos/` | Optional / historical. Not actively used by the current pipeline. |

Folder IDs are configured via `DRIVE_*_FOLDER_ID` env vars on Railway.

### Environment variables

The full list is documented in `backend/README.md` and the `.env.example` files. Key categories:

- **Google**: `GOOGLE_SERVICE_ACCOUNT_JSON` (base64), `GOOGLE_OAUTH_*` (client + refresh token for Drive writes), `GOOGLE_PICKER_API_KEY`, `INTRANET_CONTROL_SHEET_ID`, `DRIVE_*_FOLDER_ID`
- **Email**: `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL`
- **Push**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:specialdk55@gmail.com`)
- **Skill IPC**: `SKILL_NOTIFY_SECRET` (shared secret between runner and backend for `/admin/notify`)
- **Anthropic** (runner only): `ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL`, `CLAUDE_MAX_TOKENS`
- **Misc**: `PIN_LENGTH_MIN`, `PIN_LENGTH_MAX`, `ALLOWED_ORIGIN`, `PWA_URL`, `BACKEND_URL`

Never commit any of these. Local: each project has its own `.env`. Production: set in Railway → service → Variables. Runner: `.env` in the runner directory on Duane's laptop.

---

## 3. The Story Lifecycle (end-to-end)

### Happy path

```
T+0     User opens PWA on their phone, signs in with PIN, submits a story
        with destination + body + 1-10 photos.

T+0     PWA POSTs to /submit. Backend:
        - validates PIN, body length, photo formats
        - resizes nothing (PWA does that client-side)
        - creates a Drive folder Submissions/{date}_{time}_{slug}
        - uploads photos, writes submission.json with title_suggestion +
          highlight_suggestion + leader_photo_filename
        - returns OK to PWA
        - PWA shows Thanks screen with View My Stories link

T+0..15 Runner is idle (between scheduled triggers).

T+15    Task Scheduler fires the runner on Duane's laptop.
        Runner:
        - GET /skill/pending → list of folders under Submissions/
        - For each: fetch submission.json, call Claude to clean text +
          generate title/highlight if blank
        - POST /skill/process → backend writes to the sheet, returns
          {destination, row_number}
        - POST /admin/notify → email goes to admin via Resend, push
          goes to all subscribed admins
        - Move folder Submissions/ → Processed/

T+15    Admin gets push: "New story to review — '{title}' by {name}"
        and an email at the same address.

T+...   Admin taps push (or email link). PWA opens at /?review={dest}&row={n}.
        Boot reads URL params, fetches /admin/submission, renders the
        review screen with carousel, title, body, highlight, meta card,
        and Approve/Reject/Edit footer.

        Admin can:
          - Approve   → POST /admin/approve, status flips to Approved.
                        For General destinations the Hero Content row is
                        also flipped. Submitter gets push: "Story
                        approved 🎉".
          - Reject    → opens reject-reason form, POST /admin/reject with
                        the reason. Status flips to Archived, reason
                        written to AdminNote. Submitter gets push:
                        "Story not published — {reason}".
          - Edit      → opens edit form for title/highlight/text. POST
                        /admin/edit overwrites those columns. Status
                        STAYS at Waiting Approval — admin must Approve
                        afterwards. For General, Hero Content's title +
                        subtitle mirror.

T+...   Hub picks up the row on next render (it filters by Status =
        Approved). Story goes live.

T+...   Submitter (also subscribed to push) gets the approval push.
        Tap → /?my-story={dest}&row={n} opens My Stories detail.
```

### Sad paths

| Failure | What happens |
|---|---|
| Submitter wrong PIN 3+ times | `/auth` rate-limits per IP for ~1 minute |
| `submission.json` malformed | Backend's `/skill/pending` returns it with an `error` field; runner quarantines on first sight |
| Claude refuses (safety classifier) | Runner catches `ClaudeRefusalError`, quarantines on first sight (deterministic — retrying never helps) |
| Anthropic API rate limit / network blip | Runner classifies as transient, retries on next run, increments failure counter. After 5 consecutive failures → log warning, but never auto-quarantines (admin call) |
| Backend `/skill/process` returns validation error | Runner catches `PermanentBackendError`, quarantines |
| Backend unreachable | Runner classifies as transient, log + skip, retry on next run |
| Admin tries to Approve a row that's already Approved | Backend returns 409 NOT_PENDING, PWA shows toast |
| Submitter offline at submit time | PWA shows "Could not reach the server" — submission is lost (no offline queueing in v1) |
| Push fails (FCM 410 Gone) | `send-push.js` auto-prunes the subscription row from the sheet |
| Push fails (other) | `send-push.js` logs `push.send` event with the FCM status code + body. Admin can grep Railway logs |
| Two submissions in one runner cycle | Both get processed sequentially. Both fire admin push, but the stable `pending` tag means only the latest shows in the shade. Both get separate emails. |

### Timing

- Sheet read for queue/list endpoints: ~300-800ms (single batchGet)
- Submit (without photos): ~1-2s
- Submit with photos (~5MB total): ~5-15s depending on phone's connection
- Runner cycle (1 pending, fresh prompt cache): ~10-15s
- Runner cycle (1 pending, warm prompt cache, 2nd+ in same run): ~3-5s
- Push delivery (FCM): ~100ms-2s typical, occasionally up to 1 minute
- Hub render delay: depends on the Hub's polling — typically <60s

---

## 4. Standard Operating Procedures

### 4.1 Onboarding a new staff member

1. Open the IntranetControl sheet → `Users` tab
2. Add a new row with:
   - **A: Username** — short slug (e.g. `jsmith`)
   - **B: FullName** — exactly as it should appear in submissions (e.g. "Jane Smith") and notifications
   - **C: Department** — for reference / future filtering
   - **D: Role** — job title (free text, not used by auth)
   - **E: AccessLevel** — `User` or `Admin`
   - **F: Active** — `TRUE`
   - **L: PIN** — pick a 4-6 digit PIN that they'll memorise (or let them choose). The cell stores the **plaintext** PIN; auth checks `SHA-256(submitted) == SHA-256(stored)` server-side. (Future: pre-hash if security posture changes.)
   - **M: Email** — for admin notifications (admins only) and any future submitter emails
3. Tell them the PIN in person or via Signal — never email it
4. Send them the PWA URL (`https://rac-pwa.up.railway.app`) and ask them to:
   - Open in Chrome
   - Tap menu → Add to Home screen / Install app (so they get a real WebAPK and proper notifications)
   - Sign in with their PIN

### 4.2 Daily admin operations

1. **Check the badge.** When you open the PWA, the Submit screen shows a count badge if there's anything in the Review queue. If you've got push enabled, you'll have already seen the notifications anyway.
2. **Tap Review queue.** Stories arrive sorted oldest-first (longest waiting at the top).
3. **Tap a story.** You see a faithful preview of how it'll look on the live Hub.
4. **Read.** Look for transcription errors (proper names, acronyms) — dictation is great but imperfect. Look for tone, completeness, photo selection.
5. **Decide:**
   - **Approve** → goes live within ~1 min on the Hub.
   - **Edit** → fix typos / tighten copy / fix transcription errors. Save. The story stays in Waiting Approval — you have to Approve as a separate step. This is intentional: edit + approve in two steps lets you re-read after editing.
   - **Reject** → write a brief reason (it's saved to AdminNote and visible to the submitter in their My Stories). Avoid "rejection" language — frame as "needs more work" / "let's chat".
6. **Move on.** Empty queue = done.

The runner runs every 15 min, so in a typical workday you'll get ~1-3 batches of submissions to review.

### 4.3 Reviewing rejected stories

Submitters see their rejected stories in My Stories with a "Not published" banner and the AdminNote. There's no resubmit button (yet) — they need to submit a fresh story. The original folder is in `Quarantine/` (if Claude refused it) or just an Archived row in the sheet (if you Rejected it).

### 4.4 When the runner stops processing

Symptoms: no new pushes/emails for >30 min during a workday despite submissions arriving.

**Diagnostic steps**:

1. **Check the laptop.** Is it on? Logged in? The runner only fires while a user is logged in (LogonType: Interactive in `register-task.ps1`).
2. **Check Task Scheduler.**
   ```powershell
   Get-ScheduledTaskInfo -TaskName 'rac-hub-intranet-post-runner' | Select LastRunTime, LastTaskResult, NextRunTime
   ```
   - `LastRunTime` should be within the last 15 min
   - `LastTaskResult` should be `0` (success). Anything else = failure
   - `NextRunTime` should be within the next 15 min
3. **Check today's runner log.**
   ```powershell
   Get-Content "C:\Users\speci\OneDrive\RAC-Projects\rac-hub-intranet-post-runner\logs\$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 30
   ```
   - `empty run` lines = working, just nothing to do
   - `WARNING:` = a folder has been failing transiently for 5+ runs. Read the message — typically network or rate-limit related; will recover on its own
   - `ERROR:` = something needs investigation
4. **Re-register the task** if its state looks weird:
   ```powershell
   cd C:\Users\speci\OneDrive\RAC-Projects\rac-hub-intranet-post-runner
   .\register-task.ps1
   ```
5. **Force a manual run** to confirm the code path works:
   ```powershell
   Start-ScheduledTask -TaskName 'rac-hub-intranet-post-runner'
   ```
   then check the log.

### 4.5 When the backend is down

Symptoms: PWA shows "Could not reach the server" on sign-in or submit. Runner's log shows transient backend errors.

1. **Railway dashboard** → backend service → Deployments. Check the latest deploy succeeded. Look for crash loops.
2. **Health endpoint**: `curl https://rac-backend.up.railway.app/health` should return `{"ok":true}`
3. **Check Railway logs** for the latest deployment — look for unhandled exceptions.
4. **If recently deployed code is the cause**: revert via `git revert` + push, Railway redeploys.
5. **If Railway itself is down**: nothing to do but wait. Submissions during downtime are lost (PWA shows error to submitter). The runner will catch up once the backend is back — Drive folders persist.

### 4.6 When push notifications stop working

1. **Identify scope.** Is it just one device or everyone?
2. **One device** — usually phone-side. Check:
   - Is the WebAPK still installed (not just a Chrome tab)?
   - Has notification permission been revoked? Phone Settings → Apps → RAC Hub → Notifications.
   - Battery optimisation interfering? (Huawei especially — see commit history for the saga.)
   - In the PWA: Settings/Toggle → Turn Off, then Turn On to re-subscribe (the old endpoint may have rotated).
3. **Everyone** — backend or VAPID side. Use the diagnostic endpoint:
   - On a phone with the PWA installed and signed in, tap **Send test notification** in My Stories
   - Read the toast:
     - "Sent to N devices" + nothing arrives → OS-side suppression (notification settings, battery)
     - "Send failed — no status: VAPID env vars not set on server" → at least one of `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` is missing on Railway
     - "Send failed — 401: ..." → VAPID JWT signing failed (private key wrong)
     - "Send failed — 403: ..." → VAPID subject malformed (must be `mailto:...` or a URL)
     - "No subscriptions found" → the Username on the row in `PushSubscriptions` doesn't match the FullName the row uses. Check the sheet.
4. **Check Railway logs** for `push.trigger` and `push.send` JSON lines:
   ```
   {"event":"push.trigger","source":"/admin/approve","submittedBy":"...","destination":"...","row_number":N}
   {"event":"push.send","target":"...","subs":N,"sent":N,"failed":N,"pruned":N,...}
   ```

### 4.7 Quarantine maintenance

Open `Quarantine/` in Drive periodically (weekly is fine). Each folder has a `submission.json` you can read.

- **Folders that quarantined for "Claude refused cleaning"** — this is usually a content-classifier false positive. Read the body. If legitimate, drag the folder back to `Submissions/` and the next runner pass will re-process. If genuinely problematic, leave it where it is or delete.
- **Folders that quarantined for "malformed submission.json"** — usually a backend bug or a partial upload. If recent, may be worth investigating; if old, delete.
- **Folders that quarantined for backend validation errors** — same: read, decide.

The runner doesn't auto-clean Quarantine. It grows monotonically until you tidy.

### 4.8 PIN management

- **Resetting a PIN** — edit the cell in the Users tab. Tell the user the new PIN in person.
- **Deactivating an account** — set `Active = FALSE`. They can't sign in. Their existing submissions stay in the sheet untouched.
- **Promoting to Admin** — set `AccessLevel = Admin`. They'll see the Review queue button on their Submit screen the next time they refresh the PWA.

### 4.9 VAPID key rotation

If you ever suspect a VAPID private key is compromised:

1. Generate a new pair: `npx web-push generate-vapid-keys`
2. Update `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in Railway. Keep `VAPID_SUBJECT` the same.
3. Railway redeploys.
4. **All existing subscriptions become invalid.** Every user has to tap Turn Off → Turn On in the PWA to re-subscribe with the new public key. The old `PushSubscriptions` rows will get pruned on next push attempt (FCM returns 401/410 once the key changes).
5. Communicate this in advance — staff need to know they'll have to re-enable.

### 4.10 Sheet hygiene

- **Don't delete rows** in Modal Stories or Manager tabs. ContentNumber is append-only — gaps would break the Hub's expected ordering, and the runner uses `MAX(existing) + 1` to assign new ones.
- **Don't reorder rows.** Same reason.
- **DO archive old rows** by moving entire tabs to a backup sheet at year-end if storage becomes a concern. The Hub queries by Status = Approved; Archived rows are safe to leave in place.
- **PushSubscriptions can be edited freely.** Deleting a row just means that device won't get pushes until the user re-subscribes. Adding a row by hand won't work — endpoints rotate, and you don't know the encryption keys.

---

## 5. Useful References

### Production URLs

- PWA: `https://rac-pwa.up.railway.app`
- Backend: `https://rac-backend.up.railway.app`
- Health: `https://rac-backend.up.railway.app/health`

### External services

| Service | What for | Login |
|---|---|---|
| Railway | PWA + backend hosting | duane's account |
| Resend | Transactional email | duane's account |
| Anthropic | Claude API | duane's account |
| Google Cloud | Service account + OAuth client | duane's RAC project |
| Google Workspace | IntranetControl sheet + Drive folders | RAC tenancy |

### Runbook quick links

- Force a runner cycle: `Start-ScheduledTask -TaskName 'rac-hub-intranet-post-runner'`
- Check today's runner log: `Get-Content ".\logs\$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 30`
- Diagnose push: PWA → My Stories → Send test notification (read the toast)
- Backend health: `curl https://rac-backend.up.railway.app/health`
- Re-register scheduler: `cd ...\rac-hub-intranet-post-runner; .\register-task.ps1`

### When to call for help

This system is designed to be operable by one person, but a few situations warrant a developer's eye:

- Backend deploys failing repeatedly on Railway
- Runner crashing immediately on start (rather than running and skipping)
- Sheet-writing errors that don't recover after a backend restart
- The Hub stops rendering newly-Approved stories (this is a Hub-side issue, not Submit-side)

For those, the relevant repos and their commit histories are the documentation of last resort.

---

*Last updated: 2026-05-01*  
*Maintained alongside the codebase — keep this current as features land.*
