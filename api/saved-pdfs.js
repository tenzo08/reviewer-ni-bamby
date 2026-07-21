import { requireAuth } from './_lib/auth.js';
import { listSavedPdfs } from './_lib/supabase.js';
import { sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    res.status(200).json(await listSavedPdfs());
  } catch (err) {
    sendError(res, err);
  }
}
