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

// gemini-2.5-flash has "thinking" (extended reasoning) on by default with a
// dynamic/automatic budget (thinkingBudget -1) -- and thinking tokens are
// drawn from the SAME pool as maxOutputTokens, not a separate budget. That
// means an unbounded thinking budget can eat the entire output allowance on
// a long/dense source PDF regardless of how generous maxOutputTokens looks
// on paper, truncating the actual JSON mid-object. This -- not simply "no
// maxOutputTokens was set" -- is why even a small 5-question request on a
// normal (non-scanned) PDF was hitting this: neither field was being set
// explicitly at all, so both defaulted, and the automatic thinking budget
// is not predictable request-to-request. Bounding thinkingBudget to a
// fixed value AND sizing maxOutputTokens around that fixed budget plus the
// real JSON payload size is what makes the headroom actually reliable
// instead of a hopeful guess that happens to work for small requests.
const THINKING_BUDGET_TOKENS = 2048;
const BASE_OUTPUT_TOKENS = 1024; // title + JSON structure/punctuation overhead, plus safety margin
const OUTPUT_TOKENS_PER_QUESTION = 400; // generous per-question estimate (4 choices + explanation)
const MAX_OUTPUT_TOKENS_CEILING = 32768; // sane hard ceiling regardless of how large numQuestions is

// Scales with the number of questions being requested in *this* call so a
// 20-30 question request gets proportionally more room, not just enough
// for the common 5-question case.
function computeMaxOutputTokens(numQuestions) {
  const needed = THINKING_BUDGET_TOKENS + BASE_OUTPUT_TOKENS + OUTPUT_TOKENS_PER_QUESTION * Math.max(1, numQuestions);
  return Math.min(needed, MAX_OUTPUT_TOKENS_CEILING);
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

// The @google/genai SDK's ApiError only exposes `.status` -- there is no
// `.details`/`.code` property on the error object itself. The full Google
// API error body (which DOES have the structured detail we need) is
// JSON.stringify'd into `.message` by the SDK's own throwErrorIfNotOK
// (see node_modules/@google/genai/dist/node/index.mjs), so it has to be
// parsed back out. Not every error is an ApiError with a JSON message
// (network errors, AbortError, etc.), so this returns null rather than
// throwing when the shape doesn't match.
function parseGeminiErrorBody(err) {
  try {
    const parsed = JSON.parse(err.message);
    return (parsed && parsed.error) || null;
  } catch {
    return null;
  }
}

// Distinguishes a per-minute rate limit from a per-day quota exhaustion on
// a 429 (docs/rules.md #12) using whatever Google's response actually
// provides, not a guess dressed up as certainty:
//
// - The reliable signal: a 429's `error.details` can include a
//   `type.googleapis.com/google.rpc.QuotaFailure` entry whose
//   `violations[].quotaId` names the quota explicitly, e.g.
//   "GenerateRequestsPerDayPerProjectPerModel-FreeTier" -- confirmed
//   against a real 429 captured while testing this app. A quotaId
//   containing "PerDay" or "PerMinute" is treated as authoritative.
// - What this deliberately does NOT do: infer per-minute vs. daily from
//   `error.details`'s RetryInfo.retryDelay alone. That was the originally
//   suggested fallback (a short retry-after "strongly suggests" per-
//   minute), but the one real daily-quota 429 this app has actually
//   captured reported a retryDelay of ~37-48 seconds -- short, exactly
//   the range that heuristic would call "per-minute." Since retryDelay
//   demonstrably does not distinguish the two cases in practice, treating
//   it as a signal here would be presenting a guess as certain, which
//   rules.md #12 and this session's instructions both explicitly rule
//   out. When quotaId doesn't clearly say either way, this returns
//   'unknown' honestly instead.
// Exported (alongside describeRateLimit below) purely so this pure,
// stateless classification logic can be unit-tested against realistic
// mocked 429 payloads without making a real Gemini API call -- see
// scripts/test-rate-limit-classification.mjs.
export function classifyRateLimit(err) {
  const body = parseGeminiErrorBody(err);
  const details = Array.isArray(body && body.details) ? body.details : [];
  const quotaId =
    details.find((d) => typeof d['@type'] === 'string' && d['@type'].includes('QuotaFailure'))?.violations?.[0]
      ?.quotaId || null;
  const retryDelayRaw =
    details.find((d) => typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo'))?.retryDelay || null;
  const retryDelaySeconds = retryDelayRaw ? parseFloat(retryDelayRaw) : null;

  if (quotaId && /perday/i.test(quotaId)) return { kind: 'daily', quotaId, retryDelaySeconds };
  if (quotaId && /perminute/i.test(quotaId)) return { kind: 'perMinute', quotaId, retryDelaySeconds };
  return { kind: 'unknown', quotaId, retryDelaySeconds };
}

export function describeRateLimit({ kind }) {
  if (kind === 'perMinute') {
    return "You're sending requests too quickly -- wait about a minute and try again.";
  }
  if (kind === 'daily') {
    return 'Daily API limit reached. This resets at midnight Pacific time.';
  }
  // Genuinely couldn't tell which one this was (see classifyRateLimit) --
  // give real guidance without pretending to know.
  return (
    "Gemini API rate limit or quota exceeded, and it wasn't possible to tell which from the response. " +
    "If waiting a minute and retrying doesn't work, it's the daily quota, which resets around midnight Pacific time."
  );
}

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
    return describeRateLimit(classifyRateLimit(err));
  }
  if (status === 503 || status === 500) {
    return "Gemini's service is temporarily unavailable (HTTP " + status + '). Please try again shortly.';
  }
  if (status) {
    return `Quiz generation failed (Gemini returned HTTP ${status}). Please try again.`;
  }
  return 'Quiz generation failed -- could not reach Gemini. Check your connection and try again.';
}

