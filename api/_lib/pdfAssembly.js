import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

// Standard US Letter, in points -- each captured photo is scaled to fit
// inside this fixed page size (aspect ratio preserved, centered). Ported
// unchanged from the old backend's scan-to-pdf route.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// A scanned text page never needs full camera resolution (a phone photo is
// commonly 3000-4000px / 3-12MB) -- this is plenty for Gemini to read text
// off of, and keeps the assembled PDF (and the base64 payload later sent to
// Gemini) small regardless of how many pages a scan session has.
// docs/rules.md #10 / architecture.md "Known failure mode".
const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 80;

// Every incoming image -- whatever format the browser actually sent
// (camera-captured JPEG, a canvas-recompressed crop, or a desktop file-
// picker fallback in some other format) -- is normalized through sharp into
// a single known-good, size-capped JPEG before it ever reaches pdf-lib.
// This replaces the old mimetype-sniffing branch (`embedPng` vs
// `embedJpg` based on a client-reported Content-Type) entirely: rather than
// guessing which embed method matches the bytes, every image becomes a real
// JPEG we always embed with `embedJpg`, so a format mismatch can't produce
// a technically-invalid PDF that some readers tolerate but Gemini's parser
// rejects (architecture.md's failure mode #2).
async function normalizeImage(file) {
  try {
    const resized = await sharp(file.buffer)
      .rotate() // auto-orient from EXIF, then strip it, matching what the canvas crop path already bakes in
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    console.log(
      `[pdfAssembly] ${file.filename || '(unnamed)'}: ${file.buffer.length} -> ${resized.length} bytes ` +
        `(mimetype reported by browser: ${file.mimetype})`,
    );
    return resized;
  } catch (err) {
    console.error(`[pdfAssembly] could not decode "${file.filename || '(unnamed)'}" as an image:`, err);
    const e = new Error(
      `Could not process captured page "${file.filename || '(unnamed)'}" -- the file may be corrupt or in an unsupported image format.`,
    );
    e.status = 400;
    e.expose = true;
    throw e;
  }
}

export async function assemblePdfFromImages(files) {
  const pdfDoc = await PDFDocument.create();
  for (const file of files) {
    const jpegBuffer = await normalizeImage(file);
    const image = await pdfDoc.embedJpg(jpegBuffer);
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const scale = Math.min(PAGE_WIDTH / image.width, PAGE_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (PAGE_WIDTH - width) / 2,
      y: (PAGE_HEIGHT - height) / 2,
      width,
      height,
    });
  }
  const out = Buffer.from(await pdfDoc.save());
  console.log(`[pdfAssembly] assembled PDF: ${files.length} page(s), ${out.length} bytes (${(out.length / 1024 / 1024).toFixed(2)}MB)`);
  return out;
}
