import express from 'express';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.LOCAL_API_PORT) || 3001;

// ---------------------------------------------------------------------------
// Vercel Node.js runtime emulation
//
// Traced from node_modules/@vercel/node/dist/dev-server.mjs -- the exact
// package `vercel dev` itself runs -- rather than guessed. Key findings:
//
// - A Vercel Function gets (req, res) where req = IncomingMessage +
//   {query, body} and res = ServerResponse + {status, json, send,
//   redirect}. Express's `res` already implements `.status(code)` /
//   `.json(obj)` with the identical chainable signature Vercel's helpers
//   use, so no res shimming is needed -- only req.query/req.body.
// - For any method other than GET/HEAD, Vercel ALWAYS buffers the entire
//   request body into memory first (see `serializeBody`/`readBody` in
//   dev-server.mjs), regardless of Content-Type. There is no real
//   `config.api.bodyParser: false` opt-out for plain (non-Next.js) Vercel
//   Functions -- that convention is Next.js-specific and simply isn't read
//   by this runtime.
// - After buffering, Vercel replays those bytes back onto `req` (see
//   `restoreBody`) by monkey-patching `req.read`/`req.on`/`req.pipe` so a
//   handler that reads the raw stream itself still works. Every current
//   route only reads `req.body` (JSON), but this replay behavior is kept
//   as general Vercel-runtime parity, not route-specific code, in case a
//   future route needs the raw stream again.
// - Vercel's own restoreBody does NOT override req.pipe, only
//   req.on/req.addListener/req.read. That's not enough here: by the time
//   restoreBody runs, req's own internal _readableState already recorded
//   'end' as emitted (streamToBuffer fully drained the real socket to
//   build the buffer), so Readable.prototype.pipe's fast path -- it
//   checks `state[kEndEmitted]` before even calling req.once('end', ...)
//   -- skips the .on()/.once() redirection entirely and schedules
//   dest.end() on the very next tick, racing against the replay stream's
//   still-in-flight data delivery. Confirmed by reproducing it in
//   isolation (plain http + busboy, no Express): busboy received .end()
//   before all bytes arrived and threw "Unexpected end of form". The fix
//   below (also overriding req.pipe to delegate straight to the fresh,
//   not-yet-consumed replay stream) closes that gap.
// - req.body is then derived from that same buffer by Content-Type:
//   application/json -> parsed object, application/x-www-form-urlencoded
//   -> parsed object, text/plain -> string, application/octet-stream ->
//   raw Buffer, anything else (multipart/form-data included) -> undefined,
//   left for the handler to parse itself.
//
// One deliberate simplification vs. the original: Vercel exposes req.body
// as a lazy getter (only parsed if a handler reads it); this parses body
// eagerly per-request and 400s on malformed JSON up front. None of this
// app's own routes send malformed JSON, so the difference is not
// observable in practice, but it means a malformed-JSON request would 400
// slightly earlier here than it would on Vercel itself.
// ---------------------------------------------------------------------------

function normalizeContentType(contentType) {
  if (!contentType) return 'text/plain';
  return contentType.split(';')[0].trim().toLowerCase();
}

function streamToBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function restoreBody(req, body) {
  const replay = new PassThrough();
  const originalOn = req.on.bind(req);
  req.read = replay.read.bind(replay);
  req.on = req.addListener = (name, cb) =>
    name === 'data' || name === 'end' ? replay.on(name, cb) : originalOn(name, cb);
  // See note above: route req.pipe(dest) straight to replay.pipe(dest) so
  // it uses replay's own fresh internal state, not req's already-ended one.
  req.pipe = replay.pipe.bind(replay);
  replay.write(body);
  replay.end();
}

function parseBody(body, contentType) {
  const type = normalizeContentType(contentType);
  if (type === 'application/json') {
    const str = body.toString();
    return str ? JSON.parse(str) : {};
  }
  if (type === 'application/octet-stream') return body;
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(body.toString()));
  }
  if (type === 'text/plain') return body.toString();
  // multipart/form-data and anything else: left undefined, same as
  // Vercel -- the handler reads the raw (restored) stream itself.
  return undefined;
}

async function addVercelHelpers(req, res, next) {
  try {
    const contentType = req.headers['content-type'];
    let body = Buffer.from('');
    if (contentType !== undefined) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await streamToBuffer(req);
      }
      restoreBody(req, body);
    }
    req.body = parseBody(body, contentType);
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid request body.' });
  }
}

// ---------------------------------------------------------------------------
// Route table: mirrors Vercel's file-based api/ routing exactly (see
// docs/architecture.md's repo layout). Bracketed segments ([id],
// [filename]) become Express :params; their matched value is merged into
// req.query right before the handler runs, matching how Vercel exposes
// dynamic route segments to the function.
// ---------------------------------------------------------------------------

const routes = [
  ['/api/auth-check', 'auth-check.js'],
  ['/api/generate-quiz', 'generate-quiz.js'],
  ['/api/prepare-upload', 'prepare-upload.js'],
  ['/api/regenerate-question', 'regenerate-question.js'],
  ['/api/save-quiz-result', 'save-quiz-result.js'],
  ['/api/compile-pdf', 'compile-pdf.js'],
  // history/[[...id]].js and saved-pdfs/[[...path]].js are each ONE real
  // file answering multiple URLs (Vercel's optional-catch-all convention),
  // so multiple entries below intentionally point at the same file --
  // this table has no other way to express "one function, several paths"
  // since it's a manual mirror of Vercel's routing, not real file-based
  // routing itself.
  ['/api/history', 'history/[[...id]].js'],
  ['/api/history/:id', 'history/[[...id]].js'],
  ['/api/weak-spots', 'weak-spots.js'],
  ['/api/analytics', 'analytics.js'],
  ['/api/saved-pdfs', 'saved-pdfs/[[...path]].js'],
  ['/api/saved-pdfs/:filename/:action', 'saved-pdfs/[[...path]].js'],
  ['/api/saved-pdfs/:filename', 'saved-pdfs/[[...path]].js'],
];

// Same variable names api/_lib/{auth,gemini,supabase}.js already read from
// process.env -- checked here only to print a friendlier startup warning.
// Each route's own handler still enforces these for real (e.g. auth.js's
// requireAuth, gemini.js's getClient) -- this is not a second gate.
const REQUIRED_ENV = ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ACCESS_PASSWORD'];

async function main() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.warn(
      `[local-api-server] missing env var(s): ${missing.join(', ')} -- ` +
        'routes that need them will return their real "not configured" error until .env.local is filled in.',
    );
  }

  const app = express();
  app.disable('x-powered-by');

  for (const [routePath, file] of routes) {
    const mod = await import(pathToFileURL(path.resolve('api', file)).href);
    const handler = mod.default;
    app.all(routePath, addVercelHelpers, async (req, res) => {
      req.query = { ...req.query, ...req.params };
      try {
        await handler(req, res);
      } catch (err) {
        console.error(`[local-api-server] ${routePath} threw:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Something went wrong. Please try again.' });
        }
      }
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(PORT, () => {
    console.log(`[local-api-server] listening on http://localhost:${PORT}`);
  });
}

main();
