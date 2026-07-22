# DEPLOYMENT.md — Pre-Deploy Checklist

Same pattern as `calcuduko-web`: push to GitHub, import into Vercel once via
the dashboard, set env vars, then every subsequent `git push origin main`
auto-deploys.

## 1. One-time Supabase setup

1. Create a Supabase project (or reuse an existing one -- decide up front
   whether local dev shares the production project or uses a separate
   dev project; either works, this app has no migrations that assume one
   or the other).
2. Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor (or
   via `supabase db push` if using the CLI) to create the `quiz_history`
   table.
3. Create the Storage bucket **by hand in the dashboard** (Storage ->
   New bucket):
   - Name: `saved-pdfs` (must match exactly -- `api/_lib/supabase.js`
     hardcodes this name)
   - **Uncheck "Public bucket"** -- it must stay private. All reads/writes
     go through `api/*` functions using the service role key; the client
     never talks to Supabase directly.
4. Copy the project's URL and **service role key** (Project Settings ->
   API) -- not the anon/public key. You'll need these for both local dev
   and the Vercel dashboard.

## 2. Local dev setup

1. `npm install`
2. `cp .env.local.example .env.local` and fill in real values:
   `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ACCESS_PASSWORD`.
3. `npm run dev` (runs `vercel dev`, which serves the Vite frontend and
   emulates the `api/` serverless functions locally against the same
   Supabase project).
4. First run: `vercel dev` may prompt you to link the local folder to a
   Vercel project/scope -- follow the prompts (this creates a local
   `.vercel/` folder, which is gitignored).

## 3. Pre-deploy checklist (confirm every item before pushing)

- [ ] **No secret is committed.** `.env.local` is gitignored (confirmed in
      `.gitignore`); `git status` shows no `.env.local`, `.env`, or
      `.vercel/` in the staged/tracked files.
- [ ] **`.env.local.example` has no real values** -- only variable names
      and comments.
- [ ] **Supabase table + bucket exist**: `quiz_history` table created via
      the migration above, `saved-pdfs` bucket created and private.
- [ ] **`vercel dev` runs end-to-end locally**: upload a PDF, generate a
      quiz, answer a question (confirms `save-quiz-result` persists to
      Supabase), reload the page, log back in, and confirm the quiz shows
      up as resumable in History.
- [ ] **`GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` never appear in
      the browser.** After `npm run build`, grep `dist/assets/*.js` for
      both values -- they must not appear (they're only ever read inside
      `api/*` functions, never imported into `src/`).
- [ ] **Access gate blocks unauthenticated API calls**, not just the UI:
      `curl -i https://<deployment>/api/history` with no `Authorization`
      header must return `401`.

## 4. Vercel project setup (one-time)

1. Push this repo to GitHub.
2. Vercel dashboard -> Add New Project -> import the GitHub repo.
3. Framework preset: Vite (should auto-detect from `package.json`).
4. Set environment variables (Project Settings -> Environment Variables),
   for **Production**, **Preview**, and **Development** as needed:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` (optional)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ACCESS_PASSWORD`

   None of these are `VITE_`-prefixed -- they must only ever be readable
   server-side, inside `api/*` functions.
5. Deploy. Subsequent pushes to `main` auto-deploy.

## 5. Function timeout note

Gemini quiz generation can take up to ~60-90s for larger PDFs / more
questions. `generate-quiz.js` and `regenerate-question.js` set
`export const maxDuration = 60` (seconds). If Vercel's plan enforces a
lower serverless function timeout than that, either upgrade the plan or
reduce `numQuestions` on the Upload screen.
