import { PDFDocument } from 'pdf-lib';

// Reads only the page count from a PDF buffer -- used to enforce the
// 100-page limit (docs/rules.md #11) before any Gemini call is made. A
// real parser is used deliberately instead of a byte-regex page-count
// heuristic (e.g. counting `/Type /Page` occurrences): that approach can
// silently undercount pages for exactly the PDFs this app cares most
// about -- scanned/photographed documents from phone scanner apps, which
// commonly use compressed cross-reference streams / object streams that
// a plain text scan won't see into. `ignoreEncryption` and
// `updateMetadata: false` keep this tolerant of real-world PDFs that are
// still perfectly readable but not maximally "clean" PDF/A-style files.
export async function getPdfPageCount(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

// Checks every file in `files` (each `{ filename, buffer }`) against the
// page limit and returns null if all are within it, or `{ oversizedFiles,
// message }` if any aren't -- every offender is reported by name and page
// count in one result, not just the first one found (docs/design.md "PDF
// page count limit": "one oversized file among several shouldn't silently
// block the others -- surface which specific file(s) failed the check").
// A file whose page count can't be determined is skipped rather than
// treated as oversized -- this check exists to avoid a known-wasted Gemini
// call, not to be a stricter PDF validator than Gemini itself.
export async function checkPageLimits(files, maxPages = 100) {
  const oversizedFiles = [];
  for (const file of files) {
    let pageCount;
    try {
      pageCount = await getPdfPageCount(file.buffer);
    } catch (err) {
      console.error(`[pdf] could not read page count for ${file.filename}, skipping page-limit check:`, err);
      continue;
    }
    if (pageCount > maxPages) {
      oversizedFiles.push({ filename: file.filename, pageCount });
    }
  }
  if (oversizedFiles.length === 0) return null;

  const detail = oversizedFiles.map((f) => `"${f.filename}" (${f.pageCount} pages)`).join(', ');
  const message =
    oversizedFiles.length === 1
      ? `${detail} exceeds the ${maxPages}-page limit. Please split it or choose a shorter document.`
      : `These PDFs exceed the ${maxPages}-page limit: ${detail}. Please split them, choose shorter documents, or remove them from your selection.`;
  return { oversizedFiles, message };
}
