import PDFDocument from 'pdfkit';
import { requireAuth } from './_lib/auth.js';
import { getHistoryEntry } from './_lib/supabase.js';
import { badRequest, notFound, sendError } from './_lib/http.js';

export const maxDuration = 30;

// Library choice (docs task Part D): pdf-lib (already a dependency, used
// for page-count reads) has no built-in text flow -- every line wrap and
// page break has to be measured and placed manually, which is exactly the
// wrong fit here: an arbitrary number of past quizzes, each with an
// unpredictable number of questions of unpredictable length (some of these
// nursing questions run several lines). pdfkit's document API wraps text
// and advances pages automatically as content is written, and the document
// object is itself a readable stream that can be piped straight into the
// HTTP response -- which is also exactly what streaming the result without
// ever touching Storage (docs/rules.md) needs. One new dependency, but it's
// solving a problem pdf-lib genuinely isn't built for.

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  let entries;
  let includeAnswers;
  try {
    const body = req.body || {};
    const { historyIds } = body;
    includeAnswers = Boolean(body.includeAnswers);
    if (!Array.isArray(historyIds) || historyIds.length === 0) {
      throw badRequest('historyIds is required (a non-empty array of history entry ids).');
    }

    // Same read pattern as history/[id].js (the route Part A's retake flow
    // fetches full questions from), just looped across every selected
    // entry, in the order the client selected them -- fully resolved
    // before any part of the PDF response starts, so a bad id fails clean
    // with a normal JSON error instead of a response already mid-stream.
    entries = [];
    for (const id of historyIds) {
      const entry = await getHistoryEntry(String(id));
      if (!entry) throw notFound(`History entry not found: ${id}`);
      entries.push(entry);
    }
  } catch (err) {
    sendError(res, err);
    return;
  }

  // Numbering (docs task Part D): continuous across the WHOLE compiled
  // document (1, 2, 3... through every source quiz), not reset to 1 at the
  // start of each quiz's section. A grouped/reset scheme would make the
  // Answer Key ambiguous -- "3." could mean three different questions
  // depending which section it fell in -- while continuous numbering keeps
  // every number unique document-wide, so the Answer Key can reference a
  // question directly with no qualification needed. Section headers (each
  // quiz's title) still preserve which source quiz a question came from.
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="compiled-quiz.pdf"');

    const doc = new PDFDocument({ margin: 50, autoFirstPage: true });
    doc.pipe(res);

    let questionNumber = 0;
    const answerKey = [];

    entries.forEach((entry, entryIndex) => {
      if (entryIndex > 0) doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text(entry.title);
      doc.moveDown(0.75);

      for (const q of entry.questions) {
        questionNumber += 1;
        doc.fontSize(12).font('Helvetica-Bold').text(`${questionNumber}. ${q.question}`);
        doc.font('Helvetica').fontSize(11);
        if (q.choices) {
          for (let i = 0; i < q.choices.length; i++) {
            doc.text(`   ${LETTERS[i] || i + 1}) ${q.choices[i]}`);
          }
        }
        doc.moveDown(0.75);

        let answerText = q.correctAnswer;
        if (q.type === 'modifiedTrueFalse' && q.correctAnswer === 'False' && q.modifiedAnswer) {
          answerText = `False -- ${q.modifiedAnswer}`;
        }
        answerKey.push({ number: questionNumber, answer: answerText });
      }
    });

    if (includeAnswers) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Answer Key');
      doc.moveDown(0.75);
      doc.font('Helvetica').fontSize(11);
      for (const { number, answer } of answerKey) {
        doc.text(`${number}. ${answer}`);
      }
    }

    doc.end();
  } catch (err) {
    // Headers/streaming may already be underway by the time anything here
    // could fail -- a JSON error body can't be layered onto a response
    // already declared as application/pdf, so this can only log and cut
    // the connection, not retroactively send a clean error to the client.
    console.error('[compile-pdf] failed mid-stream:', err);
    res.end();
  }
}
