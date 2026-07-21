import { savedPdfExists } from './supabase.js';

// Shared duplicate-conflict check used by every route that writes into the
// saved-pdfs bucket (generate-quiz's normal upload path, and scan-to-pdf) --
// one function, not two copies, per architecture.md. A filename that
// already exists with no resolution yet blocks the write with a 409 so the
// client can prompt Replace / Use Existing / Cancel.
// `resolution` is 'replace' | 'useExisting' | undefined.
export async function checkSaveConflict(filename, resolution) {
  const exists = await savedPdfExists(filename);
  if (exists && !resolution) return { conflict: true, useExisting: false };
  return { conflict: false, useExisting: exists && resolution === 'useExisting' };
}
