// Copies jscanify's bundled opencv.js build AND its client jscanify.js into
// public/, so both are served as same-origin static assets (no third-party
// CDN dependency, no WASM blob committed to git -- regenerated from
// node_modules like any other installed dependency). Runs via the
// "postinstall" npm script. Both files are loaded via `importScripts()`
// inside src/lib/scanWorker.js (a classic Worker, not a bundled ES module --
// these are legacy UMD/global-style scripts, not meant to go through Vite).
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destDir = path.join(rootDir, 'public');

const files = [
  { src: ['node_modules', 'jscanify', 'src', 'opencv.js'], dest: 'opencv.js' },
  { src: ['node_modules', 'jscanify', 'src', 'jscanify.js'], dest: 'jscanify.js' },
];

await mkdir(destDir, { recursive: true });
for (const { src, dest } of files) {
  try {
    await copyFile(path.join(rootDir, ...src), path.join(destDir, dest));
    console.log(`[copy-opencv] copied ${dest} into public/`);
  } catch (err) {
    console.warn(`[copy-opencv] could not copy ${dest} (scan auto-crop will fall back to uncropped originals):`, err.message);
  }
}
