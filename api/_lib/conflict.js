import { savedPdfExists } from './supabase.js';

// Shared duplicate-conflict check used by prepare-upload.js before minting
// a signed Storage upload URL for a new filename. A filename that already
// exists with no resolution yet blocks the write with a 409 so the client
// can prompt Replace / Use Existing / Cancel.
// `resolution` is 'replace' | 'useExisting' | undefined.
export async function checkSaveConflict(filename, resolution) {
  const exists = await savedPdfExists(filename);
  if (exists && !resolution) return { conflict: true, useExisting: false };
  return { conflict: false, useExisting: exists && resolution === 'useExisting' };
}
