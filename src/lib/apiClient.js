const TOKEN_KEY = 'reviewer-ni-bambyy:token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
// duplicate-conflict handling upstream).
export async function apiFetch(path, { method = 'GET', json, formData, timeoutMs = 60000 } = {}) {
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
  let res;
  try {
    res = await fetch(path, { method, headers, body, signal: controller.signal });
  } catch (e) {
    throw new Error('Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
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
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
