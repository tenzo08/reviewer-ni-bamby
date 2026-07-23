# architecture.md — System Design

## Repo layout (mirrors calcuduko-web's structure)

```
reviewer-ni-bambyy-web/
├── package.json
├── vite.config.js
├── .env.local              <- local dev secrets, gitignored
├── src/
│   ├── App.jsx               <- screens/routing (ported from mobile App.js)
│   ├── components/            <- per-screen components
│   ├── lib/
│   │   └── apiClient.js        <- fetch wrappers calling /api/* routes
│   └── main.jsx
├── api/                      <- Vercel serverless functions (the "backend")
│   ├── generate-quiz.js
│   ├── prepare-upload.js
│   ├── regenerate-question.js
│   ├── save-quiz-result.js
│   ├── compile-pdf.js
│   ├── history/[[...id]].js     <- GET/DELETE list + GET/DELETE one, one file
│   ├── weak-spots.js
│   ├── analytics.js
│   ├── saved-pdfs/[[...path]].js <- list + delete-one + download-one, one file
│   ├── auth-check.js          <- lightweight access-gate check
│   └── _lib/
│       ├── supabase.js          <- server-side Supabase client (service role)
│       └── gemini.js             <- prompt building + Gemini calls
└── DEPLOYMENT.md             <- pre-deploy readiness checklist, same pattern as Calcuduko's
```

Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and every
file under `api/` (except `_lib/`) counts as one -- `history` and
`saved-pdfs` each consolidate what used to be 2-3 separate files into one,
using Vercel's optional-catch-all filename convention (`[[...name]].js`) so
one file can answer both the collection URL and the per-item URL(s). This
keeps the real function count comfortably under the limit as more routes
get added over time.

## Request flow (generate-quiz)

**Revised (two-step upload, direct to Storage):** the original single-step
design below sent raw PDF bytes through this function's own request body,
which turned out to be a real production bug -- Vercel's platform-level
request body size limit (~4.5MB) rejects the request before the function
even starts, before any of the app's own try/catch can run, for any PDF
(scanned or not) large enough to cross it. In-function compression can't
fix this, since the oversized request never reaches the function at all.

```
Step 1 -- resolve conflicts, get upload URLs (tiny JSON body):
Browser -> POST /api/prepare-upload { filenames, duplicateResolution }
        -> _lib/supabase.js: check saved-pdfs bucket for filename conflicts
        -> (if conflict, return 409 with conflict list, same as before)
        -> for each new (non-conflicting) filename, mint a Supabase
           Storage signed upload URL (createSignedUploadUrl) -- single-use,
           expires in 2 hours, requires no Supabase credential to use
        -> returns { uploads: { [filename]: { useExisting } | { signedUrl, path, token } } }

Step 2 -- browser uploads each new file straight to Storage:
Browser -> PUT <signedUrl> (raw PDF bytes, direct to Supabase Storage)
        -> never touches any Vercel function's request body at all,
           so the ~4.5MB platform limit does not apply regardless of PDF size

Step 3 -- generate the quiz (tiny JSON body, filenames only):
Browser -> POST /api/generate-quiz { sourcePdfs: [filenames], settings }
        -> Vercel serverless function
        -> _lib/supabase.js: read each PDF back from Storage as a buffer
        -> _lib/gemini.js: send to Gemini as inline file parts, using
           responseSchema (structured output) so the JSON shape is
           guaranteed by the API itself, not just prompt instructions
        -> parse Gemini's JSON response into quiz data
        -> returned to browser (nothing written to quiz_history yet --
           that happens on save-quiz-result, same as before)
```

`regenerate-question.js` already worked this way (filenames in, read from
Storage) and needed no change to its upload path -- only generate-quiz's
original all-in-one multipart upload needed splitting.

## Why Vercel serverless functions instead of a persistent Express server

- Matches the Calcuduko pattern exactly (no separate backend to host or
  keep alive) — one Vercel project, one deploy, frontend and API routes
  together.
- No laptop, no tunnel, no "is the server on" question at all. Vercel's
  functions run on-demand, always available.
- Forces the correct data-persistence discipline (Supabase, not local
  files) from the start, rather than something to migrate to later.

## Local development

```
vercel dev
```
(or `npm run dev` wired to call `vercel dev` under the hood) runs the Vite
frontend and emulates the `api/` serverless functions locally, both
against the same Supabase project (or a separate dev project/schema, if
Bambyy wants to keep local testing data separate from production —
decide and document this choice in DEPLOYMENT.md).

## Deployment pipeline (identical to Calcuduko's proven flow)

1. `git push origin main`
2. Vercel dashboard → Add New Project → import the repo (one-time)
3. Set environment variables in the Vercel dashboard: `GEMINI_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the access-gate
   password variable — all as regular (non-`VITE_`) environment variables,
   since they're only read inside `api/` functions, never in browser code.
4. Deploy. Subsequent pushes to `main` auto-deploy.
5. Same DEPLOYMENT.md-style pre-flight check used for Calcuduko: confirm
   env vars are set, confirm no secret is committed, confirm the build
   succeeds locally before pushing.

## Camera-based scanning: removed

The earlier camera-based scan-to-PDF pipeline (browser capture -> client-
side edge-detect/crop staging screen -> `POST /api/scan-to-pdf` ->
`pdf-lib` image-to-PDF assembly) was deliberately removed in full --
see rules.md #4's exception. Normal PDF upload
(`<input type="file" accept="application/pdf">`) is the only upload path
now; it already correctly handles a PDF whose pages are scanned/
photographed images, since Gemini reads the PDF's inline data natively
regardless of whether its pages are typed text or scanned images -- no
scan-specific server code was ever needed for that part.