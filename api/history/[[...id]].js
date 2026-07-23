import { requireAuth } from '../_lib/auth.js';
import { deleteAllHistory, deleteHistoryEntry, getHistoryEntry, listHistorySummaries } from '../_lib/supabase.js';
import { notFound, sendError } from '../_lib/http.js';

// Merges the old history.js (GET list / DELETE all) and history/[id].js
// (GET one / DELETE one) into one file -- Vercel's Hobby plan caps
// Serverless Functions at 12 and every api/ file counts as one, so this
// consolidation is what keeps deploys under that limit. Same two URLs,
// same methods, same responses as before; only the file layout changed.
//
// The optional catch-all filename ([[...id]]) is what lets ONE file answer
// both /api/history and /api/history/:id -- Vercel passes whatever comes
// after /history/ as req.query.id, an array (e.g. ['abc']) when present or
// absent entirely when not. The local dev server doesn't do real
// file-based routing, so it instead matches two separate Express patterns
// onto this same file and merges a plain string param into req.query.id --
// getIdSegments() below normalizes either shape instead of assuming one.
function getIdSegments(req) {
  const raw = req.query.id;
  if (Array.isArray(raw)) return raw;
  if (raw !== undefined && raw !== null) return [raw];
  return [];
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
    const idSegments = getIdSegments(req);
    // More than one segment (e.g. /api/history/abc/def) never matched the
    // old [id].js's exact-one-segment pattern either -- preserve that as a
    // 404 rather than silently taking the first segment.
    if (idSegments.length > 1) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const id = idSegments.length === 1 ? idSegments[0] : null;

    if (id === null) {
      // /api/history -- list (GET) or clear-all (DELETE), same as before.
      if (req.method === 'GET') {
        res.status(200).json(await listHistorySummaries());
        return;
      }
      if (req.method === 'DELETE') {
        await deleteAllHistory();
        res.status(200).json({ ok: true });
        return;
      }
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // /api/history/:id -- get one (GET) or delete one (DELETE), same as before.
    if (req.method === 'GET') {
      const entry = await getHistoryEntry(id);
      if (!entry) throw notFound('History entry not found.');
      res.status(200).json(entry);
      return;
    }
    if (req.method === 'DELETE') {
      const deleted = await deleteHistoryEntry(id);
      if (!deleted) throw notFound('History entry not found.');
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    sendError(res, err);
  }
}
