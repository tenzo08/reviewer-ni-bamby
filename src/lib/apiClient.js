const TOKEN_KEY = 'reviewer-ni-bambyy:token';

// sessionStorage, not localStorage (docs/rules.md #3): sessions are
// per-tab and per-device, not global. Closing the tab/browser must end
// the session and require the password again next time -- and since
// sessionStorage is never shared between tabs/windows (let alone across
// devices), one tab's token being cleared (e.g. on a 401) can no longer
// silently log out sibling tabs/windows the way a shared localStorage key
// did.
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function login(password) {
  const res = await fetch('/api/auth-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || 'Incorrect password.');
  }
  setToken(data.token);
  return data.token;
}

// Shared fetch wrapper for every /api/* call: attaches the access-gate
// token, handles JSON or FormData bodies, and normalizes errors the same
// way the mobile app's apiFetch did (err.status / err.data for 409
// duplicate-conflict handling upstream). An optional external `signal`
// lets a caller cancel the request early (used by the progress-loss guard
// to actually stop an in-flight upload/generation when the user confirms
// leaving, not just hide its loading state).
export async function apiFetch(path, { method = 'GET', json, formData, timeoutMs = 60000, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (formData) {
    body = formData;
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body, signal: controller.signal });
  } catch (e) {
    throw new Error('Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  if (res.status === 401) {
    clearToken();
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // no/invalid body
  }

  if (!res.ok) {
    // A real JSON error body from our own routes always wins (specific,
    // safe-to-show message per docs/rules.md #10). When there's no body at
    // all -- a raw platform-level failure that never reached our own
    // try/catch -- fall back to something that still tells a real story
    // instead of one hardcoded string for every possible cause.
    let message = data && data.error;
    if (!message) {
      if (res.status === 504) {
        message = `The server timed out handling this request (HTTP 504). Try again, or with fewer/smaller PDFs.`;
      } else if (res.status >= 500) {
        message = `The server encountered an unexpected error (HTTP ${res.status}). Please try again.`;
      } else {
        message = `Request failed (HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}).`;
      }
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Like apiFetch, but for an endpoint that streams a binary response
// (compile-pdf.js) instead of returning JSON -- returns a Blob on success,
// still surfaces a real JSON error body on failure exactly like apiFetch
// does, since a failed request from that route is still plain JSON (the
// route only switches to `application/pdf` after every entry lookup has
// already succeeded).
export async function apiFetchBlob(path, { method = 'GET', json, timeoutMs = 60000 } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined, signal: controller.signal });
  } catch (e) {
    throw new Error('Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) clearToken();

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message = (data && data.error) || `Request failed (HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}).`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

// Uploads a File directly to the signed Supabase Storage URL handed back by
// /api/prepare-upload -- bypasses the Vercel function body entirely, which
// is what actually avoids the platform's ~4.5MB request size limit for
// larger PDFs (see api/generate-quiz.js for the full explanation). No
// Supabase credential of any kind is involved here: the signed URL is a
// single-use, expiring token minted server-side with the service role key.
export async function uploadToSignedUrl(signedUrl, file, signal) {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'application/pdf',
      'x-upsert': 'true',
      'cache-control': 'max-age=3600',
    },
    body: file,
    signal,
  });
  if (!res.ok) {
    throw new Error(`Could not upload ${file.name} (HTTP ${res.status}). Please try again.`);
  }
}
