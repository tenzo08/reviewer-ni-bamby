import jscanify from 'jscanify/client';

let cvLoadPromise = null;

// Lazily loads the self-hosted OpenCV.js build (public/opencv.js, copied
// from node_modules/jscanify by scripts/copy-opencv.mjs) only when the
// scan staging screen actually needs it -- never blocks any other screen's
// load, and per docs/rules.md #7 this is a best-effort enhancement: any
// failure here must resolve to "no auto-crop available" rather than throw
// somewhere the scan flow can't recover from.
function loadOpenCv(timeoutMs = 15000) {
  if (window.cv && window.cv.Mat) return Promise.resolve(window.cv);
  if (cvLoadPromise) return cvLoadPromise;

  cvLoadPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out loading the edge-detection library.'));
    }, timeoutMs);

    const onReady = () => {
      clearTimeout(timer);
      resolve(window.cv);
    };

    if (window.cv) {
      // Script tag already injected by an earlier call; opencv itself may
      // still be finishing its WASM init.
      window.cv['onRuntimeInitialized'] = onReady;
      return;
    }

    const script = document.createElement('script');
    script.src = '/opencv.js';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Could not load the edge-detection library.'));
    };
    script.onload = () => {
      if (!window.cv) {
        clearTimeout(timer);
        reject(new Error('Edge-detection library failed to initialize.'));
        return;
      }
      window.cv['onRuntimeInitialized'] = onReady;
    };
    document.head.appendChild(script);
  }).catch((err) => {
    // Don't cache a rejected load -- a later retry (e.g. next captured
    // page) should get a fresh attempt rather than being stuck failed
    // for the rest of the session.
    cvLoadPromise = null;
    throw err;
  });

  return cvLoadPromise;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the captured photo.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
  });
}

// Attempts client-side edge detection + perspective correction on a
// captured photo. Best-effort: any failure (library fails to load, no
// paper contour found, jscanify throws) resolves to { success: false }
// rather than rejecting, so the caller always has the uncropped original
// to fall back to -- this must never block the scan staging flow.
export async function autoCropImage(imageFile, { outputWidth = 1240, outputHeight = 1754 } = {}) {
  let url;
  try {
    await loadOpenCv();
    const { img, url: objectUrl } = await loadImageElement(imageFile);
    url = objectUrl;
    const scanner = new jscanify();
    const canvas = scanner.extractPaper(img, outputWidth, outputHeight);
    if (!canvas) return { success: false };
    const blob = await canvasToBlob(canvas);
    if (!blob || blob.size === 0) return { success: false };
    return { success: true, blob };
  } catch (err) {
    console.warn('[scanCrop] auto-crop failed, falling back to the original photo:', err);
    return { success: false };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
