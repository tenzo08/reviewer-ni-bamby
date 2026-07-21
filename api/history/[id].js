import { requireAuth } from '../_lib/auth.js';
import { deleteHistoryEntry, getHistoryEntry } from '../_lib/supabase.js';
import { notFound, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
    const id = String(req.query.id);
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
