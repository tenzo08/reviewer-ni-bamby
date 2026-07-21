import { GoogleGenAI } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// The four concrete question types a single question can be. "mixed" is a
// generation-request-level option (docs/design.md "Question type selection
// (expanded)") that distributes questions across these four -- it is never
// a per-question `type` value itself.
const CONCRETE_TYPES = ['multipleChoice', 'trueFalse', 'modifiedTrueFalse', 'identification'];

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('Quiz generation is not configured on the server.');
    err.status = 500;
    err.expose = true;
    throw err;
  }
  return new GoogleGenAI({ apiKey });
}

function badGeminiResponse(message) {
  const err = new Error(message);
  err.status = 502;
  err.expose = true;
  return err;
}

// Mixed mode distributes questions round-robin across the four concrete
// types (e.g. 10 questions -> roughly 3/3/2/2) rather than leaving the
// blend up to the model -- this keeps generation deterministic and keeps
// per-question `type` assignment (needed for scoring, regeneration, and
// quiz-taking UI) unambiguous.
function assignMixedTypes(numQuestions) {
  return Array.from({ length: numQuestions }, (_, i) => CONCRETE_TYPES[i % CONCRETE_TYPES.length]);
}

function typeShape(type) {
  switch (type) {
    case 'multipleChoice':
      return `{
  "type": "multipleChoice",
  "question": "string",
  "choices": ["string", "string", "string", "string"],
  "correctAnswer": "string, must exactly match one of the choices",
  "explanation": "string, briefly explains why the correct answer is correct"
}`;
    case 'trueFalse':
      return `{
  "type": "trueFalse",
  "question": "string, a single statement that is either true or false",
  "choices": ["True", "False"],
  "correctAnswer": "the string \\"True\\" or the string \\"False\\"",
  "explanation": "string, briefly explains why the statement is true or false"
}`;
    case 'modifiedTrueFalse':
      return `{
  "type": "modifiedTrueFalse",
  "question": "string, a single statement that is either true or false",
  "choices": ["True", "False"],
  "correctAnswer": "the string \\"True\\" or the string \\"False\\"",
  "modifiedAnswer": "string -- ONLY include this key at all when correctAnswer is \\"False\\": the correct term/reason that fixes the false statement. Do NOT include this key when correctAnswer is \\"True\\".",
  "explanation": "string, briefly explains the correction"
}`;
    case 'identification':
      return `{
  "type": "identification",
  "question": "string, phrased so it has exactly one short, specific correct answer term (no choices are shown to the student)",
  "correctAnswer": "string, the exact term/phrase being identified",
  "explanation": "string, briefly explains the answer"
}`;
    default:
      throw new Error(`Unknown question type: ${type}`);
  }
}

function buildQuizPrompt({ numQuestions, difficulty, questionType }) {
  const types =
    questionType === 'mixed' ? assignMixedTypes(numQuestions) : Array.from({ length: numQuestions }, () => questionType);
  const perQuestionLines = types.map((t, i) => `- Question ${i + 1} must be of type "${t}".`).join('\n');
  const distinctTypes = [...new Set(types)];
  const shapeBlocks = distinctTypes.map((t) => `Shape for a "${t}" question:\n${typeShape(t)}`).join('\n\n');

  return `You are generating a quiz from the attached PDF document(s).

Generate exactly ${numQuestions} questions at "${difficulty}" difficulty. Every question must be
answerable strictly from the content of the attached document(s) -- do not invent facts that
aren't in the source material.

Each question has a required type, in this exact order:
${perQuestionLines}

Every question object's shape depends on its type:

${shapeBlocks}

Also come up with a short, descriptive title for this quiz based on the document content.

Return ONLY valid JSON (no markdown code fences, no commentary) matching exactly this shape:
{
  "title": "string",
  "questions": [ /* exactly ${numQuestions} question objects, in order, each shaped per its type above */ ]
}`;
}

function buildRegenerateQuestionPrompt({ difficulty, previousQuestions, questionType }) {
  const avoidList =
    previousQuestions && previousQuestions.length
      ? `\n\nDo not repeat or closely rephrase any of these already-used questions:\n${previousQuestions
          .map((q) => `- ${q}`)
          .join('\n')}`
      : '';

  return `Generate ONE new question from the attached PDF document(s), at "${difficulty}" difficulty,
of type "${questionType}". It must be answerable strictly from the content of the attached
document(s).${avoidList}

Shape for a "${questionType}" question:
${typeShape(questionType)}

Return ONLY valid JSON (no markdown code fences, no commentary) matching exactly the shape above.`;
}

function filesToParts(files) {
  return files.map((f) => ({
    inlineData: {
      mimeType: 'application/pdf',
      data: f.buffer.toString('base64'),
    },
  }));
}

