import { useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, LoadingView, ScreenHeader, SecondaryButton } from './ui.jsx';

export default function QuizScreen({ quiz, setQuiz, currentIndex, setCurrentIndex, difficulty, goHome, onFinish }) {
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { confirmAsync } = useModals();

  const question = quiz.questions[currentIndex];
  const answered = question.yourAnswer !== null;

  const persist = async (nextQuiz) => {
    setSaving(true);
    try {
      await apiFetch('/api/save-quiz-result', { method: 'POST', json: nextQuiz });
    } catch (e) {
      // non-fatal, keep playing locally even if a save fails
    } finally {
      setSaving(false);
    }
  };

  const selectChoice = (choice) => {
    if (answered) return;
    const questions = quiz.questions.map((q, i) =>
      i === currentIndex ? { ...q, yourAnswer: choice, isCorrect: choice === q.correctAnswer } : q,
    );
    const score = questions.filter((q) => q.isCorrect === true).length;
    const answeredCount = questions.filter((q) => q.yourAnswer !== null).length;
    const nextQuiz = { ...quiz, questions, score, answeredCount, completed: answeredCount === questions.length };
    setQuiz(nextQuiz);
    persist(nextQuiz);
  };

  const goNext = () => {
    if (currentIndex + 1 < quiz.questions.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onFinish(quiz);
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const regenerate = async () => {
    setError('');
    setRegenerating(true);
    try {
      const previousQuestions = quiz.questions.map((q) => q.question);
      const newQuestion = await apiFetch('/api/regenerate-question', {
        method: 'POST',
        json: { sourcePdfs: quiz.sourcePdfs, difficulty, previousQuestions },
        timeoutMs: 90000,
      });
      const questions = quiz.questions.map((q, i) => (i === currentIndex ? newQuestion : q));
      const nextQuiz = { ...quiz, questions };
      setQuiz(nextQuiz);
      persist(nextQuiz);
    } catch (e) {
      setError(e.message);
    } finally {
      setRegenerating(false);
    }
  };

  const exitQuiz = async () => {
    const ok = await confirmAsync(
      'Exit quiz?',
      'Your progress so far will be saved, and you can resume this quiz later from History.',
      'Exit',
      false,
    );
    if (ok) goHome();
  };

  return (
    <div className="screen">
      <ScreenHeader
        title={quiz.title}
        subtitle={`Question ${currentIndex + 1} of ${quiz.questions.length}${saving ? ' · saving...' : ''}`}
        onBack={exitQuiz}
      />
      <ErrorBanner message={error} />

      <p className="question-text">{question.question}</p>

      {question.choices.map((choice) => {
        const isYourAnswer = choice === question.yourAnswer;
        const isCorrectAnswer = choice === question.correctAnswer;
        let className = 'choice';
        if (answered && isCorrectAnswer) className = 'choice correct';
        else if (answered && isYourAnswer && !isCorrectAnswer) className = 'choice incorrect';

        return (
          <button
            key={choice}
            type="button"
            className={className}
            onClick={() => selectChoice(choice)}
            disabled={answered}
          >
            {choice}
          </button>
        );
      })}

      {answered && (
        <div className="explanation-box">
          <p className="explanation-label">{question.isCorrect ? 'Correct!' : 'Not quite.'}</p>
          <p className="subtext">{question.explanation}</p>
        </div>
      )}

      {!answered && (
        <SecondaryButton title="Regenerate this question" onClick={regenerate} disabled={regenerating} style={{ marginTop: 16 }} />
      )}
      {regenerating && <LoadingView label="Generating a new question..." />}

      <div className="row-gap">
        <SecondaryButton title="Previous" onClick={goPrev} disabled={currentIndex === 0} />
        <button type="button" className="btn btn-primary" onClick={goNext} disabled={!answered}>
          {currentIndex + 1 === quiz.questions.length ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}
