// Builds a fresh, shuffled quiz object from a completed/in-progress history
// entry for the "Retake" action (docs task Part A). Every answer field is
// reset and a brand-new id is minted so saving the result later (via the
// existing /api/save-quiz-result upsert-by-id) always inserts a new
// quiz_history row rather than overwriting the original.

// Fisher-Yates -- unbiased, O(n), doesn't mutate the input array.
export function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function slugify(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'quiz';
}

// Mirrors api/_lib/supabase.js's generateHistoryId format (docs/schema.md:
// timestamp-with-milliseconds + slugified title), with a "-retake-" marker
// so a retake's id can never collide with the original entry's id it was
// built from, even if generated in the same millisecond.
function generateRetakeId(title) {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const msPart = pad(now.getMilliseconds(), 3) + pad(Math.floor(Math.random() * 1000), 3);
  return `${datePart}-${timePart}-${msPart}-retake-${slugify(title)}`;
}

// correctAnswer is stored as the literal answer string (matched by value in
// shared/answerMatching.js), not a choice index -- so shuffling `choices`
// never requires touching correctAnswer itself, it stays correct by
// construction as long as it's copied through unchanged alongside the
// reordered array. Only multipleChoice's choices are shuffled (trueFalse/
// modifiedTrueFalse are always exactly ["True", "False"], nothing to gain
// from shuffling those two).
function resetQuestionForRetake(q) {
  const next = {
    type: q.type,
    question: q.question,
    correctAnswer: q.correctAnswer,
    yourAnswer: null,
    isCorrect: null,
    explanation: q.explanation,
  };
  if (q.choices) {
    next.choices = q.type === 'multipleChoice' ? shuffle(q.choices) : q.choices;
  }
  if (q.type === 'modifiedTrueFalse' && q.modifiedAnswer !== undefined) {
    next.modifiedAnswer = q.modifiedAnswer;
    next.yourModifiedAnswer = null;
  }
  return next;
}

export function buildRetakeQuiz(entry) {
  const questions = shuffle(entry.questions).map(resetQuestionForRetake);
  return {
    id: generateRetakeId(entry.title),
    title: entry.title,
    date: new Date().toISOString(),
    score: 0,
    total: questions.length,
    answeredCount: 0,
    completed: false,
    sourcePdfs: entry.sourcePdfs,
    questions,
  };
}