async function callGemini(promptText, files, responseSchema, externalSignal, maxOutputTokens) {
  const ai = getClient();
  const contents = [{ text: promptText }, ...filesToParts(files)];
  const totalBase64Bytes = files.reduce((sum, f) => sum + Math.ceil(f.buffer.length / 3) * 4, 0);
  console.log(
    `[gemini] sending ${files.length} file(s) to ${MODEL}, raw bytes=${files.reduce((s, f) => s + f.buffer.length, 0)}, ` +
      `base64 bytes=${totalBase64Bytes} (${(totalBase64Bytes / 1024 / 1024).toFixed(2)}MB), maxOutputTokens=${maxOutputTokens}`,
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
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        maxOutputTokens,
        // Bounded, not -1 (automatic) -- see the comment above
        // computeMaxOutputTokens() for why an unbounded thinking budget is
        // the real reason this was truncating.
        thinkingConfig: { thinkingBudget: THINKING_BUDGET_TOKENS },
        abortSignal: controller.signal,
      },
    });
    console.log(`[gemini] request succeeded in ${Date.now() - startedAt}ms`);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const status = err && (err.status || err.statusCode);
    // Never forward the raw SDK error (it can echo request details) to the client.
    console.error(`[gemini] request failed after ${elapsedMs}ms:`, err);
    if (status === 429) {
      // Separate, structured log line specifically for the rate-limit/
      // quota case (docs/rules.md #12: "log enough detail... to later
      // determine, from logs alone, which of the two situations actually
      // occurred") -- the console.error above already has the full raw
      // error, but this makes the classification itself greppable without
      // having to manually parse that JSON blob every time.
      const { kind, quotaId, retryDelaySeconds } = classifyRateLimit(err);
      console.error(`[gemini] 429 classified as kind=${kind} quotaId=${quotaId} retryDelaySeconds=${retryDelaySeconds}`);
    }
    // A 429 of either kind is deliberately NOT tagged `.truncated` here --
    // generateQuiz()'s retry-with-fewer-questions safety net only fires on
    // that flag, and retrying a rate-limited or quota-exhausted request
    // would just waste another attempt against the same wall (rules.md
    // #12). Every path that DOES set `.truncated` lives further down,
    // after a response was actually received.
    throw badGeminiResponse(describeGeminiFailure(err, elapsedMs));
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const blockReason = response.promptFeedback?.blockReason;

  // A prompt can be rejected before generation even starts (blockReason
  // set, no candidates at all) -- distinct from a candidate that started
  // generating and got cut off or filtered. Neither of these produces
  // `response.text`, but only the latter (MAX_TOKENS, or an ambiguous
  // empty response with no other explanation) is worth retrying with a
  // smaller request; the others won't change on retry.
  if (blockReason) {
    console.error(`[gemini] prompt blocked before generation: blockReason=${blockReason}`, response.promptFeedback);
    throw badGeminiResponse(`Gemini declined to process this document (reason: ${blockReason}). Try a different PDF.`);
  }
  if (!candidate || !response.text) {
    console.error(
      `[gemini] empty response (finishReason=${finishReason}, candidateCount=${response.candidates?.length ?? 0})`,
    );
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      // SAFETY, RECITATION, OTHER, LANGUAGE, etc -- Gemini stopped for a
      // reason unrelated to output-token budget, so asking for fewer
      // questions on retry wouldn't fix it.
      throw badGeminiResponse(
        `Gemini declined to generate a full response for this document (reason: ${finishReason}). Try a different PDF.`,
      );
    }
    const emptyErr = badGeminiResponse(
      'Gemini returned an empty response -- this usually means the response was cut off. Try fewer questions or fewer/smaller PDFs.',
    );
    emptyErr.truncated = true;
    throw emptyErr;
  }

  try {
    return extractJson(response.text);
  } catch (err) {
    // With responseSchema + a properly-sized maxOutputTokens in place this
    // should now be rare -- if it still happens with real (non-empty) text
    // present, it means the response was cut off mid-token (finishReason
    // MAX_TOKENS is the likely cause), which is worth telling the user
    // directly rather than folding into the same message as a shape-
    // validation failure below. `.truncated` lets generateQuiz() (see
    // below) decide whether a retry-with-fewer-questions is worth
    // attempting.
    console.error(`[gemini] failed to parse response as JSON (finishReason=${finishReason}):`, response.text);
    const parseErr = badGeminiResponse(
      'Gemini returned a response that could not be parsed as JSON -- this usually means the response was cut off. Try fewer questions or fewer/smaller PDFs.',
    );
    parseErr.truncated = finishReason === 'MAX_TOKENS';
    throw parseErr;
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

async function attemptQuiz({ files, numQuestions, difficulty, questionType, signal }) {
  const types =
    questionType === 'mixed' ? assignMixedTypes(numQuestions) : Array.from({ length: numQuestions }, () => questionType);
  const parsed = await callGemini(
    buildQuizPrompt({ numQuestions, difficulty, questionType }),
    files,
    buildQuizResponseSchema(types),
    signal,
    computeMaxOutputTokens(numQuestions),
  );
  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.questions) || parsed.questions.length !== numQuestions) {
    const got = parsed && Array.isArray(parsed.questions) ? parsed.questions.length : 0;
    const err = badGeminiResponse(
      `Gemini returned an incomplete quiz (expected ${numQuestions} question(s), got ${got}). Try fewer questions or fewer/smaller PDFs.`,
    );
    // A short array is consistent with the same mid-generation cutoff
    // extractJson's MAX_TOKENS case catches -- just one that happened to
    // land on a valid JSON boundary instead of mid-token. A long array
    // (more than asked for) is a different, non-truncation model error
    // that asking for fewer questions wouldn't fix.
    err.truncated = got < numQuestions;
    throw err;
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

export async function generateQuiz({ files, numQuestions, difficulty, questionType, signal }) {
  try {
    return await attemptQuiz({ files, numQuestions, difficulty, questionType, signal });
  } catch (err) {
    // Safety net for the rare remaining truncation case (see
    // computeMaxOutputTokens() above -- expected to be uncommon now, not
    // the norm): one retry at a reduced question count before giving up.
    // Every other failure (rate limit, malformed shape, timeout, wrong
    // question type, etc.) surfaces immediately -- retrying those would
    // just reproduce the same failure.
    if (!err.truncated || numQuestions <= 1) throw err;
    const reduced = Math.max(1, Math.floor(numQuestions / 2));
    console.warn(`[gemini] quiz generation truncated at ${numQuestions} question(s), retrying once with ${reduced}`);
    return await attemptQuiz({ files, numQuestions: reduced, difficulty, questionType, signal });
  }
}

export async function regenerateQuestion({ files, difficulty, previousQuestions, questionType, signal }) {
  const parsed = await callGemini(
    buildRegenerateQuestionPrompt({ difficulty, previousQuestions, questionType }),
    files,
    typeSchema(questionType),
    signal,
    computeMaxOutputTokens(1),
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
