import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, LoadingView, PrimaryButton, ScreenHeader, SecondaryButton, formatDate } from './ui.jsx';

export default function HistoryDetailScreen({ historyId, goBack, resumeQuiz }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const { confirmAsync } = useModals();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/history/${encodeURIComponent(historyId)}`);
      setEntry(data);
    } catch (e) {
      setError(e.message);
    }
  }, [historyId]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    const ok = await confirmAsync('Delete this quiz?', 'This result will be permanently deleted.', 'Delete');
    if (!ok) return;
    try {
      await apiFetch(`/api/history/${encodeURIComponent(historyId)}`, { method: 'DELETE' });
      goBack();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) {
    return (
      <div className="screen">
        <ScreenHeader title="Quiz Detail" onBack={goBack} />
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (!entry) return <LoadingView />;

  return (
    <div className="screen">
      <ScreenHeader title={entry.title} subtitle={formatDate(entry.date)} onBack={goBack} />
      <p className="subtext">{entry.sourcePdfs.join(', ')}</p>
      <p className={entry.completed ? 'history-score' : 'history-in-progress'}>
        {entry.completed ? `${entry.score} / ${entry.total}` : `In progress · ${entry.answeredCount}/${entry.total} answered`}
      </p>

      {entry.questions.map((q, i) => (
        <div key={i} className="review-card">
          <p className="review-question">{`Q${i + 1}. ${q.question}`}</p>
          {q.choices.map((choice) => {
            const isYourAnswer = choice === q.yourAnswer;
            const isCorrectAnswer = choice === q.correctAnswer;
            let className = 'review-choice subtext';
            if (isCorrectAnswer) className = 'review-choice review-correct';
            else if (isYourAnswer) className = 'review-choice review-incorrect';
            return (
              <span key={choice} className={className}>
                {isYourAnswer ? '● ' : '○ '}
                {choice}
              </span>
            );
          })}
          <p className="subtext">{q.explanation}</p>
        </div>
      ))}

      <div style={{ height: 16 }} />
      {!entry.completed && <PrimaryButton title="Resume Quiz" onClick={() => resumeQuiz(entry)} style={{ marginBottom: 12 }} />}
      <SecondaryButton title="Delete" onClick={remove} />
    </div>
  );
}
