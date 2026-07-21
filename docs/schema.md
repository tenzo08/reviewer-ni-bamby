# schema.md — Supabase Data Shapes

Persistence moves from local files (`backend/history/`,
`backend/saved_pdfs/`) to Supabase: Postgres for structured data, Storage
for the PDF binaries themselves.

## Postgres table: `quiz_history`

```sql
create table quiz_history (
  id text primary key,               -- "20260716-143022-123456-cell-biology-basics"
  title text not null,
  created_at timestamptz not null default now(),
  score integer not null,
  total integer not null,
  answered_count integer not null,
  completed boolean not null,
  source_pdfs jsonb not null default '[]',   -- ["notes.pdf"]
  questions jsonb not null            -- array of question objects, see below
);
```

`questions` jsonb shape (array), same fields as every earlier version:
```json
[
  {
    "question": "What is the powerhouse of the cell?",
    "choices": ["Mitochondria", "Nucleus", "Ribosome", "Golgi"],
    "correctAnswer": "Mitochondria",
    "yourAnswer": "Mitochondria",
    "isCorrect": true,
    "explanation": "Mitochondria produce ATP."
  }
]
```

- `id` generation and format unchanged from earlier versions
  (timestamp-with-milliseconds + slugified title) — still used as the
  primary key, still overwritten in place (`upsert`) when resuming and
  re-saving an unfinished quiz, rather than inserting a new row.
- `completed: false` + some `questions[].yourAnswer === null` = resumable.
- No Row Level Security needed if all access is server-side only through
  the service role key (see rules.md) — but if this table is ever queried
  client-side directly in the future, RLS must be added before that
  happens.

## Supabase Storage bucket: `saved-pdfs`

- One object per archived PDF, stored under its **plain original
  filename** (no path prefix) — this preserves the existing duplicate-
  detection approach: checking for a duplicate is checking whether an
  object with that exact name already exists in the bucket.
- Bucket should be **private** (not public), since all reads/writes go
  through server-side Vercel functions using the service role key — the
  client never fetches directly from Supabase Storage.

## Derived views (computed on read, not stored separately)

Same as every earlier version — these are computed from `quiz_history`
rows, not separately persisted tables:
- **History list**: `select id, title, created_at, score, total,
  answered_count, completed from quiz_history order by created_at desc`
- **Weak spots**: every `questions[]` entry across all rows where
  `isCorrect = false`
- **Analytics**: aggregate `score`/`total` across all rows, plus a
  10-most-recent accuracy trend

## What's NOT persisted server-side

- The access-gate token/cookie (rules.md section 3) — short-lived,
  client-side only, not a database concern.
- In-progress (not-yet-saved) quiz state — lives in the browser's React
  state until the user finishes or exits, exactly like the mobile
  version's behavior, just now in browser memory instead of phone memory.