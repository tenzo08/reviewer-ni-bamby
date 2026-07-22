# CLAUDE.md — Reviewer ni Bambyy

This file is the entry point for understanding this project. Read it before
making any changes to the app.

---

## 1. Project Identity

**Reviewer ni Bambyy** — turns a PDF (including scanned/photographed
pages saved as a PDF) into an interactive quiz, using Google's Gemini
API. Single-user (Bambyy).

**Architecture: deployed website**, same stack pattern as the Calcuduko
project (`calcuduko-web`): **React + Vite** frontend, **Vercel** hosting
with serverless API routes as the backend, **Supabase** (Postgres +
Storage) as the persistence layer. Deployed via GitHub → Vercel, same
dashboard-import workflow used for Calcuduko.

This replaces all earlier iterations:
1. A Flask (Python) + Cloudflare Tunnel + `run-all.ps1` mobile-client
   version.
2. A fully standalone on-device Expo version (Gemini called directly from
   the phone).
3. A Node/Express-on-laptop + Cloudflare Tunnel + Expo version.

All three needed Bambyy's laptop running and awake to work at all. This
version doesn't — once deployed, it's a normal website, reachable from any
device with a browser (phone, tablet, laptop, anyone's computer), with no
dependency on any specific machine being on.

---

## 2. Mandatory Pre-Read

Before modifying this app, read these documents in this order:

1. `docs/rules.md` — binding constraints, especially secret-handling and
   the "no server-side filesystem persistence" rule.
2. `docs/psd.md` — project scope, goals, non-goals.
3. `docs/schema.md` — Supabase table + storage bucket shapes.
4. `docs/architecture.md` — Vercel serverless function design, how Gemini
   and Supabase are called, local dev workflow, deployment pipeline.
5. `docs/design.md` — screen-by-screen behavior (ported from the mobile
   version to web components).

---

## 3. Hard Constraints (summary of rules.md)

- **`GEMINI_API_KEY` and Supabase's service role key live only in
  Vercel's server-side environment variables** — never in a `VITE_`-
  prefixed variable (Vite inlines those into the public client bundle).
- **No reliance on writing files to a local/server disk for persistence.**
  Vercel serverless functions are stateless between invocations — all
  history, saved PDFs, and quiz data go through Supabase (Postgres for
  structured data, Storage for the PDF files themselves).
- **Single user, but now on the open internet.** Unlike the tunnel-based
  versions (URL known only to Bambyy), a deployed Vercel site is publicly
  reachable by URL. A lightweight access gate (shared password, checked
  server-side) is recommended so a stranger who finds the URL can't burn
  through the Gemini quota — see rules.md for the exact mechanism.
- **Feature parity is required**, not a redesign: multi-PDF upload,
  duplicate-file detection, question regeneration, resumable unfinished
  quizzes, weak spots, and analytics must all carry over exactly as they
  worked in the mobile version. **Exception:** camera-based scan-to-PDF
  was later removed entirely (see rules.md #4) — normal PDF upload is the
  only upload path now.