import { requireAuth } from './_lib/auth.js';
import { createSignedDownloadUrl, deleteSavedPdf, listSavedPdfs, safeFilename, savedPdfExists } from './_lib/supabase.js';
import { notFound, sendError } from './_lib/http.js';

// Short-lived on purpose (docs/rules.md: "a signed URL generated fresh per
// request with a short expiry -- never long-lived/cached, never public").
const DOWNLOAD_URL_TTL_SECONDS = 300; // 5 minutes

// Serves /api/saved-pdfs, /api/saved-pdfs/:filename, and
// /api/saved-pdfs/:filename/download from this one flat file, via
// vercel.json rewrites that forward :filename/:action as query params --
// see history.js for why this replaced the double-bracket
// saved-pdfs/[[...path]].js file from the previous session (that
// convention isn't recognized by Vercel outside Next.js, so it 404'd in
// production).
function getFilenameAndAction(req) {
  const rawFilename = req.query.filename;
  const filename = (Array.isArray(rawFilename) ? rawFilename[0] : rawFilename) ?? null;
  const rawAction = req.query.action;
  const action = (Array.isArray(rawAction) ? rawAction[0] : rawAction) ?? null;
  return { filename, action };
}

export default async function handler(req, res) {
  try {
    const { filename: rawFilename, action } = getFilenameAndAction(req);

    if (rawFilename === null) {
      // /api/saved-pdfs -- list, same as before.
      if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      if (!requireAuth(req, res)) return;
      res.status(200).json(await listSavedPdfs());
      return;
    }

    const filename = safeFilename(rawFilename);

    if (action === null) {
      // /api/saved-pdfs/:filename -- delete one, same as before.
      if (req.method !== 'DELETE') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      if (!requireAuth(req, res)) return;
      const deleted = await deleteSavedPdf(filename);
      if (!deleted) throw notFound('Saved PDF not found.');
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'download') {
      // /api/saved-pdfs/:filename/download -- signed download URL, same as before.
      if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      if (!requireAuth(req, res)) return;
      if (!(await savedPdfExists(filename))) {
        throw notFound('Saved PDF not found.');
      }
      const url = await createSignedDownloadUrl(filename, DOWNLOAD_URL_TTL_SECONDS);
      res.status(200).json({ url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS });
      return;
    }

    // Any other action value never matched any of the three old file-based
    // routes either -- preserve that as a 404 rather than guessing.
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    sendError(res, err);
  }
}
