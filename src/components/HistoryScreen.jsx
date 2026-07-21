import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, LoadingView, ScreenHeader, SecondaryButton, formatDate } from './ui.jsx';

export default function HistoryScreen({ navigate, goHome }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const { confirmAsync } = useModals();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/history');
      setEntries(data);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clearAll = async () => {
    const ok = await confirmAsync('Clear all history?', 'This deletes every saved quiz result. This cannot be undone.', 'Clear All');
    if (!ok) return;
    try {
      await apiFetch('/api/history', { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title="History" onBack={goHome} />
      <ErrorBanner message={error} />

      {entries === null ? (
        <LoadingView label="Loading history..." />
      ) : entries.length === 0 ? (
        <p className="subtext">No quizzes yet.</p>
      ) : (
        <>
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              className="history-card"
              onClick={() => navigate('historyDetail', { id: e.id })}
            >
              <p className="history-card-title">{e.title}</p>
              <p className="subtext">{formatDate(e.date)}</p>
              <p className="subtext">{e.sourcePdfs.join(', ')}</p>
              <p className={e.completed ? 'history-score' : 'history-in-progress'}>
                {e.completed ? `${e.score} / ${e.total}` : `In progress · ${e.answeredCount}/${e.total} answered`}
              </p>
            </button>
          ))}
          <SecondaryButton title="Clear All History" onClick={clearAll} style={{ marginTop: 16 }} />
        </>
      )}
    </div>
  );
}
