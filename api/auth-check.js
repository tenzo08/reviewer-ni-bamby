import { checkPassword, createToken } from './_lib/auth.js';
import { sendError } from './_lib/http.js';

// Not gated by requireAuth -- this route IS the mechanism that grants the
// token in the first place (docs/design.md's access gate).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { password } = req.body || {};
    if (!checkPassword(password)) {
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }
    res.status(200).json({ token: createToken() });
  } catch (err) {
    sendError(res, err);
  }
}
