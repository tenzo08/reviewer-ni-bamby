// Classic (non-module) Worker: runs OpenCV.js edge detection + perspective
// correction off the main thread, so the scan staging screen's UI (remove/
// recapture/reorder/capture-another/compile) never freezes while a photo is
// being processed -- docs/design.md's "Performance/responsiveness
// requirements (non-negotiable)".
//
// `importScripts`, not a bundled ESM `import`: opencv.js and jscanify.js are
// legacy UMD/global-style scripts (see scripts/copy-opencv.mjs), the same
// files already proven to work loaded this way on the main thread.
importScripts('/opencv.js', '/jscanify.js');

// Loaded once per Worker instance, not once per photo: this Worker itself is
// created once and reused for the life of the scan staging screen (see
// scanCrop.js), so `cv`'s WASM runtime and jscanify only ever initialize a
// single time per scan session, regardless of how many photos get processed.
let cvReadyPromise = null;
function waitForCv() {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = new Promise((resolve, reject) => {
    if (self.cv && self.cv.Mat) {
      resolve();
      return;
    }
    if (!self.cv) {
      reject(new Error('opencv.js did not load into the worker.'));
      return;
    }
    self.cv['onRuntimeInitialized'] = resolve;
  });
  return cvReadyPromise;
}

function bitmapToMat(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return cv.matFromImageData(imageData);
}

// Ports cv.imshow's Mat -> ImageData conversion (see jscanify's vendored
// opencv.js) without its `instanceof HTMLCanvasElement` check, which rejects
// OffscreenCanvas outright -- there is no DOM/HTMLCanvasElement inside a
// Worker, so cv.imshow itself cannot be used here at all.
function matToImageData(mat) {
  const img = new cv.Mat();
  const depth = mat.type() % 8;
  const scale = depth <= cv.CV_8S ? 1 : depth <= cv.CV_32S ? 1 / 256 : 255;
  const shift = depth === cv.CV_8S || depth === cv.CV_16S ? 128 : 0;
  mat.convertTo(img, cv.CV_8U, scale, shift);
  switch (img.type()) {
    case cv.CV_8UC1:
      cv.cvtColor(img, img, cv.COLOR_GRAY2RGBA);
      break;
    case cv.CV_8UC3:
      cv.cvtColor(img, img, cv.COLOR_RGB2RGBA);
      break;
    case cv.CV_8UC4:
      break;
    default:
      img.delete();
      throw new Error('Bad number of channels (source image must have 1, 3 or 4 channels)');
  }
  const imageData = new ImageData(new Uint8ClampedArray(img.data), img.cols, img.rows);
  img.delete();
  return imageData;
}

async function matToJpegBlob(mat, quality) {
  const imageData = matToImageData(mat);
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

// Re-implements jscanify's `extractPaper` using its DOM-free primitives
// (`findPaperContour`, `getCornerPoints`) plus the manual warp+render above,
// since `extractPaper` itself calls `document.createElement('canvas')`
// internally and cannot run in a Worker.
async function extractPaper(scanner, img, outputWidth, outputHeight) {
  const maxContour = scanner.findPaperContour(img);
  if (!maxContour) return null;

  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = scanner.getCornerPoints(maxContour);
  if (!topLeftCorner || !topRightCorner || !bottomLeftCorner || !bottomRightCorner) {
    maxContour.delete();
    return null;
  }

  const warpedDst = new cv.Mat();
  const dsize = new cv.Size(outputWidth, outputHeight);
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeftCorner.x,
    topLeftCorner.y,
    topRightCorner.x,
    topRightCorner.y,
    bottomLeftCorner.x,
    bottomLeftCorner.y,
    bottomRightCorner.x,
    bottomRightCorner.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outputWidth, 0, 0, outputHeight, outputWidth, outputHeight]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  cv.warpPerspective(img, warpedDst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  try {
    return await matToJpegBlob(warpedDst, 0.9);
  } finally {
    maxContour.delete();
    warpedDst.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();
  }
}

self.onmessage = async (e) => {
  const { id, bitmap, outputWidth, outputHeight } = e.data;
  let img = null;
  try {
    await waitForCv();
    img = bitmapToMat(bitmap);
    bitmap.close();
    const scanner = new self.jscanify();
    const blob = await extractPaper(scanner, img, outputWidth, outputHeight);
    if (!blob || blob.size === 0) {
      self.postMessage({ id, success: false });
      return;
    }
    self.postMessage({ id, success: true, blob });
  } catch (err) {
    self.postMessage({ id, success: false, error: String((err && err.message) || err) });
  } finally {
    if (img) img.delete();
  }
};
