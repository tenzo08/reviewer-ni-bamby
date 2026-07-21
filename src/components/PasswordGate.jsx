import { useState } from 'react';
import { login } from '../lib/apiClient.js';
import { ErrorBanner, PrimaryButton } from './ui.jsx';

export default function PasswordGate({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="center-fill">
      <h1 className="app-title" style={{ marginTop: 0 }}>
        Reviewer ni Bambyy
      </h1>
      <p className="app-subtitle">Enter password to continue</p>
      <form className="gate-form" onSubmit={submit}>
        <ErrorBanner message={error} />
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          placeholder="Password"
        />
        <PrimaryButton type="submit" title="Continue" loading={submitting} disabled={!password} />
      </form>
    </div>
  );
}
