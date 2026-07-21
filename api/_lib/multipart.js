import busboy from 'busboy';

// Parses multipart/form-data straight into memory buffers -- uploaded PDFs
// and captured images are never written to disk, per docs/rules.md's "no
// server-side filesystem persistence" rule (which applies even to
// request-scoped scratch data, not just things meant to survive between
// invocations).
export function parseMultipart(req, { maxFileSize = 25 * 1024 * 1024, maxFiles = 50 } = {}) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: maxFileSize, files: maxFiles } });
    } catch (err) {
      reject(err);
      return;
    }

    const fields = {};
    const files = [];
    let fileSizeExceeded = false;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (name, stream, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => {
        fileSizeExceeded = true;
      });
      stream.on('end', () => {
        files.push({ fieldname: name, filename, mimetype: mimeType, buffer: Buffer.concat(chunks) });
      });
    });

    bb.on('error', fail);

    bb.on('close', () => {
      if (settled) return;
      settled = true;
      if (fileSizeExceeded) {
        const err = new Error('One or more files exceeded the size limit.');
        err.status = 400;
        err.expose = true;
        reject(err);
        return;
      }
      resolve({ fields, files });
    });

    req.pipe(bb);
  });
}
