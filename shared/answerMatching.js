// Answer-matching logic shared by every place a student's answer gets
// scored against a question's correctAnswer/modifiedAnswer: quiz-taking and
// resume (src/components/QuizScreen.jsx), server-side persistence
// (api/_lib/supabase.js), and history/review display (src/components/
// ui.jsx's AnswerSummary). One implementation, imported everywhere, so
// "is this answer correct" can never drift between what's shown live and
// what's stored/reviewed later.
//
// Deliberately deterministic string logic only -- no AI/Gemini call, no
// fuzzy/typo tolerance. The only leniency added beyond exact (normalized)
// matching is candidate extraction: a correctAnswer/modifiedAnswer written
// as "X (Y)", "X/Y", or "X or Y" is treated as accepting X, Y, or the full
// string, since Gemini sometimes phrases a single correct answer with a
// parenthetical/alternate term (e.g. "Indomethacin (Indocin)",
// "Pleuritis/Pleurisy") that a student correctly answering with just one
// side of it shouldn't be marked wrong for.

// Splits a correctAnswer/modifiedAnswer string into every literal string
// that should count as correct. No parentheses/slash/"or" found -> just the
// original string, unchanged from the pre-existing exact-match behavior.
export function extractAnswerCandidates(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return [];
  const candidates = new Set([str]);

  // Parenthetical alternate: "X (Y)" -> also accept "X" and "Y" on their own.
  const parenMatch = str.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (parenMatch) {
    if (parenMatch[1].trim()) candidates.add(parenMatch[1].trim());
    if (parenMatch[2].trim()) candidates.add(parenMatch[2].trim());
  }

  // Slash-separated: "X/Y" -> also accept each side on its own.
  if (str.includes('/')) {
    for (const part of str.split('/')) {
      if (part.trim()) candidates.add(part.trim());
    }
  }

  // "or"-separated (whole word, case-insensitive): "X or Y" -> "X", "Y".
  if (/\bor\b/i.test(str)) {
    for (const part of str.split(/\s+or\s+/i)) {
      if (part.trim()) candidates.add(part.trim());
    }
  }

  return [...candidates];
}

// Lowercase, trim, collapse internal whitespace, strip trailing punctuation.
export function normalizeAnswerText(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

// True if the student's answer (after normalization) equals ANY normalized
// candidate extracted from correctAnswerRaw.
export function answerMatches(studentAnswer, correctAnswerRaw) {
  const normalizedStudent = normalizeAnswerText(studentAnswer);
  return extractAnswerCandidates(correctAnswerRaw)
    .map(normalizeAnswerText)
    .includes(normalizedStudent);
}

// Type-aware correctness check for a whole question:
// - identification: candidate-aware match against correctAnswer.
// - modifiedTrueFalse: correctAnswer must match exactly (True/False is
//   never a candidate-extraction target), and when it's "False" the
//   student's corrective term must also candidate-match modifiedAnswer.
// - everything else (multipleChoice, trueFalse): plain exact match, exactly
//   as before -- these are picked from an exact choices[] list, so there's
//   nothing to extend leniency for.
export function computeIsCorrect(question, yourAnswer, yourModifiedAnswer) {
  if (question.type === 'identification') {
    return answerMatches(yourAnswer, question.correctAnswer);
  }
  if (question.type === 'modifiedTrueFalse') {
    if (yourAnswer !== question.correctAnswer) return false;
    if (question.correctAnswer === 'False') {
      return answerMatches(yourModifiedAnswer, question.modifiedAnswer);
    }
    return true;
  }
  return yourAnswer === question.correctAnswer;
}
