import { createClient } from '@supabase/supabase-js';

const BUCKET = 'saved-pdfs';

let client = null;
function getClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Storage is not configured on the server.');
    err.status = 500;
    err.expose = true;
    throw err;
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

function storageError(message, cause) {
  console.error('[supabase]', cause);
  const err = new Error(message);
  err.status = 502;
  err.expose = true;
  return err;
}

// Strips any directory-traversal component from filenames that originate
// from client input, mirroring the old backend's path.basename() use.
export function safeFilename(filename) {
  return String(filename || '').replace(/^.*[/\\]/, '');
}

function slugify(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'quiz';
}

// Format: <YYYYMMDD>-<HHMMSS>-<ms+random padding>-<slugified-title>
// e.g. 20260716-143022-123456-cell-biology-basics -- unchanged from the
// old backend (docs/schema.md requires this exact format/collision scheme).
export function generateHistoryId(title) {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const msPart = pad(now.getMilliseconds(), 3) + pad(Math.floor(Math.random() * 1000), 3);
  return `${datePart}-${timePart}-${msPart}-${slugify(title)}`;
}

// Whitespace/case-insensitive comparison, used for identification answers
// and for the corrective term/reason on modifiedTrueFalse questions.
function normalizeMatch(str) {
  return String(str ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// isCorrect is type-aware: identification uses a fuzzy-free exact (but
// case/whitespace-insensitive) match; modifiedTrueFalse additionally
// requires the student's corrective term to match modifiedAnswer whenever
// correctAnswer is "False"; every other type is a plain string match.
function computeIsCorrect(q, yourAnswer, yourModifiedAnswer) {
  if (q.type === 'identification') {
    return normalizeMatch(yourAnswer) === normalizeMatch(q.correctAnswer);
  }
  if (q.type === 'modifiedTrueFalse') {
    if (yourAnswer !== q.correctAnswer) return false;
    if (q.correctAnswer === 'False') {
      return normalizeMatch(yourModifiedAnswer) === normalizeMatch(q.modifiedAnswer);
    }
    return true;
  }
  return yourAnswer === q.correctAnswer;
}

// Re-derives score/total/answeredCount/completed/isCorrect from the
// questions array so a save always reflects reality, even if the caller
// sent a stale or inconsistent snapshot.
function normalizeHistoryEntry(entry) {
  const questions = (entry.questions || []).map((q) => {
    const answered = q.yourAnswer !== null && q.yourAnswer !== undefined;
    const yourModifiedAnswer = q.yourModifiedAnswer ?? null;
    const type = q.type || 'multipleChoice';
    const normalized = {
      type,
      question: q.question,
      correctAnswer: q.correctAnswer,
      yourAnswer: answered ? q.yourAnswer : null,
      isCorrect: answered ? computeIsCorrect(q, q.yourAnswer, yourModifiedAnswer) : null,
      explanation: q.explanation,
    };
    if (q.choices) normalized.choices = q.choices;
    if (type === 'modifiedTrueFalse' && q.modifiedAnswer !== undefined) {
      normalized.modifiedAnswer = q.modifiedAnswer;
      normalized.yourModifiedAnswer = answered ? yourModifiedAnswer : null;
    }
    return normalized;
  });
  const total = questions.length;
  const answeredCount = questions.filter((q) => q.yourAnswer !== null).length;
  const score = questions.filter((q) => q.isCorrect === true).length;
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date || new Date().toISOString(),
    score,
    total,
    answeredCount,
    completed: answeredCount === total && total > 0,
    sourcePdfs: entry.sourcePdfs || [],
    questions,
  };
}

function rowToEntry(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.created_at,
    score: row.score,
    total: row.total,
    answeredCount: row.answered_count,
    completed: row.completed,
    sourcePdfs: row.source_pdfs || [],
    questions: row.questions || [],
  };
}

function entryToRow(entry) {
  return {
    id: entry.id,
    title: entry.title,
    created_at: entry.date,
    score: entry.score,
    total: entry.total,
    answered_count: entry.answeredCount,
    completed: entry.completed,
    source_pdfs: entry.sourcePdfs,
    questions: entry.questions,
  };
}

// ---------- quiz_history (Postgres) ----------

// Saving again with the same id overwrites in place (resume-and-finish),
// rather than creating a duplicate row -- docs/schema.md's upsert-by-id rule.
export async function saveHistoryEntry(rawEntry) {
  const entry = normalizeHistoryEntry(rawEntry);
  const { error } = await getClient().from('quiz_history').upsert(entryToRow(entry), { onConflict: 'id' });
  if (error) throw storageError('Could not save quiz result.', error);
  return entry;
}

export async function getHistoryEntry(id) {
  const { data, error } = await getClient().from('quiz_history').select('*').eq('id', id).maybeSingle();
  if (error) throw storageError('Could not load quiz result.', error);
  return data ? rowToEntry(data) : null;
}

export async function listHistoryEntriesFull() {
  const { data, error } = await getClient().from('quiz_history').select('*').order('created_at', { ascending: false });
  if (error) throw storageError('Could not load history.', error);
  return (data || []).map(rowToEntry);
}

export async function listHistorySummaries() {
  const { data, error } = await getClient()
    .from('quiz_history')
    .select('id, title, created_at, score, total, answered_count, completed, source_pdfs')
    .order('created_at', { ascending: false });
  if (error) throw storageError('Could not load history.', error);
  return (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    date: row.created_at,
    score: row.score,
    total: row.total,
    answeredCount: row.answered_count,
    completed: row.completed,
    sourcePdfs: row.source_pdfs || [],
  }));
}

export async function deleteHistoryEntry(id) {
  const { data, error } = await getClient().from('quiz_history').delete().eq('id', id).select('id');
  if (error) throw storageError('Could not delete quiz result.', error);
  return (data || []).length > 0;
}

export async function deleteAllHistory() {
  const { error } = await getClient().from('quiz_history').delete().neq('id', '');
  if (error) throw storageError('Could not clear history.', error);
}

// ---------- saved-pdfs (Supabase Storage) ----------

export async function savedPdfExists(filename) {
  const { data, error } = await getClient().storage.from(BUCKET).list('', { search: filename, limit: 100 });
  if (error) throw storageError('Could not check saved PDFs.', error);
  return (data || []).some((f) => f.name === filename);
}

export async function saveSavedPdf(filename, buffer) {
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(filename, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw storageError('Could not save the PDF.', error);
}

export async function readSavedPdf(filename) {
  const { data, error } = await getClient().storage.from(BUCKET).download(filename);
  if (error) throw storageError('Could not read the saved PDF.', error);
  return Buffer.from(await data.arrayBuffer());
}

export async function listSavedPdfs() {
  const { data, error } = await getClient()
    .storage.from(BUCKET)
    .list('', { sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw storageError('Could not list saved PDFs.', error);
  return (data || [])
    .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    .map((f) => ({
      filename: f.name,
      size: f.metadata?.size ?? null,
      uploadedAt: f.created_at || f.updated_at || null,
    }));
}

export async function deleteSavedPdf(filename) {
  const exists = await savedPdfExists(filename);
  if (!exists) return false;
  const { error } = await getClient().storage.from(BUCKET).remove([filename]);
  if (error) throw storageError('Could not delete the saved PDF.', error);
  return true;
}
