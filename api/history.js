import { requireAuth } from './_lib/auth.js';
import { deleteAllHistory, deleteHistoryEntry, getHistoryEntry, listHistorySummaries } from './_lib/supabase.js';
import { notFound, sendError } from './_lib/http.js';

// Serves BOTH /api/history and /api/history/:id from this one flat file.
// A previous attempt at this consolidation used Vercel's double-bracket
// "optional catch-all" filename convention (history/[[...id]].js) to do
// this -- that turned out to be a Next.js-only routing convention that a
// plain (non-Next.js) api/ directory project does not support at all, so
// Vercel's real router never recognized either URL and both 404'd in
// production, despite the local dev server (a hand-rolled Express mirror
// that has no real cross-check against Vercel's actual routing rules)
// reporting all tests passing. This version instead routes both URLs here
// via a vercel.json rewrite ("/api/history/:id" -> "/api/history"), which
// Vercel documents as automatically forwarding the captured :id as a
// query-string parameter -- rewrites are a universal, framework-agnostic
// Vercel primitive, not tied to any router's own file-naming conventions.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
    const rawId = req.query.id;
    const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? null;

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
