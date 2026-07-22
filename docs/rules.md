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
  reuse.
- This is a re-platforming, not a feature cut or a redesign of the UX.
- **Exception: camera-based scan-to-PDF was deliberately removed.** Normal
  PDF upload (`<input type="file" accept="application/pdf">`) is the only
  upload path. It must still correctly handle scanned/photographed PDFs a
  user already has as a file (Gemini reads these natively via inline PDF
  data, same as a digitally-typed PDF) -- what's gone is the in-browser
  camera capture/crop/staging UI, not support for scanned *documents*.

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

## 7. (removed) Scan staging is fully client-side until compile

This section described the now-removed camera-based scan-to-PDF staging
screen (capture/edge-detect/crop/reorder/compile) and its performance
requirements. Camera-based scanning was deliberately removed in full --
see rules.md #4's exception. Kept only as a numbering placeholder so
section references elsewhere in this file don't shift.

## 8. Progress-loss guard is scoped, not global

- The navigation-away confirmation applies only while an upload or
  quiz-generation request is actually in flight. Don't add confirmation
  dialogs to normal idle navigation between screens — that would be
  annoying, not protective.

## 9. Mobile responsiveness is required, not optional

- Every screen must be usable on a phone-width browser viewport without
  horizontal scrolling or unreachable controls. Test at a narrow width
  (e.g. 375px), not just desktop, before considering any screen done.

## 10. generate-quiz errors must be surfaced with real detail

- Originally written about compiled scan PDFs specifically; the scan
  feature is gone (rules.md #4) but the underlying principle applies to
  every generate-quiz failure, not just that one now-removed case.
- Errors from generate-quiz (Gemini rejection, size limits, timeouts,
  malformed/incomplete Gemini responses) must be surfaced to the client
  with enough real detail to distinguish the actual cause — never collapse
  a specific failure into a generic "something went wrong."
- A raw platform-level failure (no JSON body at all -- the request never
  reached our own try/catch) is a different case from a handled failure
  inside it; the client-side fallback (apiClient.js) must not describe
  both with identical wording, since that makes the two indistinguishable
  from the UI alone.