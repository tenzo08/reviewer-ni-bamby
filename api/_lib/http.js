// Centralized error shaping, mirrors the old Express error handler: only
// ever sends `err.message` to the client when the route explicitly marked
// it safe (`err.expose = true`) -- every other error gets a generic
// message so nothing internal (e.g. GEMINI_API_KEY, Supabase errors) can
// leak into a response.
export function sendError(res, err) {
  console.error(err);
  const status = err.status || 500;
  const message = err.expose ? err.message : 'Something went wrong. Please try again.';
  res.status(status).json({ error: message });
}

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

export function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  err.expose = true;
  return err;
}
