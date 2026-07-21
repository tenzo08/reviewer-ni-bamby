import { PDFDocument } from 'pdf-lib';

// Standard US Letter, in points -- each captured photo is scaled to fit
// inside this fixed page size (aspect ratio preserved, centered). Ported
// unchanged from the old backend's scan-to-pdf route.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

async function embedImage(pdfDoc, file) {
  if (file.mimetype === 'image/png') return pdfDoc.embedPng(file.buffer);
  return pdfDoc.embedJpg(file.buffer);
}

export async function assemblePdfFromImages(files) {
  const pdfDoc = await PDFDocument.create();
  for (const file of files) {
    const image = await embedImage(pdfDoc, file);
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
  return Buffer.from(await pdfDoc.save());
}
