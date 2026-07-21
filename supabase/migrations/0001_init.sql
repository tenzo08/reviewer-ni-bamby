-- Reviewer ni Bambyy: initial schema (see docs/schema.md)
-- Run this in the Supabase SQL editor for the project, or via the Supabase
-- CLI (`supabase db push`), before the app is used for the first time.

create table if not exists quiz_history (
  id text primary key,               -- "20260716-143022-123456-cell-biology-basics"
  title text not null,
  created_at timestamptz not null default now(),
  score integer not null,
  total integer not null,
  answered_count integer not null,
  completed boolean not null,
  source_pdfs jsonb not null default '[]',   -- ["notes.pdf"]
  questions jsonb not null            -- array of question objects, see docs/schema.md
);

-- No Row Level Security is enabled: all access to this table goes through
-- Vercel serverless functions using the Supabase service role key
-- server-side (see docs/rules.md section 1). The client never queries this
-- table directly. If that ever changes, RLS must be added first.
