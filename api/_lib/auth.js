import crypto from 'node:crypto';

// Lightweight access-gate (docs/rules.md section 3): a shared password
// checked server-side, exchanged for a signed, time-limited bearer token.
// Not full auth -- no accounts, no per-user identity -- just enough to
// stop a stranger who finds the deployed URL from burning Gemini quota.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  const secret = process.env.ACCESS_PASSWORD;
  if (!secret) {
    const err = new Error('Access gate is not configured on the server.');
    err.status = 500;
    err.expose = true;
    throw err;
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function checkPassword(password) {
  return timingSafeStringEqual(password, getSecret());
}

export function createToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeStringEqual(sig, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
}

// Every api/* route except auth-check.js calls this first. Never logs the
// token or the password, and 401s with a generic message.
export function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!verifyToken(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
