import { requireAuth } from './_lib/auth.js';
import { readSavedPdf, safeFilename, savedPdfExists } from './_lib/supabase.js';
import { regenerateQuestion } from './_lib/gemini.js';
import { badRequest, sendError } from './_lib/http.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const { sourcePdfs, difficulty, previousQuestions } = req.body || {};
    if (!Array.isArray(sourcePdfs) || sourcePdfs.length === 0) {
      throw badRequest('sourcePdfs is required.');
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
    });

    res.status(200).json({
      question: question.question,
      choices: question.choices,
      correctAnswer: question.correctAnswer,
      yourAnswer: null,
      isCorrect: null,
      explanation: question.explanation,
    });
  } catch (err) {
    sendError(res, err);
  }
}
