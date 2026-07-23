import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, LoadingView, ScreenHeader, SecondaryButton, formatDate } from './ui.jsx';

export default function HistoryScreen({ navigate, goHome, retakeQuiz }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [retakingId, setRetakingId] = useState(null);
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

  const startSelection = () => {
    setSelectionMode(true);
    setSelectedIds(new Set());
    setError('');
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = entries !== null && entries.length > 0 && selectedIds.size === entries.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(entries.map((e) => e.id)));
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const ok = await confirmAsync(
      'Delete selected results?',
      `Delete ${ids.length} quiz result${ids.length === 1 ? '' : 's'}? This can't be undone.`,
      'Delete',
    );
    if (!ok) return;
    setDeleting(true);
    setError('');
    const results = await Promise.allSettled(ids.map((id) => apiFetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' })));
    const failedCount = results.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) {
      setError(`Could not delete ${failedCount} of ${ids.length} selected result(s). Please try again.`);
    }
    setDeleting(false);
    setSelectionMode(false);
    setSelectedIds(new Set());
    load();
  };

  const retake = async (entry, ev) => {
    ev.stopPropagation();
    setError('');
    setRetakingId(entry.id);
    try {
      // The list view only has summaries (no questions[]) -- fetch the full
      // entry the same way HistoryDetailScreen does before building the
      // shuffled retake quiz from it.
      const full = await apiFetch(`/api/history/${encodeURIComponent(entry.id)}`);
      retakeQuiz(full);
    } catch (e) {
      setError(e.message);
    } finally {
      setRetakingId(null);
    }
  };

  const handleCardClick = (entry) => {
    if (selectionMode) {
      toggleSelected(entry.id);
    } else {
      navigate('historyDetail', { id: entry.id });
    }
  };

  const handleCardKeyDown = (e, entry) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(entry);
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
          {selectionMode && (
            <div className="history-selection-bar">
              <button type="button" className="link-button" onClick={toggleSelectAll}>
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              <span className="subtext">{selectedIds.size} selected</span>
            </div>
          )}

          {entries.map((e) => {
            const selected = selectedIds.has(e.id);
            return (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                className={`history-card${selectionMode ? ' history-card-selectable' : ''}${selected ? ' history-card-selected' : ''}`}
                onClick={() => handleCardClick(e)}
                onKeyDown={(ev) => handleCardKeyDown(ev, e)}
              >
                <div className="history-card-row">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      className="history-card-checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(e.id)}
                      onClick={(ev) => ev.stopPropagation()}
                      aria-label={`Select ${e.title}`}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <p className="history-card-title">{e.title}</p>
                    <p className="subtext">{formatDate(e.date)}</p>
                    <p className="subtext">{e.sourcePdfs.join(', ')}</p>
                    <p className={e.completed ? 'history-score' : 'history-in-progress'}>
                      {e.completed ? `${e.score} / ${e.total}` : `In progress · ${e.answeredCount}/${e.total} answered`}
                    </p>
                  </div>
                  {!selectionMode && (
                    <SecondaryButton
                      title={retakingId === e.id ? 'Loading...' : 'Retake'}
                      onClick={(ev) => retake(e, ev)}
                      disabled={retakingId !== null}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {selectionMode ? (
            <div className="row-gap" style={{ marginTop: 16 }}>
              <SecondaryButton title="Cancel" onClick={cancelSelection} disabled={deleting} />
              <SecondaryButton
                title={`Delete Selected (${selectedIds.size})`}
                onClick={deleteSelected}
                disabled={selectedIds.size === 0 || deleting}
              />
            </div>
          ) : (
            <div className="row-gap" style={{ marginTop: 16 }}>
              <SecondaryButton title="Select" onClick={startSelection} />
              <SecondaryButton title="Clear All History" onClick={clearAll} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
