import { requireAuth } from '../../_lib/auth.js';
import { createSignedDownloadUrl, safeFilename, savedPdfExists } from '../../_lib/supabase.js';
import { notFound, sendError } from '../../_lib/http.js';

// Short-lived on purpose (docs/rules.md: "a signed URL generated fresh per
// request with a short expiry -- never long-lived/cached, never public").
// A few minutes is enough for the browser to actually fetch the file right
// after the client requests this URL, without leaving a long-lived link
// sitting around if it leaks (browser history, a copied link, etc).
const DOWNLOAD_URL_TTL_SECONDS = 300; // 5 minutes

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const filename = safeFilename(req.query.filename);
    if (!(await savedPdfExists(filename))) {
      throw notFound('Saved PDF not found.');
    }
    const url = await createSignedDownloadUrl(filename, DOWNLOAD_URL_TTL_SECONDS);
    res.status(200).json({ url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
  } catch (err) {
    sendError(res, err);
  }
}
