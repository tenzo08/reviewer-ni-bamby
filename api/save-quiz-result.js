import { requireAuth } from './_lib/auth.js';
import { saveHistoryEntry } from './_lib/supabase.js';
import { badRequest, sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const entry = req.body;
    if (!entry || !entry.id || !Array.isArray(entry.questions)) {
      throw badRequest('A valid history entry (id, questions) is required.');
    }
    const saved = await saveHistoryEntry(entry);
    res.status(200).json(saved);
  } catch (err) {
    sendError(res, err);
  }
}
