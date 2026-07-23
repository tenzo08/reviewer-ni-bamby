import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { useModals } from './Modals.jsx';
import { ErrorBanner, LoadingView, PrimaryButton, ScreenHeader, SecondaryButton } from './ui.jsx';
import { computeIsCorrect } from '../../shared/answerMatching.js';

export default function QuizScreen({ quiz, setQuiz, currentIndex, setCurrentIndex, difficulty, goHome, onFinish }) {
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Modified True or False, after picking "False": holds the draft
  // corrective term until the student submits it -- the answer isn't
  // finalized (scored/persisted) until then.
  const [pendingModifiedAnswer, setPendingModifiedAnswer] = useState('');
  const [awaitingCorrection, setAwaitingCorrection] = useState(false);
  // Identification: free-text draft answer.
  const [identificationDraft, setIdentificationDraft] = useState('');
  const { confirmAsync } = useModals();

  const question = quiz.questions[currentIndex];
  const answered = question.yourAnswer !== null;

  useEffect(() => {
    setAwaitingCorrection(false);
    setPendingModifiedAnswer('');
    setIdentificationDraft('');
  }, [currentIndex]);

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

  const finalizeAnswer = (yourAnswer, yourModifiedAnswer) => {
    const isCorrect = computeIsCorrect(question, yourAnswer, yourModifiedAnswer);
    const questions = quiz.questions.map((q, i) => {
      if (i !== currentIndex) return q;
      const next = { ...q, yourAnswer, isCorrect };
      if (q.type === 'modifiedTrueFalse' && q.modifiedAnswer !== undefined) {
        next.yourModifiedAnswer = yourModifiedAnswer ?? null;
      }
      return next;
    });
    const score = questions.filter((q) => q.isCorrect === true).length;
    const answeredCount = questions.filter((q) => q.yourAnswer !== null).length;
    const nextQuiz = { ...quiz, questions, score, answeredCount, completed: answeredCount === questions.length };
    setQuiz(nextQuiz);
    persist(nextQuiz);
  };

  const selectChoice = (choice) => {
    if (answered) return;
    if (question.type === 'modifiedTrueFalse' && choice === 'False') {
      setAwaitingCorrection(true);
      return;
    }
    finalizeAnswer(choice, null);
  };

  const submitCorrection = () => {
    finalizeAnswer('False', pendingModifiedAnswer.trim());
  };

  const submitIdentification = () => {
    if (!identificationDraft.trim()) return;
    finalizeAnswer(identificationDraft.trim(), null);
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
        json: { sourcePdfs: quiz.sourcePdfs, difficulty, previousQuestions, questionType: question.type },
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

  const isChoiceType = question.type !== 'identification';

  return (
    <div className="screen">
      <ScreenHeader
        title={quiz.title}
        subtitle={`Question ${currentIndex + 1} of ${quiz.questions.length}${saving ? ' · saving...' : ''}`}
        onBack={exitQuiz}
      />
      <ErrorBanner message={error} />

      <p className="question-text">{question.question}</p>

      {isChoiceType &&
        question.choices.map((choice) => {
          const isYourAnswer = choice === question.yourAnswer;
          const isCorrectAnswer = choice === question.correctAnswer;
          let className = 'choice';
          if (answered && isCorrectAnswer) className = 'choice correct';
          else if (answered && isYourAnswer && !isCorrectAnswer) className = 'choice incorrect';
          else if (!answered && awaitingCorrection && choice === 'False') className = 'choice active-pending';

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

      {isChoiceType && !answered && awaitingCorrection && (
        <div className="correction-prompt">
          <p className="section-label" style={{ marginTop: 0 }}>
            What's the correct term or reason?
          </p>
          <input
            className="input"
            value={pendingModifiedAnswer}
            onChange={(e) => setPendingModifiedAnswer(e.target.value)}
            placeholder="Type the correction..."
            autoFocus
          />
          <div className="row-gap">
            <SecondaryButton title="Back" onClick={() => setAwaitingCorrection(false)} />
            <PrimaryButton title="Submit" onClick={submitCorrection} disabled={!pendingModifiedAnswer.trim()} />
          </div>
        </div>
      )}

      {!isChoiceType && !answered && (
        <div className="correction-prompt">
          <input
            className="input"
            value={identificationDraft}
            onChange={(e) => setIdentificationDraft(e.target.value)}
            placeholder="Type your answer..."
            autoFocus
          />
          <PrimaryButton title="Submit answer" onClick={submitIdentification} disabled={!identificationDraft.trim()} style={{ marginTop: 12 }} />
        </div>
      )}

      {!isChoiceType && answered && (
        <div className={`choice ${question.isCorrect ? 'correct' : 'incorrect'}`} style={{ cursor: 'default' }}>
          Your answer: {question.yourAnswer}
        </div>
      )}

      {answered && (
        <div className="explanation-box">
          <p className="explanation-label">{question.isCorrect ? 'Correct!' : 'Not quite.'}</p>
          {question.type === 'modifiedTrueFalse' && question.modifiedAnswer !== undefined && (
            <p className="subtext">
              Correct term/reason: <strong>{question.modifiedAnswer}</strong>
              {question.yourModifiedAnswer ? ` (you said: ${question.yourModifiedAnswer})` : ''}
            </p>
          )}
          {question.type === 'identification' && !question.isCorrect && (
            <p className="subtext">
              Correct answer: <strong>{question.correctAnswer}</strong>
            </p>
          )}
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
