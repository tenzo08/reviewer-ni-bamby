import { requireAuth } from './_lib/auth.js';
import { listHistoryEntriesFull } from './_lib/supabase.js';
import { sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    const entries = await listHistoryEntriesFull();
    const completed = entries.filter((e) => e.completed);

    const totalQuizzesTaken = completed.length;
    const totalQuestionsAnswered = completed.reduce((sum, e) => sum + e.answeredCount, 0);
    const totalCorrect = completed.reduce((sum, e) => sum + e.score, 0);
    const overallAccuracy = totalQuestionsAnswered > 0 ? totalCorrect / totalQuestionsAnswered : null;

    const accuracyOverTime = completed
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        accuracy: e.total > 0 ? e.score / e.total : null,
      }));

    const perPdfTotals = {};
    for (const e of completed) {
      for (const src of e.sourcePdfs) {
        if (!perPdfTotals[src]) perPdfTotals[src] = { correct: 0, total: 0 };
        perPdfTotals[src].correct += e.score;
        perPdfTotals[src].total += e.total;
      }
    }
    const perPdfAccuracy = Object.entries(perPdfTotals).map(([sourcePdf, v]) => ({
      sourcePdf,
      correct: v.correct,
      total: v.total,
      accuracy: v.total > 0 ? v.correct / v.total : null,
    }));

    res.status(200).json({
      totalQuizzesTaken,
      totalQuestionsAnswered,
      totalCorrect,
      overallAccuracy,
      accuracyOverTime,
      perPdfAccuracy,
    });
  } catch (err) {
    sendError(res, err);
  }
}
