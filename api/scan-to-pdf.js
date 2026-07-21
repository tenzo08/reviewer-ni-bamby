import { requireAuth } from './_lib/auth.js';
import { parseMultipart } from './_lib/multipart.js';
import { checkSaveConflict } from './_lib/conflict.js';
import { safeFilename, saveSavedPdf } from './_lib/supabase.js';
import { assemblePdfFromImages } from './_lib/pdfAssembly.js';
import { badRequest, sendError } from './_lib/http.js';

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

function ensurePdfExtension(filename) {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const { fields, files } = await parseMultipart(req, { maxFileSize: 15 * 1024 * 1024, maxFiles: 50 });
    const images = files.filter((f) => f.fieldname === 'images');
    if (images.length === 0) {
      throw badRequest('No captured images provided.');
    }
    if (!fields.filename) {
      throw badRequest('A filename is required.');
    }

    const filename = ensurePdfExtension(safeFilename(fields.filename));
    const duplicateResolution = fields.duplicateResolution ? JSON.parse(fields.duplicateResolution) : {};

    // Same shared duplicate-conflict logic (409 + Replace/Use Existing) as
    // the normal upload path in generate-quiz.js -- see _lib/conflict.js.
    const { conflict, useExisting } = await checkSaveConflict(filename, duplicateResolution[filename]);
    if (conflict) {
      res.status(409).json({ conflicts: [{ filename }] });
      return;
    }

    if (!useExisting) {
      // Raw images are processed in memory for this request only, then
      // discarded -- only the assembled PDF persists.
      const pdfBuffer = await assemblePdfFromImages(images);
      await saveSavedPdf(filename, pdfBuffer);
    }

    res.status(200).json({ filename });
  } catch (err) {
    sendError(res, err);
  }
}
