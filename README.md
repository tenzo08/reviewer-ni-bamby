# Reviewer ni Bambyy

Turn a PDF module/reviewer into an interactive quiz, using Gemini. A React +
Vite website with Vercel serverless functions as the backend and Supabase
for persistence -- deployed the same way as the `calcuduko-web` project.
Reachable from any device with a browser; no laptop needs to be running.

See `CLAUDE.md` and `docs/` (`rules.md`, `psd.md`, `schema.md`,
`architecture.md`, `design.md`, in that order) for the full design.

## One-time setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in real values
   (`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ACCESS_PASSWORD`). See `DEPLOYMENT.md` for the Supabase table/bucket
   setup steps that must happen before first use.

## Every session

```
npm run dev
```

This runs `vercel dev`, which serves the Vite frontend and emulates the
`api/` serverless functions locally against Supabase, at
`http://localhost:3000` (or whatever port it prints). On first load,
you'll be asked for the shared access password (`ACCESS_PASSWORD` in
`.env.local`).

## Quick local testing (no Vercel CLI)

Separate from the `npm run dev` / `vercel dev` flow above -- use this if you
want to try the app locally before setting up Vercel at all.

```
npm run dev:local
```

This starts two plain Node processes together (via `concurrently`, no
Vercel CLI involved):

- `dev-server/local-api-server.js` -- a small Express server that imports
  each handler straight from `api/*.js` and mounts it at the matching
  route, emulating the same `(req, res)` contract Vercel's Node runtime
  gives those handlers in production (traced from `@vercel/node`'s own
  source, not guessed -- see the comments at the top of that file).
- `vite`, Vite's own dev server, with `server.proxy` (`vite.config.js`)
  forwarding `/api/*` requests to the Express server above.

Because the frontend still calls `fetch('/api/...')` with the same
relative paths either way, `src/` doesn't know or care which of the three
modes (`dev:local`, `vercel dev`, or the real deployment) is serving it.

This still needs the same `.env.local` values as `vercel dev` --
`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ACCESS_PASSWORD` -- since the `api/` handlers themselves are completely
unchanged; only how they're invoked locally differs. The access gate
behaves identically in this mode too (same `api/_lib/auth.js`, same
`requireAuth` check on every route except `auth-check.js`), not a relaxed
local-only version of it.

This local path is for quick iteration only -- `vercel dev` (via `npm run
dev`) is still the real pre-deploy check per `DEPLOYMENT.md`, since it's
what actually models the Vercel runtime rather than emulating it.

## Data

History, saved PDFs, weak spots, and analytics all live in Supabase
(Postgres for the `quiz_history` table, Storage for the `saved-pdfs`
bucket) -- nothing is written to the local or server filesystem. This
means the app works identically in local dev and once deployed, and
nothing is lost between deploys or serverless cold starts.

## Deployment

See `DEPLOYMENT.md` for the full pre-deploy checklist and Vercel project
setup (push to GitHub, import via the Vercel dashboard, set environment
variables, deploy).

## Project docs

Read `docs/rules.md`, `docs/psd.md`, `docs/schema.md`,
`docs/architecture.md`, and `docs/design.md` (in that order) before making
changes -- see `CLAUDE.md`.
