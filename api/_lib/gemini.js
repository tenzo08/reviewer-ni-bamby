import { GoogleGenAI, Type } from '@google/genai';

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

// Structural counterpart to typeShape() below: a real JSON Schema handed to
// Gemini as `responseSchema` (constrained decoding), not just prompt text.
// This is what actually prevents the collapsed "unexpected response"
// failure on real-world documents -- prompt-only instructions are just a
// strong suggestion the model can drift from on a long/complex document;
// responseSchema makes the shape structurally guaranteed by the API itself
// (valid JSON, exact array length, required fields, enum values). It can't
// enforce cross-field semantics (e.g. correctAnswer exactly equalling one
// of choices verbatim), so normalizeQuestion()'s validation stays in place
// as a second line of defense.
function typeSchema(type) {
  const base = {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, enum: [type] },
      question: { type: Type.STRING, minLength: '1' },
      explanation: { type: Type.STRING, minLength: '1' },
    },
  };
  switch (type) {
    case 'multipleChoice':
      return {
        ...base,
        properties: {
          ...base.properties,
          choices: { type: Type.ARRAY, items: { type: Type.STRING, minLength: '1' }, minItems: '4', maxItems: '4' },
          correctAnswer: { type: Type.STRING, minLength: '1' },
        },
        required: ['type', 'question', 'choices', 'correctAnswer', 'explanation'],
      };
    case 'trueFalse':
      return {
        ...base,
        properties: {
          ...base.properties,
          choices: { type: Type.ARRAY, items: { type: Type.STRING, enum: ['True', 'False'] }, minItems: '2', maxItems: '2' },
          correctAnswer: { type: Type.STRING, enum: ['True', 'False'] },
        },
        required: ['type', 'question', 'choices', 'correctAnswer', 'explanation'],
      };
    case 'modifiedTrueFalse':
      return {
        ...base,
        properties: {
          ...base.properties,
          choices: { type: Type.ARRAY, items: { type: Type.STRING, enum: ['True', 'False'] }, minItems: '2', maxItems: '2' },
          correctAnswer: { type: Type.STRING, enum: ['True', 'False'] },
          modifiedAnswer: { type: Type.STRING, minLength: '1' },
        },
        required: ['type', 'question', 'choices', 'correctAnswer', 'explanation'],
      };
    case 'identification':
      return {
        ...base,
        properties: {
          ...base.properties,
          correctAnswer: { type: Type.STRING, minLength: '1' },
        },
        required: ['type', 'question', 'correctAnswer', 'explanation'],
      };
    default:
      throw new Error(`Unknown question type: ${type}`);
  }
}

function buildQuizResponseSchema(types) {
  const distinctTypes = [...new Set(types)];
  return {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, minLength: '1' },
      questions: {
        type: Type.ARRAY,
        minItems: String(types.length),
        maxItems: String(types.length),
        items: distinctTypes.length === 1 ? typeSchema(distinctTypes[0]) : { anyOf: distinctTypes.map(typeSchema) },
      },
    },
    required: ['title', 'questions'],
  };
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

// Both routes that call into this module (generate-quiz.js,
// regenerate-question.js) set `export const maxDuration = 60`. If the
// Gemini call itself is left to run unbounded, a slow request gets killed
// by Vercel's platform-level timeout instead of our own code -- the client
// then sees an opaque 504 with no JSON body at all. Aborting a little
// early lets us return a real, specific error instead.
const GEMINI_TIMEOUT_MS = 50000;

// Maps whatever the SDK actually threw into a specific, safe-to-show
// message -- distinguishing size/timeout/rate-limit/server-side causes
// instead of collapsing every failure into one generic string (docs/
// rules.md #10). The full error (which can include request-echoing detail
// we don't want to hand to the client) is always logged server-side via
// console.error before this runs, so the real cause is still in Vercel's
// function logs even when the client-facing message stays generic-ish.
function describeGeminiFailure(err, elapsedMs) {
  if (err && err.name === 'AbortError') {
    return `Quiz generation timed out after ${Math.round(elapsedMs / 1000)}s. Try fewer pages or a smaller document.`;
  }
  const status = err && (err.status || err.statusCode);
  if (status === 413) {
    return 'The document is too large for Gemini to process. Try a smaller PDF or fewer pages.';
  }
  if (status === 400) {
    return 'Gemini rejected the document as malformed or unreadable (HTTP 400).';
  }
  if (status === 429) {
    return 'Gemini API rate limit or quota exceeded. Wait a moment and try again.';
  }
  if (status === 503 || status === 500) {
    return "Gemini's service is temporarily unavailable (HTTP " + status + '). Please try again shortly.';
  }
  if (status) {
    return `Quiz generation failed (Gemini returned HTTP ${status}). Please try again.`;
  }
  return 'Quiz generation failed -- could not reach Gemini. Check your connection and try again.';
}

