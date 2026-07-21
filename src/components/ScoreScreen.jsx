import { formatPercent, PrimaryButton, SecondaryButton } from './ui.jsx';

export default function ScoreScreen({ quiz, navigate, goHome }) {
  const missed = quiz.questions.filter((q) => q.isCorrect === false).length;
  return (
    <div className="screen center-fill">
      <h1 className="score-title">{quiz.title}</h1>
      <div className="score-big">
        {quiz.score} / {quiz.total}
      </div>
      <p className="subtext">{formatPercent(quiz.total ? quiz.score / quiz.total : 0)} correct</p>

      <div style={{ height: 24 }} />
      {missed > 0 && (
        <PrimaryButton title="Review Missed" onClick={() => navigate('reviewMissed')} style={{ marginBottom: 12 }} />
      )}
      <SecondaryButton title="Back to Home" onClick={goHome} />
    </div>
  );
}
