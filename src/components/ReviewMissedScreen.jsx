import { ScreenHeader } from './ui.jsx';

export default function ReviewMissedScreen({ quiz, goBack }) {
  const missed = quiz.questions.filter((q) => q.isCorrect === false);
  return (
    <div className="screen">
      <ScreenHeader title="Review Missed" onBack={goBack} />
      {missed.length === 0 ? (
        <p className="subtext">Nothing missed -- great job!</p>
      ) : (
        missed.map((q, i) => (
          <div key={i} className="review-card">
            <p className="review-question">{q.question}</p>
            <p className="review-incorrect">Your answer: {q.yourAnswer}</p>
            <p className="review-correct">Correct answer: {q.correctAnswer}</p>
            <p className="subtext">{q.explanation}</p>
          </div>
        ))
      )}
    </div>
  );
}
