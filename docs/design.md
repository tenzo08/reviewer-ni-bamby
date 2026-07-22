# design.md — Screen & Subsystem Detail

## Screens (same set and behavior as the mobile version, ported to web components)

`upload`, `savedPdfs`, `quiz`, `score`, `reviewMissed`, `history`,
`historyDetail`, `weakSpots`, `analytics`. Same 2x2 nav card grid layout,
same resume-quiz flow, same duplicate-file Replace/Use Existing/Cancel
prompt (a modal instead of a native `Alert`, but same three choices and
same logic), same exit-mid-quiz confirmation.

## Access gate

On first load, if no valid session token is present, show a single
password field ("Enter password to continue"). On submit, `POST
/api/auth-check` verifies it server-side against an env var and, if
correct, returns a token. Every subsequent `api/*` call includes it; each
function checks it before doing any real work. Keep this genuinely simple
— no username, no registration, no password reset flow.

**Session scope (important):** the token is stored in `sessionStorage`,
not `localStorage`. This means:
- Closing the browser tab/window clears the token — reopening the site in
  that browser requires the password again. This is intentional: a closed
  session should genuinely end, not silently persist forever.
- Each browser/device that logs in gets its own independent token. The
  backend must NOT enforce "only one active session at a time" — there is
  no shared session state to invalidate across devices. Bambyy's phone and
  laptop (or any other device) can be logged in simultaneously, each with
  its own token, and closing one has no effect on the others.
- The token itself should still have a reasonable server-side expiry (e.g.
  a signed token valid for some number of hours) as a secondary safety
  net, independent of the sessionStorage-clears-on-close behavior — these
  are two different protections, not substitutes for each other.

## API base

Since frontend and API routes deploy together on the same Vercel project,
there's no separate base URL to configure at all (unlike every earlier
version's tunnel-URL problem) — relative paths like `fetch('/api/history')`
just work, in both local dev (`vercel dev` proxies this) and production.
This entirely eliminates the runtime-config/tunnel-URL class of problems
from the mobile versions.

## Camera scanning: REMOVED

The camera-based scan-to-PDF feature (capture, edge detection, staging
screen, `/api/scan-to-pdf`) has been removed entirely. See the "PDF
upload must handle scanned documents too" section below for what replaces
it.

## API routes (same shapes as every earlier backend version)

- `POST /api/generate-quiz`
- `POST /api/regenerate-question`
- `POST /api/save-quiz-result`
- `GET /api/history`, `GET /api/history/:id`, `DELETE /api/history/:id`,
  `DELETE /api/history`
- `GET /api/weak-spots`
- `GET /api/analytics`
- `GET /api/saved-pdfs`, `DELETE /api/saved-pdfs/:filename`
- `POST /api/auth-check`

Same request/response field names as the mobile version's backend — this
is a hosting re-platform, not an API redesign.

## Duplicate detection & resume-quiz logic

Same logic, different storage substrate: duplicate check is "does an
object with this filename already exist in the `saved-pdfs` Supabase
Storage bucket" instead of `fs.existsSync`. Resume-quiz is an `upsert` on
`quiz_history` by `id` instead of overwriting two local files.

## History Detail screen behavior (revised)

Two corrections to how an unfinished (`completed: false`) entry is shown:

- **"Resume this quiz" is the first thing visible**, above the question
  list — not scrolled past or buried below other content. For an
  unfinished entry, resuming is the primary action, not an afterthought.
- **Correct answers must NOT be shown for any question the student hasn't
  actually answered yet** (`yourAnswer` is `null`/absent) while the quiz
  is still unfinished. Showing `correctAnswer` for skipped questions on an
  in-progress quiz spoils the answer before the student gets to attempt
  it — this is a real bug, not a display detail. For questions the
  student *did* answer already (even in an unfinished quiz), showing the
  correct answer and explanation is fine, same as normal.
- Once an entry is `completed: true`, this restriction no longer applies
  — every question's correct answer is visible normally, since the
  attempt is over.

## PDF upload must handle scanned documents too (replaces camera scanning)

Since camera scanning is removed, the burden shifts entirely to the
normal upload path: a PDF the user uploads may itself be a scanned
document (produced by a phone's own camera/scanner app, a flatbed
scanner, etc.) rather than a digitally-typed one, and Generate Quiz must
work correctly either way, with no separate code path or user-facing
distinction between the two.

- No new UI is needed for this — it's the existing "Choose PDF(s)" upload
  flow, unchanged. There is no "Scan pages" button anymore.
