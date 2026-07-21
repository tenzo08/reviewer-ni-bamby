import { requireAuth } from './_lib/auth.js';
import { readSavedPdf, safeFilename, savedPdfExists } from './_lib/supabase.js';
import { regenerateQuestion, toStoredQuestion } from './_lib/gemini.js';
import { badRequest, sendError } from './_lib/http.js';

export const maxDuration = 60;

const VALID_TYPES = ['multipleChoice', 'trueFalse', 'modifiedTrueFalse', 'identification'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const { sourcePdfs, difficulty, previousQuestions, questionType } = req.body || {};
    if (!Array.isArray(sourcePdfs) || sourcePdfs.length === 0) {
      throw badRequest('sourcePdfs is required.');
    }
    if (!VALID_TYPES.includes(questionType)) {
      throw badRequest('questionType must be one of: ' + VALID_TYPES.join(', '));
    }

    const files = [];
    for (const rawFilename of sourcePdfs) {
      const filename = safeFilename(rawFilename);
      if (!(await savedPdfExists(filename))) {
        throw badRequest(`Saved PDF not found: ${filename}`);
      }
      files.push({ filename, buffer: await readSavedPdf(filename) });
    }

    const question = await regenerateQuestion({
      files,
      difficulty: difficulty || 'medium',
      previousQuestions: Array.isArray(previousQuestions) ? previousQuestions : [],
      questionType,
    });

    res.status(200).json(toStoredQuestion(question));
  } catch (err) {
    sendError(res, err);
  }
}
