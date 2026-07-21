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
    const missedQuestions = [];
    const bySource = {};

    for (const entry of entries) {
      for (const q of entry.questions) {
        if (q.isCorrect === false) {
          missedQuestions.push({
            historyId: entry.id,
            date: entry.date,
            sourcePdfs: entry.sourcePdfs,
            type: q.type,
            question: q.question,
            yourAnswer: q.yourAnswer,
            correctAnswer: q.correctAnswer,
            ...(q.modifiedAnswer !== undefined
              ? { modifiedAnswer: q.modifiedAnswer, yourModifiedAnswer: q.yourModifiedAnswer }
              : {}),
            explanation: q.explanation,
          });
          for (const src of entry.sourcePdfs) {
            bySource[src] = (bySource[src] || 0) + 1;
          }
        }
      }
    }

    const sourceBreakdown = Object.entries(bySource)
      .map(([sourcePdf, missedCount]) => ({ sourcePdf, missedCount }))
      .sort((a, b) => b.missedCount - a.missedCount);

    res.status(200).json({ missedQuestions, sourceBreakdown });
  } catch (err) {
    sendError(res, err);
  }
}
