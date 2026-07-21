import { requireAuth } from './_lib/auth.js';
import { parseMultipart } from './_lib/multipart.js';
import { checkSaveConflict } from './_lib/conflict.js';
import { generateHistoryId, readSavedPdf, safeFilename, savedPdfExists, saveSavedPdf } from './_lib/supabase.js';
import { generateQuiz, toStoredQuestion } from './_lib/gemini.js';
import { badRequest, sendError } from './_lib/http.js';

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const { fields, files: uploadedFiles } = await parseMultipart(req, { maxFileSize: 25 * 1024 * 1024, maxFiles: 10 });
    const existingFilenames = fields.existingFilenames ? JSON.parse(fields.existingFilenames) : [];
    const duplicateResolution = fields.duplicateResolution ? JSON.parse(fields.duplicateResolution) : {};
    const settings = fields.settings ? JSON.parse(fields.settings) : {};
    const numQuestions = Number(settings.numQuestions) || 5;
    const difficulty = settings.difficulty || 'medium';
    const questionType = settings.questionType || 'multipleChoice';

    const namedFiles = uploadedFiles
      .filter((f) => f.fieldname === 'files')
      .map((f) => ({ filename: safeFilename(f.filename), buffer: f.buffer }));

    // Duplicate-file conflict check: any uploaded file whose plain filename
    // already exists in the saved-pdfs bucket and has no resolution yet
    // blocks the whole request so the client can prompt Replace / Use
    // Existing / Cancel.
    const conflicts = [];
    for (const file of namedFiles) {
      const { conflict } = await checkSaveConflict(file.filename, duplicateResolution[file.filename]);
      if (conflict) conflicts.push({ filename: file.filename });
    }
    if (conflicts.length > 0) {
      res.status(409).json({ conflicts });
      return;
    }

    const resolvedFiles = [];
    for (const file of namedFiles) {
      const { useExisting } = await checkSaveConflict(file.filename, duplicateResolution[file.filename]);
      if (useExisting) {
        resolvedFiles.push({ filename: file.filename, buffer: await readSavedPdf(file.filename) });
      } else {
        await saveSavedPdf(file.filename, file.buffer);
        resolvedFiles.push({ filename: file.filename, buffer: file.buffer });
      }
    }

    for (const rawFilename of existingFilenames) {
      const filename = safeFilename(rawFilename);
      if (!(await savedPdfExists(filename))) {
        throw badRequest(`Saved PDF not found: ${filename}`);
      }
      if (!resolvedFiles.some((f) => f.filename === filename)) {
        resolvedFiles.push({ filename, buffer: await readSavedPdf(filename) });
      }
    }

    if (resolvedFiles.length === 0) {
      throw badRequest('No PDF files provided.');
    }

    const { title, questions } = await generateQuiz({ files: resolvedFiles, numQuestions, difficulty, questionType });

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