async function callGemini(promptText, files, responseSchema, externalSignal) {
  const ai = getClient();
  const contents = [{ text: promptText }, ...filesToParts(files)];
  const totalBase64Bytes = files.reduce((sum, f) => sum + Math.ceil(f.buffer.length / 3) * 4, 0);
  console.log(
    `[gemini] sending ${files.length} file(s) to ${MODEL}, raw bytes=${files.reduce((s, f) => s + f.buffer.length, 0)}, ` +
      `base64 bytes=${totalBase64Bytes} (${(totalBase64Bytes / 1024 / 1024).toFixed(2)}MB)`,
  );
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  // `externalSignal` is tied to the incoming request's own connection (see
  // generate-quiz.js / regenerate-question.js: req.on('close', ...)) so
  // that a client-side abort (tab closed, "leave anyway" on the
  // progress-loss guard) actually cancels the in-flight Gemini call instead
  // of just abandoning the response -- the function would otherwise keep
  // running and billing until GEMINI_TIMEOUT_MS regardless of the browser
  // having already given up.
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }
  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { responseMimeType: 'application/json', responseSchema, abortSignal: controller.signal },
    });
    console.log(`[gemini] request succeeded in ${Date.now() - startedAt}ms`);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    // Never forward the raw SDK error (it can echo request details) to the client.
    console.error(`[gemini] request failed after ${elapsedMs}ms:`, err);
    throw badGeminiResponse(describeGeminiFailure(err, elapsedMs));
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }

  try {
    return extractJson(response.text);
  } catch (err) {
    // With responseSchema in place this should be rare (Gemini's
    // constrained decoding guarantees valid JSON) -- if it still happens,
    // it means the response was cut off (finishReason MAX_TOKENS is the
    // likely cause), which is worth telling the user directly rather than
    // folding into the same message as a shape-validation failure below.
    console.error(`[gemini] failed to parse response as JSON (finishReason=${response.candidates?.[0]?.finishReason}):`, response.text);
    throw badGeminiResponse(
      'Gemini returned a response that could not be parsed as JSON -- this usually means the response was cut off. Try fewer questions or fewer/smaller PDFs.',
    );
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

export async function generateQuiz({ files, numQuestions, difficulty, questionType, signal }) {
  const types =
    questionType === 'mixed' ? assignMixedTypes(numQuestions) : Array.from({ length: numQuestions }, () => questionType);
  const parsed = await callGemini(buildQuizPrompt({ numQuestions, difficulty, questionType }), files, buildQuizResponseSchema(types), signal);
  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.questions) || parsed.questions.length !== numQuestions) {
    const got = parsed && Array.isArray(parsed.questions) ? parsed.questions.length : 0;
    throw badGeminiResponse(`Gemini returned an incomplete quiz (expected ${numQuestions} question(s), got ${got}). Try fewer questions or fewer/smaller PDFs.`);
  }
  const questions = parsed.questions.map((q, i) => normalizeQuestion(q, types[i]));
  const badIndex = questions.findIndex((q) => q === null);
  if (badIndex !== -1) {
    throw badGeminiResponse(
      `Gemini returned a malformed question (question ${badIndex + 1} of ${numQuestions} had missing or invalid fields). Please try again.`,
    );
  }
  return { title: parsed.title, questions };
}

export async function regenerateQuestion({ files, difficulty, previousQuestions, questionType, signal }) {
  const parsed = await callGemini(
    buildRegenerateQuestionPrompt({ difficulty, previousQuestions, questionType }),
    files,
    typeSchema(questionType),
    signal,
  );
  const question = normalizeQuestion(parsed, questionType);
  if (!question) {
    throw badGeminiResponse('Gemini returned a malformed question (missing or invalid fields). Please try again.');
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
