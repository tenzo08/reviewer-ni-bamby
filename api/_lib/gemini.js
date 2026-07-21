import { GoogleGenAI } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

function buildQuizPrompt({ numQuestions, difficulty }) {
  return `You are generating a multiple-choice quiz from the attached PDF document(s).

Generate exactly ${numQuestions} questions at "${difficulty}" difficulty. Every question
must be answerable strictly from the content of the attached document(s) -- do not invent
facts that aren't in the source material. Each question must have exactly 4 choices with
exactly one correct answer among them.

Also come up with a short, descriptive title for this quiz based on the document content.

Return ONLY valid JSON (no markdown code fences, no commentary) matching exactly this shape:
{
  "title": "string",
  "questions": [
    {
      "question": "string",
      "choices": ["string", "string", "string", "string"],
      "correctAnswer": "string, must exactly match one of the choices",
      "explanation": "string, briefly explains why the correct answer is correct"
    }
  ]
}`;
}

function buildRegenerateQuestionPrompt({ difficulty, previousQuestions }) {
  const avoidList =
    previousQuestions && previousQuestions.length
      ? `\n\nDo not repeat or closely rephrase any of these already-used questions:\n${previousQuestions
          .map((q) => `- ${q}`)
          .join('\n')}`
      : '';

  return `Generate ONE new multiple-choice question from the attached PDF document(s), at
"${difficulty}" difficulty. It must be answerable strictly from the content of the attached
document(s). It must have exactly 4 choices with exactly one correct answer among them.${avoidList}

Return ONLY valid JSON (no markdown code fences, no commentary) matching exactly this shape:
{
  "question": "string",
  "choices": ["string", "string", "string", "string"],
  "correctAnswer": "string, must exactly match one of the choices",
  "explanation": "string, briefly explains why the correct answer is correct"
}`;
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
    const publicErr = new Error('Quiz generation failed. Please try again.');
    publicErr.status = 502;
    publicErr.expose = true;
    throw publicErr;
  }

  try {
    return extractJson(response.text);
  } catch (err) {
    console.error('[gemini] failed to parse response as JSON:', response.text);
    const publicErr = new Error('Quiz generation returned an unexpected response. Please try again.');
    publicErr.status = 502;
    publicErr.expose = true;
    throw publicErr;
  }
}

export async function generateQuiz({ files, numQuestions, difficulty }) {
  const parsed = await callGemini(buildQuizPrompt({ numQuestions, difficulty }), files);
  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.questions)) {
    const err = new Error('Quiz generation returned an unexpected response. Please try again.');
    err.status = 502;
    err.expose = true;
    throw err;
  }
  return parsed;
}

export async function regenerateQuestion({ files, difficulty, previousQuestions }) {
  const parsed = await callGemini(buildRegenerateQuestionPrompt({ difficulty, previousQuestions }), files);
  if (!parsed || typeof parsed.question !== 'string' || !Array.isArray(parsed.choices)) {
    const err = new Error('Question generation returned an unexpected response. Please try again.');
    err.status = 502;
    err.expose = true;
    throw err;
  }
  return parsed;
}
