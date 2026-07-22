# rules.md — Binding Constraints

## 1. Secret handling (critical, mirrors the Calcuduko service-role-key rule)

- `GEMINI_API_KEY` and Supabase's **service role key** are set only in
  Vercel's project environment variables (dashboard, or `vercel env` CLI),
  never committed, never in a `.env` file that isn't gitignored, and
  **never** in a variable prefixed `VITE_` — Vite inlines any `VITE_*`
  variable directly into the JS bundle shipped to every visitor's browser.
- If a Supabase **anon key** is used at all client-side, it must only ever
  reach tables/buckets that have Row Level Security policies explicitly
  reviewed for this — but the default design in this app (see
  architecture.md) routes ALL Supabase access through Vercel serverless
  functions using the service role key server-side, so the client never
  talks to Supabase directly at all. Don't deviate from that without
  discussing the RLS implications first.
- Never log either key, never include it in an error message returned to
  the client.

## 2. No server-side filesystem persistence

- Vercel serverless functions do not have reliable persistent disk across
  invocations. Do not write history/PDF data to local files and expect
  them to survive between requests — this will silently lose data in
  production even if it appears to work in local dev.
- All persistence goes through Supabase: structured data (history entries,
  metadata) in Postgres tables, PDF binary files in Supabase Storage.

## 3. Access gate (recommended, since the URL is now public)

- A simple shared-password check (e.g. a password field on first load,
  checked against an env var server-side, returning a token) is enough for
  a single-user app — this does not need full auth (no Supabase Auth, no
  user accounts). Keep it lightweight.
- This exists specifically to stop a stranger who stumbles on the deployed
  URL from generating quizzes against Bambyy's Gemini quota — not to
  protect sensitive data.
- **Sessions are per-tab and per-device, not global.** The token lives in
  `sessionStorage`, so closing a tab/browser ends that session and
  requires re-entering the password next time. This must NOT prevent
  logging in from a different device or browser at the same time — there
  is no server-side "single active session" concept to enforce. Multiple
  devices logged in simultaneously is expected and correct behavior.

## 4. Feature parity with the mobile version is required

- Every feature from the earlier mobile app must work here: multi-PDF
  upload with duplicate detection (Replace/Use Existing/Cancel), single-
  question regeneration, resumable unfinished quizzes (same-id overwrite,
  not duplicate), weak spots aggregation, analytics, and Previous Files
  reuse. Camera-based scanning was later removed (see section 7) — its
  replacement requirement is that normal PDF upload correctly handles
  scanned/photographed content, not that scanning itself is preserved.
- This is a re-platforming, not a feature cut or a redesign of the UX.

## 5. Stack consistency with Calcuduko

- Frontend: React + Vite (same as `calcuduko-web`).
- Hosting: Vercel, deployed via GitHub import through the dashboard (same
  workflow already used and proven for Calcuduko) — don't introduce a
  different hosting provider without discussion.
- Backend: Vercel serverless functions (the `api/` folder convention), not
  a separately-hosted server.
- Database/storage: Supabase, same as Calcuduko.

## 6. Local development must still work

- `npm run dev` (via Vite + Vercel's local dev emulation, e.g. `vercel
  dev`) must let Bambyy test the full app locally, including the API
  routes and Supabase calls, before every deploy — mirroring the
  pre-deployment readiness check used for Calcuduko.

## 7. Camera scanning is removed; uploaded PDFs must handle scanned content

- There is no camera capture, edge detection, or scan staging screen
  anymore. Users upload a PDF directly, whether it originated as a
  scanned/photographed document or a typed one — there is no separate
  code path or UI distinction between the two.
- Don't reintroduce OpenCV/edge-detection/staging-screen code without an
  explicit request — this was a deliberate removal, not an oversight.

## 8. Progress-loss guard is scoped, not global

- The navigation-away confirmation applies only while an upload or
  quiz-generation request is actually in flight. Don't add confirmation
  dialogs to normal idle navigation between screens — that would be
  annoying, not protective.

## 9. Mobile responsiveness is required, not optional

- Every screen must be usable on a phone-width browser viewport without
  horizontal scrolling or unreachable controls. Test at a narrow width
  (e.g. 375px), not just desktop, before considering any screen done.

## 10. Any uploaded PDF must actually work in generate-quiz, verified live

- A PDF upload is not "done" until a real generate-quiz call against it
  has been tested and confirmed working end-to-end — archiving the PDF to
  Storage successfully is not sufficient proof by itself.
- Large, image-heavy scanned PDFs (uploaded directly by the user, e.g.
  from their phone's own camera/scanner app) can be significantly bigger
  than typed PDFs of similar page count — the same size/timeout
  considerations that applied to the now-removed camera feature still
  apply here and should not be ignored just because that feature is gone.
- Errors from generate-quiz (Gemini rejection, size limits, timeouts)
  must be surfaced to the client with enough real detail to distinguish
  the actual cause — never collapse a specific failure into a generic
  "something went wrong."

## 11. Page count limit: 100 pages maximum per PDF

- Any single uploaded PDF must not exceed 100 pages. This is a hard cap,
  not a soft warning.
- A PDF over the limit must be rejected with a clear, specific message
  stating the actual page count and the 100-page limit — before any
  Gemini call is attempted, not as a failure discovered partway through
  generation. Wasting a Gemini request on something already known to be
  rejectable is avoidable and should be avoided.
- This check applies per-file. If multiple PDFs are selected together for
  one quiz, each is checked individually against the 100-page limit (this
  rule is about a single document's size, not a combined-total rule
  unless a future requirement says otherwise).
- Scanned/photographed PDFs and digitally-typed PDFs are checked the same
  way — page count, not file size, is the limit here (file size concerns
  are already covered separately under rule 10).

## 12. Rate-limit (per-minute) and daily-quota (per-day) Gemini failures must be distinguished

- Gemini's 429 responses cover two genuinely different situations with
  different recovery times: a per-minute rate limit (clears in roughly a
  minute) and a per-day quota exhaustion (doesn't clear until the daily
  reset, currently around midnight Pacific time). Collapsing both into one
  generic "rate limit or quota exceeded, try again" message is not
  acceptable — the correct guidance to the user is completely different
  depending on which one actually happened.
- Inspect whatever detail Gemini's error response actually provides
  (status/reason codes, retry-after hints, or distinguishing text) to tell
  these apart programmatically where possible, rather than guessing from
  wording alone.
- The retry logic already added for truncation failures must not also
  retry on a 429 of either kind — retrying a rate-limited or quota-
  exhausted request just wastes another attempt against the same wall.
- Log enough detail server-side on every 429 to later determine, from logs
  alone, which of the two situations actually occurred — this matters
  for diagnosing whether the free-tier quota itself is a recurring
  bottleneck independent of any other bug.