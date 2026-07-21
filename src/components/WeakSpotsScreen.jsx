import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { AnswerSummary, ErrorBanner, LoadingView, ScreenHeader, formatDate } from './ui.jsx';

export default function WeakSpotsScreen({ goHome }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/weak-spots').then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="screen">
      <ScreenHeader title="Weak Spots" onBack={goHome} />
      <ErrorBanner message={error} />
      {!data ? (
        <LoadingView />
      ) : data.missedQuestions.length === 0 ? (
        <p className="subtext">No missed questions yet -- keep it up!</p>
      ) : (
        <>
          <p className="section-label">By source PDF</p>
          {data.sourceBreakdown.map((s) => (
            <p key={s.sourcePdf} className="subtext">
              {s.sourcePdf} -- {s.missedCount} missed
            </p>
          ))}

          <p className="section-label">Missed questions</p>
          {data.missedQuestions.map((q, i) => (
            <div key={i} className="review-card">
              <p className="review-question">{q.question}</p>
              <AnswerSummary q={q} />
              <p className="subtext">{q.explanation}</p>
              <p className="subtext">
                {q.sourcePdfs.join(', ')} · {formatDate(q.date)}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
