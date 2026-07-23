// Exercises shared/answerMatching.js directly -- no Gemini/Supabase call
// involved, safe to run anytime. Covers the two real bug reports plus the
// cases docs/design.md's task list calls out explicitly.
import assert from 'node:assert/strict';
import { answerMatches, computeIsCorrect } from '../shared/answerMatching.js';

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log('answerMatches()');

{
  assert.equal(answerMatches('indomethacin', 'Indomethacin (Indocin)'), true);
  ok('parenthetical alternate: "indomethacin" matches "Indomethacin (Indocin)"');
}
{
  assert.equal(answerMatches('Indocin', 'Indomethacin (Indocin)'), true);
  ok('parenthetical alternate: "Indocin" matches "Indomethacin (Indocin)"');
}
{
  assert.equal(answerMatches('pleuritis', 'Pleuritis/Pleurisy'), true);
  ok('slash-separated: "pleuritis" matches "Pleuritis/Pleurisy"');
}
{
  assert.equal(answerMatches('Pleurisy', 'Pleuritis/Pleurisy'), true);
  ok('slash-separated: "Pleurisy" matches "Pleuritis/Pleurisy"');
}
{
  assert.equal(answerMatches('Pleuritis/Pleurisy', 'Pleuritis/Pleurisy'), true);
  ok('full string still matches its own candidate set');
}
{
  assert.equal(answerMatches('mitosis', 'Mitosis'), true);
  ok('no parentheses/slashes/or: unaffected exact (normalized) match still works');
}
{
  assert.equal(answerMatches('  MiTosis  ', 'Mitosis'), true);
  ok('whitespace/casing variance against a single-candidate correctAnswer');
}
{
  assert.equal(answerMatches('  INDOMETHACIN.', 'Indomethacin (Indocin)'), true);
  ok('whitespace/casing/trailing-punctuation variance against a multi-candidate correctAnswer');
}
{
  assert.equal(answerMatches('aspirin', 'Indomethacin (Indocin)'), false);
  ok('genuinely wrong answer against a multi-candidate correctAnswer stays wrong');
}
{
  assert.equal(answerMatches('ribosome', 'Mitochondria or Ribosome'), true);
  assert.equal(answerMatches('mitochondria', 'Mitochondria or Ribosome'), true);
  assert.equal(answerMatches('mitochondria or ribosome', 'Mitochondria or Ribosome'), true);
  ok('"or"-separated candidates all accepted, including the full phrase');
}
{
  assert.equal(answerMatches('golgi', 'Mitochondria or Ribosome'), false);
  ok('"or"-separated: a third, unlisted term is still wrong');
}

console.log('\ncomputeIsCorrect() -- modifiedTrueFalse modifiedAnswer gets the same treatment');
{
  const q = { type: 'modifiedTrueFalse', correctAnswer: 'False', modifiedAnswer: 'ATP production (energy)' };
  assert.equal(computeIsCorrect(q, 'False', 'energy'), true);
  assert.equal(computeIsCorrect(q, 'False', 'ATP production'), true);
  assert.equal(computeIsCorrect(q, 'False', 'protein synthesis'), false);
  assert.equal(computeIsCorrect(q, 'True', 'energy'), false); // wrong True/False choice regardless of term
  ok('modifiedAnswer candidate extraction applied, and choice itself still gated correctly');
}

console.log('\ncomputeIsCorrect() -- multipleChoice/trueFalse untouched (plain exact match)');
{
  const q = { type: 'multipleChoice', correctAnswer: 'Mitochondria (organelle)', choices: ['Mitochondria (organelle)', 'a', 'b', 'c'] };
  // multipleChoice picks from an exact choices[] list -- the student answer
  // IS one of the literal choices verbatim, so this must still require the
  // exact string, not a parenthetical-split candidate.
  assert.equal(computeIsCorrect(q, 'Mitochondria', null), false);
  assert.equal(computeIsCorrect(q, 'Mitochondria (organelle)', null), true);
  ok('multipleChoice still requires the exact choice string, no candidate leniency');
}

console.log(`\n${passed} check(s) passed.`);
