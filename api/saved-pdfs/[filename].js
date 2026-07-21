import { requireAuth } from '../_lib/auth.js';
import { deleteSavedPdf, safeFilename } from '../_lib/supabase.js';
import { notFound, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const filename = safeFilename(req.query.filename);
    const deleted = await deleteSavedPdf(filename);
    if (!deleted) throw notFound('Saved PDF not found.');
    res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
