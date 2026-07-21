// Copies jscanify's bundled opencv.js build into public/, so it's served
// as a same-origin static asset (no third-party CDN dependency, no WASM
// blob committed to git -- it's regenerated from node_modules like any
// other installed dependency). Runs via the "postinstall" npm script.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(rootDir, 'node_modules', 'jscanify', 'src', 'opencv.js');
const destDir = path.join(rootDir, 'public');
const dest = path.join(destDir, 'opencv.js');

try {
  await mkdir(destDir, { recursive: true });
  await copyFile(src, dest);
  console.log('[copy-opencv] copied opencv.js into public/');
} catch (err) {
  console.warn('[copy-opencv] could not copy opencv.js (scan auto-crop will fall back to uncropped originals):', err.message);
}
