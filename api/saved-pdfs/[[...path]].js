import { requireAuth } from '../_lib/auth.js';
import { createSignedDownloadUrl, deleteSavedPdf, listSavedPdfs, safeFilename, savedPdfExists } from '../_lib/supabase.js';
import { notFound, sendError } from '../_lib/http.js';

// Merges the old saved-pdfs.js (GET list), saved-pdfs/[filename].js
// (DELETE one) and saved-pdfs/[filename]/download.js (GET a signed
// download URL) into one file, for the same function-count reason as
// history/[[...id]].js. Same three URLs, same methods, same responses as
// before; only the file layout changed.
//
// Vercel passes whatever comes after /saved-pdfs/ as req.query.path, an
// array (e.g. ['x.pdf'] or ['x.pdf', 'download']). The local dev server
// instead matches separate Express patterns onto this same file and merges
// named params (filename/action) into req.query -- getSegments() below
// normalizes whichever shape is actually present.
function getSegments(req) {
  const raw = req.query.path;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return [raw];
  const segments = [];
  if (req.query.filename !== undefined) segments.push(req.query.filename);
  if (req.query.action !== undefined) segments.push(req.query.action);
  return segments;
}

// Short-lived on purpose (docs/rules.md: "a signed URL generated fresh per
// request with a short expiry -- never long-lived/cached, never public").
const DOWNLOAD_URL_TTL_SECONDS = 300; // 5 minutes

export default async function handler(req, res) {
  try {
    const segments = getSegments(req);

    if (segments.length === 0) {
      // /api/saved-pdfs -- list, same as before.
      if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      if (!requireAuth(req, res)) return;
      res.status(200).json(await listSavedPdfs());
      return;
    }

    const filename = safeFilename(segments[0]);

    if (segments.length === 1) {
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

    if (segments.length === 2 && segments[1] === 'download') {
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

    // Any other shape (extra segments, or a second segment that isn't
    // "download") never matched any of the three old file-based routes
    // either -- preserve that as a 404 rather than guessing.
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    sendError(res, err);
  }
}
