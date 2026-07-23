import { requireAuth } from './_lib/auth.js';
import { generateHistoryId, readSavedPdf, safeFilename, savedPdfExists } from './_lib/supabase.js';
import { generateQuiz, toStoredQuestion } from './_lib/gemini.js';
import { checkPageLimits } from './_lib/pdf.js';
import { badRequest, sendError } from './_lib/http.js';

export const maxDuration = 60;

// docs/rules.md #11: a hard cap, not a soft warning, applies per-file, and
// enforced here specifically because this is the one place that already
// sees every source PDF's bytes (both freshly-uploaded and reused-from-
// Previous-Files) before Gemini is ever called, regardless of how the file
// got here.
const MAX_PDF_PAGES = 100;

// 20 questions is a solid quiz size on its own, and 30-question requests
// were the trigger for a "malformed or unreadable" (HTTP 400) failure on
// this same PDF that 20 questions doesn't hit -- rather than chase that
// failure mode, the cap is lowered so it can't be requested at all. The UI
// already clamps its input to 20; this is the authoritative server-side
// enforcement of the same cap, consistent with how the page-limit check
// above is never trusted to the client alone.
const MAX_QUESTIONS = 20;

// By the time this route is called, every source PDF is already sitting in
// the saved-pdfs Storage bucket -- new uploads got there via a signed URL
// from /api/prepare-upload (browser -> Supabase Storage directly), and
// previously-saved files were already there. This route's request body is
// therefore just filenames + settings, a few hundred bytes regardless of
// how large the PDFs themselves are, which is what actually fixes the 502:
// the old flow sent the raw PDF bytes through this function's body, which
// is subject to Vercel's platform-level request size limit (~4.5MB) no
// matter how much in-function compression happens afterward.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  // Ties the Gemini call's own AbortController (api/_lib/gemini.js) to this
  // request's actual connection -- if the client disconnects (tab closed,
  // progress-loss guard's "leave anyway"), the in-flight Gemini call is
  // cancelled immediately instead of running to completion regardless.
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const { sourcePdfs, settings = {} } = req.body || {};
    if (!Array.isArray(sourcePdfs) || sourcePdfs.length === 0) {
      throw badRequest('No PDF files provided.');
    }
    const numQuestions = Number(settings.numQuestions) || 5;
    if (numQuestions > MAX_QUESTIONS) {
      throw badRequest(`Cannot generate more than ${MAX_QUESTIONS} questions at once (requested ${numQuestions}).`);
    }
    const difficulty = settings.difficulty || 'medium';
    const questionType = settings.questionType || 'multipleChoice';

    const resolvedFiles = [];
    for (const rawFilename of sourcePdfs) {
      const filename = safeFilename(rawFilename);
      if (!(await savedPdfExists(filename))) {
        throw badRequest(`Saved PDF not found: ${filename}`);
      }
      if (!resolvedFiles.some((f) => f.filename === filename)) {
        resolvedFiles.push({ filename, buffer: await readSavedPdf(filename) });
      }
    }

    // Page-count limit (docs/rules.md #11), checked per-file before any
    // Gemini call -- see checkPageLimits() for why every file is checked
    // (not just up to the first offender) and why an unmeasurable file is
    // skipped rather than blocked.
    const limitResult = await checkPageLimits(resolvedFiles, MAX_PDF_PAGES);
    if (limitResult) {
      res.status(400).json({ error: limitResult.message, oversizedFiles: limitResult.oversizedFiles });
      return;
    }

    const { title, questions } = await generateQuiz({
      files: resolvedFiles,
      numQuestions,
      difficulty,
      questionType,
      signal: abortController.signal,
    });

    const id = generateHistoryId(title);
    const quiz = {
      id,
      title,
      date: new Date().toISOString(),
      score: 0,
      total: questions.length,
      answeredCount: 0,
      completed: false,
      sourcePdfs: resolvedFiles.map((f) => f.filename),
      questions: questions.map(toStoredQuestion),
    };

    // Nothing written to quiz_history here -- the client calls
    // /api/save-quiz-result right after, same as the old backend.
    res.status(200).json(quiz);
  } catch (err) {
    sendError(res, err);
  }
}
