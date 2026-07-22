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

## API routes (same shapes as every earlier backend version)

- `POST /api/prepare-upload` (new: resolves duplicate-filename conflicts and
  returns a signed Supabase Storage upload URL per new file -- see
  architecture.md's revised generate-quiz request flow)
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

## Camera-based scanning: removed

The scan staging screen (capture/edge-detect/crop/reorder/compile,
formerly here) was deliberately removed in full, along with
`/api/scan-to-pdf`, the OpenCV/jscanify dependency, and the Web Worker
that processed captured photos. See rules.md #4's exception. Normal PDF
upload is the only upload path; it already handles a scanned/photographed
PDF the user uploads as a file (see architecture.md).

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

## What's intentionally NOT changing

- Visual color palette and Bambyy branding.
- The overall feature set and screen inventory otherwise (multi-PDF,
  regenerate question, weak spots, analytics, previous-files reuse).
- This is a hosting/architecture change plus the specific enhancements
  listed above — not an unrelated redesign.