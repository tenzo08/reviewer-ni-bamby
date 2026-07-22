import { requireAuth } from './_lib/auth.js';
import { checkSaveConflict } from './_lib/conflict.js';
import { createSignedUploadUrl, safeFilename } from './_lib/supabase.js';
import { badRequest, sendError } from './_lib/http.js';

export const maxDuration = 30;

// Step one of a two-step upload (see api/generate-quiz.js for step two):
// resolves duplicate-filename conflicts exactly like the old direct-upload
// flow did, then hands back a signed Storage upload URL per file that
// isn't a conflict/reuse -- the browser PUTs the actual PDF bytes straight
// to Supabase Storage from there, never through this function's body.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const { filenames, duplicateResolution = {} } = req.body || {};
    if (!Array.isArray(filenames) || filenames.length === 0) {
      throw badRequest('No filenames provided.');
    }

    const entries = filenames.map((raw) => ({ raw, filename: safeFilename(raw) }));

    const conflicts = [];
    for (const { filename } of entries) {
      const { conflict } = await checkSaveConflict(filename, duplicateResolution[filename]);
      if (conflict) conflicts.push({ filename });
    }
    if (conflicts.length > 0) {
      res.status(409).json({ conflicts });
      return;
    }

    const uploads = {};
    for (const { raw, filename } of entries) {
      const { useExisting } = await checkSaveConflict(filename, duplicateResolution[filename]);
      if (useExisting) {
        uploads[raw] = { filename, useExisting: true };
      } else {
        const { signedUrl, path, token } = await createSignedUploadUrl(filename);
        uploads[raw] = { filename, useExisting: false, signedUrl, path, token };
      }
    }
    res.status(200).json({ uploads });
  } catch (err) {
    sendError(res, err);
  }
}
