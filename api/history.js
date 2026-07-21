import { requireAuth } from './_lib/auth.js';
import { deleteAllHistory, listHistorySummaries } from './_lib/supabase.js';
import { sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
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
  } catch (err) {
    sendError(res, err);
  }
}
