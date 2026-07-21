export function PrimaryButton({ title, onClick, disabled, loading, style }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      style={style}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <span className="spinner" style={{ borderTopColor: '#fff', width: 20, height: 20 }} /> : title}
    </button>
  );
}

export function SecondaryButton({ title, onClick, disabled, style }) {
  return (
    <button type="button" className="btn btn-secondary" style={style} onClick={onClick} disabled={disabled}>
      {title}
    </button>
  );
}

export function ScreenHeader({ title, onBack, subtitle }) {
  return (
    <div className="header-row">
      {onBack ? (
        <button type="button" className="back-button" onClick={onBack}>
          ‹ Back
        </button>
      ) : (
        <div className="back-button" />
      )}
      <div style={{ flex: 1 }}>
        <h1 className="header-title">{title}</h1>
        {subtitle ? <p className="header-subtitle">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="error-banner">{message}</div>;
}

export function LoadingView({ label = 'Loading...' }) {
  return (
    <div className="center-fill">
      <div className="spinner" />
      <p className="subtext" style={{ marginTop: 12 }}>
        {label}
      </p>
    </div>
  );
}

export function Bar({ fraction, color }) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso;
  }
}

export function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return '--';
  return `${Math.round(fraction * 100)}%`;
}

function normalizeMatch(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Type-aware "your answer / correct answer" summary, shared by
// ReviewMissedScreen, HistoryDetailScreen, and WeakSpotsScreen so a
// question's answer renders consistently everywhere it can appear --
// including modifiedTrueFalse's corrective term and identification's
// plain free-text answer, neither of which fit the old MC-only choice list.
export function AnswerSummary({ q }) {
  if (q.type === 'modifiedTrueFalse') {
    const answerCorrect = q.yourAnswer === q.correctAnswer;
    const modifiedCorrect =
      q.modifiedAnswer === undefined || normalizeMatch(q.yourModifiedAnswer) === normalizeMatch(q.modifiedAnswer);
    return (
      <>
        <p className={answerCorrect ? 'review-correct' : 'review-incorrect'}>
          Your answer: {q.yourAnswer} (correct: {q.correctAnswer})
        </p>
        {q.modifiedAnswer !== undefined && (
          <p className={modifiedCorrect ? 'review-correct' : 'review-incorrect'}>
            Correct term/reason: {q.modifiedAnswer}
            {q.yourModifiedAnswer ? ` -- you said: ${q.yourModifiedAnswer}` : ''}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <p className="review-incorrect">Your answer: {q.yourAnswer}</p>
      <p className="review-correct">Correct answer: {q.correctAnswer}</p>
    </>
  );
}
