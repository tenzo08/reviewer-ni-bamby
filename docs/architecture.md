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
│   ├── regenerate-question.js
│   ├── save-quiz-result.js
│   ├── history.js
│   ├── history/[id].js
│   ├── weak-spots.js
│   ├── analytics.js
│   ├── saved-pdfs.js
│   ├── saved-pdfs/[filename].js
│   ├── scan-to-pdf.js
│   ├── auth-check.js          <- lightweight access-gate check
│   └── _lib/
│       ├── supabase.js          <- server-side Supabase client (service role)
│       ├── gemini.js             <- prompt building + Gemini calls
│       └── pdfAssembly.js         <- pdf-lib image-to-PDF assembly
└── DEPLOYMENT.md             <- pre-deploy readiness checklist, same pattern as Calcuduko's
```

## Request flow (generate-quiz)

```
Browser -> POST /api/generate-quiz (multipart PDFs + settings)
        -> Vercel serverless function
        -> _lib/supabase.js: check saved-pdfs bucket for filename conflicts
        -> (if conflict, return 409 with conflict list, same as before)
        -> upload new PDF(s) to Supabase Storage bucket "saved-pdfs"
        -> _lib/gemini.js: read PDF(s) back as base64, send to Gemini as
           inline file parts, same prompt-building logic as every earlier
           version
        -> parse Gemini's JSON response into quiz data
        -> returned to browser (nothing written to quiz_history yet --
           that happens on save-quiz-result, same as before)
```

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

## Scan-to-PDF pipeline (ported from the mobile version)

```
Browser: <input type="file" accept="image/*" capture="environment" multiple>
  or a repeated single-capture loop, matching the mobile app's UX
  -> POST /api/scan-to-pdf (multipart images[] + filename)
  -> _lib/pdfAssembly.js (pdf-lib): one PDF, one image per page
  -> uploaded to Supabase Storage "saved-pdfs" bucket, same duplicate-
     conflict handling as a normal upload (share the same conflict-check
     function used by generate-quiz -- don't duplicate that logic)
  -> response: { filename }
```

Raw images are processed in the function's memory for the duration of the
request only — never written to Storage themselves, only the assembled
PDF persists (same rule as the mobile version, now enforced by the
serverless environment's nature anyway, since there's no disk to
accidentally leave them on).

**Known failure mode (currently being debugged):** generating a quiz from
a compiled scanned PDF can fail where the same flow works fine for a
normal uploaded PDF. Suspected causes, in rough likelihood order:

1. **File size**: images embedded at full camera resolution (a phone
   photo is commonly 3-12MB) across multiple pages can produce an
   assembled PDF large enough to exceed Gemini's inline-request size
   limit, or Vercel's request body size limit, or simply take long enough
   to upload/process that it exceeds Vercel's function execution timeout
   (the default is short — a few seconds to 10s depending on plan —
   unless explicitly configured higher via `maxDuration`).
2. **Image embedding correctness**: `pdf-lib`'s `embedJpg`/`embedPng`
   need the actual image format to match which method is called — a
   mismatch (e.g. calling `embedJpg` on a PNG byte stream, or an
   unexpected format coming from the browser's camera capture) can
   produce a technically-invalid PDF that some readers tolerate but
   Gemini's parser rejects.
3. **Generic/swallowed errors**: if the actual Gemini error (or Vercel
   timeout, or size-limit rejection) isn't being surfaced to the client,
   the symptom looks like "can't read this document" with no actionable
   detail, even though the real cause is one of the above.

Whatever the root cause turns out to be, the fix should include actually
compressing/resizing images before embedding (there's no reason to keep
full 12MP camera resolution for a page of text Gemini needs to read), and
surfacing the real underlying error message to the client rather than a
generic failure, so future issues are diagnosable without guessing.