function extractJson(text) {
  const trimmed = (text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const jsonText = fenced ? fenced[1] : trimmed;
  return JSON.parse(jsonText);
}

async function callGemini(promptText, files) {
  const ai = getClient();
  const contents = [{ text: promptText }, ...filesToParts(files)];
  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { responseMimeType: 'application/json' },
    });
  } catch (err) {
    // Never forward the raw SDK error (it can echo request details) to the client.
    console.error('[gemini] request failed:', err);
    throw badGeminiResponse('Quiz generation failed. Please try again.');
  }

  try {
    return extractJson(response.text);
  } catch (err) {
    console.error('[gemini] failed to parse response as JSON:', response.text);
    throw badGeminiResponse('Quiz generation returned an unexpected response. Please try again.');
  }
}

// Validates AND normalizes a single raw question object from Gemini into
// the exact shape docs/schema.md expects -- `type` is always set from our
// own expectation (not trusted from the model's echo), `modifiedAnswer` is
// stripped entirely unless it's a modifiedTrueFalse question whose
// correctAnswer is "False" (per schema.md: absent for True statements and
// every other type). Returns null if the question is unusable.
function normalizeQuestion(raw, expectedType) {
  if (!raw || typeof raw.question !== 'string' || !raw.question.trim()) return null;
  if (typeof raw.explanation !== 'string' || !raw.explanation.trim()) return null;
  const base = { type: expectedType, question: raw.question, explanation: raw.explanation };

  if (expectedType === 'multipleChoice') {
    if (!Array.isArray(raw.choices) || raw.choices.length !== 4) return null;
    if (typeof raw.correctAnswer !== 'string' || !raw.choices.includes(raw.correctAnswer)) return null;
    return { ...base, choices: raw.choices, correctAnswer: raw.correctAnswer };
  }

  if (expectedType === 'trueFalse') {
    if (raw.correctAnswer !== 'True' && raw.correctAnswer !== 'False') return null;
    return { ...base, choices: ['True', 'False'], correctAnswer: raw.correctAnswer };
  }

  if (expectedType === 'modifiedTrueFalse') {
    if (raw.correctAnswer !== 'True' && raw.correctAnswer !== 'False') return null;
    const question = { ...base, choices: ['True', 'False'], correctAnswer: raw.correctAnswer };
    if (raw.correctAnswer === 'False') {
      if (typeof raw.modifiedAnswer !== 'string' || !raw.modifiedAnswer.trim()) return null;
      question.modifiedAnswer = raw.modifiedAnswer.trim();
    }
    return question;
  }

  if (expectedType === 'identification') {
    if (typeof raw.correctAnswer !== 'string' || !raw.correctAnswer.trim()) return null;
    return { ...base, correctAnswer: raw.correctAnswer.trim() };
  }

  return null;
}

export async function generateQuiz({ files, numQuestions, difficulty, questionType }) {
  const types =
    questionType === 'mixed' ? assignMixedTypes(numQuestions) : Array.from({ length: numQuestions }, () => questionType);
  const parsed = await callGemini(buildQuizPrompt({ numQuestions, difficulty, questionType }), files);
  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.questions) || parsed.questions.length !== numQuestions) {
    throw badGeminiResponse('Quiz generation returned an unexpected response. Please try again.');
  }
  const questions = parsed.questions.map((q, i) => normalizeQuestion(q, types[i]));
  if (questions.some((q) => q === null)) {
    throw badGeminiResponse('Quiz generation returned an unexpected response. Please try again.');
  }
  return { title: parsed.title, questions };
}

export async function regenerateQuestion({ files, difficulty, previousQuestions, questionType }) {
  const parsed = await callGemini(buildRegenerateQuestionPrompt({ difficulty, previousQuestions, questionType }), files);
  const question = normalizeQuestion(parsed, questionType);
  if (!question) {
    throw badGeminiResponse('Question generation returned an unexpected response. Please try again.');
  }
  return question;
}

// Converts a normalized generated question (generateQuiz/regenerateQuestion
// output) into the "at rest" shape stored in quiz_history.questions[] and
// returned to the client: adds student-answer tracking fields. `choices`
// is only present when normalizeQuestion set it (absent for
// identification); `modifiedAnswer`/`yourModifiedAnswer` are only present
// for a modifiedTrueFalse question whose correctAnswer is "False" --
// absent for True statements and every other type, per docs/schema.md.
export function toStoredQuestion(question) {
  const stored = {
    type: question.type,
    question: question.question,
    correctAnswer: question.correctAnswer,
    yourAnswer: null,
    isCorrect: null,
    explanation: question.explanation,
  };
  if (question.choices) stored.choices = question.choices;
  if (question.type === 'modifiedTrueFalse' && question.modifiedAnswer !== undefined) {
    stored.modifiedAnswer = question.modifiedAnswer;
    stored.yourModifiedAnswer = null;
  }
  return stored;
}
