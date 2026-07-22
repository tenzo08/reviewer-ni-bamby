# psd.md — Project Scope Document

## Goal

Let Bambyy upload a PDF and get a quiz generated from it, from **any
device with a browser** — phone, tablet, laptop, anyone's computer — via a
real deployed URL, with zero dependency on her own laptop being on or any
process running locally.

## Non-goals

- Not multi-user in the account/login sense. Single person, optionally
  gated by one shared password, not a real auth system.
- Not minimizing Gemini API cost at the expense of quiz quality.
- Not implementing OCR beyond what Gemini does natively when reading a
  PDF or scanned page.
- Not a native app anymore — no App Store, no Play Store, no APK. A
  website reachable from any mobile or desktop browser replaces that need
  entirely, including the earlier "iOS costs $99/year" problem, which
  simply doesn't apply to a website.

## Success criteria

- A real, live URL (e.g. `reviewer-ni-bambyy.vercel.app`) that works from
  Bambyy's phone browser, laptop browser, or any other device, with no
  setup step beyond opening the link.
- No laptop needs to be on, ever, for the app to work — this is the
  concrete improvement over every earlier version.
- History, saved PDFs, weak spots, analytics, and resumable unfinished
  quizzes all persist reliably in Supabase — verified to survive a
  server-side restart/redeploy, not just working in one dev session.
- Local development (`npm run dev` / `vercel dev`) works end-to-end
  before every deploy, mirroring the Calcuduko pre-deployment check.
- Deployment itself is the same low-friction flow as Calcuduko: push to
  GitHub, Vercel auto-builds and deploys, env vars set once in the Vercel
  dashboard.
- Every feature from the mobile version works identically here — this is
  a re-platforming project, success means nothing was lost in the move.
  **Exception:** camera-based scan-to-PDF was later removed entirely (see
  rules.md) -- normal PDF upload, including scanned/photographed PDFs a
  user uploads as a file, is the only upload path.