- Gemini reads PDF pages natively regardless of whether the original
  content was typed text or a photographed page — this already works for
  any uploaded PDF via the existing `inline_data` file part approach in
  `api/_lib/gemini.js`, so no OCR library or separate processing step is
  needed on the backend either.
- What DOES matter: large scanned PDFs (multi-page, image-heavy) can be
  meaningfully bigger than a typical digitally-typed PDF of the same page
  count. The same size/timeout considerations that applied to the removed
  camera-compiled PDFs still apply to any large scanned PDF a user
  uploads directly — don't assume this class of problem went away just
  because the camera capture UI did.

## Navigation/progress-loss guard (new)

Any time a PDF upload or quiz generation is in progress (the loading
state already shown on the upload screen), attempting to navigate away —
tapping a nav card, the browser back button, or closing/reloading the
tab — must show a confirmation ("Uploading/generating is still in
progress. Leaving now will stop it. Continue anyway?") before allowing
the navigation. This applies specifically to the upload-in-progress and
generate-quiz-in-progress states, not to normal idle browsing between
screens.

## Question type selection (expanded)

The existing question-type picker gains a fourth explicit choice. All
four (plus Mixed, which combines any of them) remain user-selectable
exactly as before:

- **Multiple Choice** — unchanged.
- **True or False** — unchanged, a plain true/false statement.
- **Modified True or False** (new) — a true/false statement where, if the
  correct answer is "False," the student must also identify/supply the
  correct term or reason, not just mark it false. The question object
  gains an optional `modifiedAnswer` field for this case (see
  schema.md); when the statement is actually true, this field is absent.
- **Identification** — unchanged.
- **Mixed** — unchanged, may now include Modified True or False as one of
  the mixed types.

## Responsive design (new, applies to every screen)

Every screen must adapt cleanly across viewport sizes — phone browser,
tablet, and desktop — not just "work" at a fixed desktop width. Concretely:
- The 2x2 nav card grid collapses to a single column on narrow viewports.
- The scan staging thumbnail grid reflows based on available width.
- Touch targets (buttons, nav cards) stay comfortably tappable on mobile
  (no relying on hover states for anything essential).
- No horizontal scrolling required anywhere at common phone widths.

## Selective history deletion (new)

The History screen currently only offers "Clear all history" (deletes
every entry via `DELETE /api/history`). This is too blunt — add the
ability to remove specific entries without wiping everything:

- An "Edit" / "Select" toggle on the History screen puts the list into
  selection mode: each entry gets a checkbox (or tap-to-select
  highlighting), instead of tapping an entry immediately opening its
  detail view.
- While in selection mode, a "Delete selected (N)" action appears,
  enabled once at least one entry is checked. Confirms once
  ("Delete N quiz result(s)? This can't be undone.") before calling
  `DELETE /api/history/:id` for each selected entry.
- "Select all" / "Deselect all" convenience toggle while in this mode.
- "Clear all history" remains available separately (still its own
  distinct, more drastic action with its own confirmation wording making
  clear it removes *everything*, not just what's selected) — it is not
  replaced by selective deletion, the two coexist as different levels of
  intent.
- Exiting selection mode (without deleting) returns to normal browsing
  with no changes made.
- Deleting one or more entries must also correctly update anything
  derived from history that's currently loaded in the session (weak
  spots pool, analytics numbers) the next time those screens are opened —
  don't leave stale aggregates referencing deleted entries.

## PDF page count limit (new)

Any PDF is accepted for upload as long as it's 100 pages or fewer —
scanned or digitally-typed, no distinction. A PDF over that limit is
rejected immediately on selection/upload, before any Gemini call:

- The rejection message states the actual page count found and the
  100-page limit, e.g. "This PDF has 142 pages. The maximum is 100 pages
  — please split it or choose a shorter document."
- If checking page count client-side before upload is straightforward
  (e.g. via a lightweight PDF library that can read the page count
  without needing the full file processed), do that for instant feedback.
  Otherwise, a fast server-side check immediately on upload (before
  archiving to Storage or calling Gemini) is acceptable — the requirement
  is "rejected before Gemini is called," not "rejected before the file
  leaves the browser."
- When multiple PDFs are selected together, each is checked individually;
  one oversized file among several shouldn't silently block the others —
  surface which specific file(s) failed the check.

## What's intentionally NOT changing

- Visual color palette and Bambyy branding.
- The overall feature set and screen inventory otherwise (multi-PDF,
  regenerate question, weak spots, analytics, previous-files reuse).
- This is a hosting/architecture change plus the specific enhancements
  listed above — not an unrelated redesign.