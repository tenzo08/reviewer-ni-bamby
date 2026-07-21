# design.md — Screen & Subsystem Detail

## Screens (same set and behavior as the mobile version, ported to web components)

`upload`, `savedPdfs`, `quiz`, `score`, `reviewMissed`, `history`,
`historyDetail`, `weakSpots`, `analytics`. Same 2x2 nav card grid layout,
same resume-quiz flow, same duplicate-file Replace/Use Existing/Cancel
prompt (a modal instead of a native `Alert`, but same three choices and
same logic), same exit-mid-quiz confirmation.

## Access gate

On first load, if no valid session token/cookie is present, show a single
password field ("Enter password to continue"). On submit, `POST
/api/auth-check` verifies it server-side against an env var and, if
correct, sets a signed cookie or returns a token stored in
`localStorage`. Every subsequent `api/*` call includes it; each function
checks it before doing any real work. Keep this genuinely simple — no
username, no registration, no password reset flow.

## API base

Since frontend and API routes deploy together on the same Vercel project,
there's no separate base URL to configure at all (unlike every earlier
version's tunnel-URL problem) — relative paths like `fetch('/api/history')`
just work, in both local dev (`vercel dev` proxies this) and production.
This entirely eliminates the runtime-config/tunnel-URL class of problems
from the mobile versions.

## Scan-to-PDF flow (ported from mobile, browser-based capture)

On the upload screen, a "Scan pages" button next to "Choose PDF(s)":
1. Uses `<input type="file" accept="image/*" capture="environment">` per
   page (mobile browsers open the camera directly; desktop browsers fall
   back to a file picker, which is fine and expected).
2. Repeated captures build a thumbnail list, with remove/reorder controls,
   same UX as the mobile version.
3. Filename prompt, then upload to `/api/scan-to-pdf`.
4. On success, the filename is added to the current upload session's file
   list exactly like a Previous Files pick — immediately usable in
   Generate Quiz, indistinguishable from any other saved PDF afterward.

## API routes (same shapes as every earlier backend version)

- `POST /api/generate-quiz`
- `POST /api/regenerate-question`
- `POST /api/save-quiz-result`
- `GET /api/history`, `GET /api/history/:id`, `DELETE /api/history/:id`,
  `DELETE /api/history`
- `GET /api/weak-spots`
- `GET /api/analytics`
- `GET /api/saved-pdfs`, `DELETE /api/saved-pdfs/:filename`
- `POST /api/scan-to-pdf`
- `POST /api/auth-check`

Same request/response field names as the mobile version's backend — this
is a hosting re-platform, not an API redesign.

## Duplicate detection & resume-quiz logic

Same logic, different storage substrate: duplicate check is "does an
object with this filename already exist in the `saved-pdfs` Supabase
Storage bucket" instead of `fs.existsSync`. Resume-quiz is an `upsert` on
`quiz_history` by `id` instead of overwriting two local files.

## What's intentionally NOT changing

- Visual design, colors, question types, difficulty levels, Bambyy
  branding, and the full feature set (multi-PDF, regenerate question, weak
  spots, analytics, previous-files reuse, scan-to-PDF).
- This is a hosting/architecture change, not a UX or feature redesign.