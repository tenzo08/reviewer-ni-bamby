// A scanned page never needs full camera resolution (a phone photo is
// commonly 3000-4000px) for edge detection or for a legible crop -- this is
// downscaled before handing off to the worker, per docs/design.md's
// "Photos are downscaled before edge detection runs" requirement. The
// output crop still targets a modest, OCR-adequate size (see
// autoCropImage's defaults below), which Part A's server-side compression
// re-caps further anyway, so there's no reason to preserve more detail than
// this through the crop step.
const MAX_PROCESS_EDGE = 1600;

let worker = null;
let requestId = 0;
const pending = new Map();

// The Worker (and, inside it, the OpenCV.js WASM runtime + jscanify) loads
// once per scan session, not once per photo: this module-level `worker`
// variable is created lazily on the first captured photo and reused for
// every photo after that, for as long as the page stays loaded.
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./scanWorker.js', import.meta.url));
  worker.onmessage = (e) => {
    const { id, success, blob, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timeoutId);
    if (error) console.warn('[scanCrop] worker reported an error:', error);
    entry.resolve(success ? { success: true, blob } : { success: false });
  };
  worker.onerror = (e) => {
    console.warn('[scanCrop] scan worker crashed, falling back to uncropped originals for any pending photos:', e.message);
    for (const entry of pending.values()) {
      clearTimeout(entry.timeoutId);
      entry.resolve({ success: false });
    }
    pending.clear();
    // Don't keep reusing a dead worker -- the next captured photo gets a
    // fresh one rather than being stuck failing for the rest of the session.
    worker = null;
  };
  return worker;
}

async function createDownscaledBitmap(file) {
  const full = await createImageBitmap(file);
  const longEdge = Math.max(full.width, full.height);
  if (longEdge <= MAX_PROCESS_EDGE) return full;
  const scale = MAX_PROCESS_EDGE / longEdge;
  const resized = await createImageBitmap(full, {
    resizeWidth: Math.round(full.width * scale),
    resizeHeight: Math.round(full.height * scale),
    resizeQuality: 'high',
  });
  full.close();
  return resized;
}

// Attempts client-side edge detection + perspective correction on a
// captured photo, via a Worker so the main thread (and therefore the rest
// of the scan staging screen's UI) is never blocked while it runs. Best-
// effort: any failure (worker unavailable, no paper contour found, a
// timeout) resolves to { success: false } rather than rejecting, so the
// caller always has the uncropped original to fall back to -- this must
// never block the scan staging flow (docs/rules.md #7).
export async function autoCropImage(imageFile, { outputWidth = 1240, outputHeight = 1754, timeoutMs = 15000 } = {}) {
  let bitmap;
  try {
    bitmap = await createDownscaledBitmap(imageFile);
  } catch (err) {
    console.warn('[scanCrop] could not read the captured photo, falling back to the original:', err);
    return { success: false };
  }

  return new Promise((resolve) => {
    const id = ++requestId;
    const timeoutId = setTimeout(() => {
      pending.delete(id);
      console.warn('[scanCrop] auto-crop timed out, falling back to the original photo');
      resolve({ success: false });
    }, timeoutMs);
    pending.set(id, { resolve, timeoutId });

    try {
      getWorker().postMessage({ id, bitmap, outputWidth, outputHeight }, [bitmap]);
    } catch (err) {
      clearTimeout(timeoutId);
      pending.delete(id);
      console.warn('[scanCrop] could not hand the photo off to the worker, falling back to the original:', err);
      resolve({ success: false });
    }
  });
}
