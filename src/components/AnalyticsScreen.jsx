import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { Bar, ErrorBanner, LoadingView, ScreenHeader, formatPercent } from './ui.jsx';

export default function AnalyticsScreen({ goHome }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/analytics').then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="screen">
      <ScreenHeader title="Analytics" onBack={goHome} />
      <ErrorBanner message={error} />
      {!data ? (
        <LoadingView />
      ) : data.totalQuizzesTaken === 0 ? (
        <p className="subtext">Finish a quiz to see analytics here.</p>
      ) : (
        <>
          <div className="row-gap">
            <div className="stat-tile">
              <div className="stat-number">{data.totalQuizzesTaken}</div>
              <p className="subtext">Quizzes taken</p>
            </div>
            <div className="stat-tile">
              <div className="stat-number">{formatPercent(data.overallAccuracy)}</div>
              <p className="subtext">Overall accuracy</p>
            </div>
          </div>

          <p className="section-label">Accuracy over time</p>
          {data.accuracyOverTime.map((e) => (
            <div key={e.id} style={{ marginBottom: 10 }}>
              <p className="subtext">
                {e.title} -- {formatPercent(e.accuracy)}
              </p>
              <Bar fraction={e.accuracy} />
            </div>
          ))}

          <p className="section-label">By source PDF</p>
          {data.perPdfAccuracy.map((p) => (
            <div key={p.sourcePdf} style={{ marginBottom: 10 }}>
              <p className="subtext">
                {p.sourcePdf} -- {formatPercent(p.accuracy)} ({p.correct}/{p.total})
              </p>
              <Bar fraction={p.accuracy} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
