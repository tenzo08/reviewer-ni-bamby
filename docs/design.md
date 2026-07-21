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

## Scan-to-PDF flow (revised: staging area, not a straight-through loop)

On the upload screen, "Scan pages" opens a **scan staging screen** —
distinct from a simple capture-then-upload loop:

1. **Capture**: each tap of "Scan a page" opens the camera, captures one
   photo, and adds it to a running page list shown as thumbnails in
   capture order.
2. **Auto edge detection + perspective correction** (the added feature):
   before a captured photo is added to the page list, run it through
   client-side edge detection (e.g. a JS library built on OpenCV.js, such
   as `jscanify`) to find the document's four corners and apply a
   perspective-correcting crop, so the page in the thumbnail looks like a
   scanned document, not a photo taken at an angle. If auto-detection
   fails or looks wrong, the user can fall back to using the photo
   uncropped rather than being blocked.

   **Performance/responsiveness requirements (non-negotiable):**
   - The heavy WASM/OpenCV module loads **once per scan session**, not
     once per photo. Loading it fresh for every capture is the likely
     cause of slow per-photo processing and must be fixed.
   - Photos are **downscaled before edge detection** runs (detection
     doesn't need full 8-12MP camera resolution to find four corners
     accurately) — full-resolution processing is unnecessary cost, not a
     quality requirement, and should be removed.
   - Processing happens **off the main thread** (e.g. a Web Worker) or is
     otherwise structured so the UI never freezes while a photo is being
     processed. A newly-captured photo shows a per-thumbnail "processing"
     state (spinner/skeleton on that specific thumbnail) rather than
     blocking the whole screen.
   - **Every other control remains usable while any photo is still
     processing**: removing an already-added page, recapturing a
     different page, reordering, capturing another new page, and Compile
     (once at least one page is ready) must all work immediately,
     regardless of whether some other photo in the list is still being
     processed. Processing state is per-photo, not global.
   - If a specific optimization (e.g. a particular OpenCV feature,
     unnecessary intermediate image conversions, redundant re-processing
     on every render) is found to add meaningful latency without adding
     real accuracy, remove it rather than trying to preserve it.

3. **Review/edit the staged pages** — this is the new capability:
   - **Remove** any single page from the list.
   - **Recapture** any single page (retake just that one, replacing it in
     place, not appended at the end).
   - **Reorder** pages (drag or up/down controls).
   - All of this happens BEFORE anything is uploaded — nothing hits the
     backend during capture/review, only on final compile.
4. **Compile**: once satisfied with the page set, a "Compile PDF" action
   prompts for a filename, then uploads all staged images in their final
   order to `/api/scan-to-pdf` in one request, exactly as before from the
   backend's perspective (no API change needed — this is a frontend UX
   upgrade over the existing endpoint).
5. Same duplicate-filename handling as any other upload.

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

## What's intentionally NOT changing

- Visual color palette and Bambyy branding.
- The overall feature set and screen inventory otherwise (multi-PDF,
  regenerate question, weak spots, analytics, previous-files reuse).
- This is a hosting/architecture change plus the specific enhancements
  listed above — not an unrelated redesign.