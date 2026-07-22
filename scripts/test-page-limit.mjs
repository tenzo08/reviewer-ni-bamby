// Exercises checkPageLimits() (api/_lib/pdf.js) -- the exact function
// generate-quiz.js calls before any Gemini request -- against real PDF
// files. No Gemini call involved, so this is safe to run anytime without
// touching quota. Point it at real files:
//   node scripts/test-page-limit.mjs <under-limit.pdf> <over-limit.pdf> [<second-under-limit.pdf>]
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { checkPageLimits, getPdfPageCount } from '../api/_lib/pdf.js';

const [underPath, overPath, secondUnderPath] = process.argv.slice(2);
if (!underPath || !overPath) {
  console.error('Usage: node scripts/test-page-limit.mjs <under-limit.pdf> <over-limit.pdf> [<second-under-limit.pdf>]');
  process.exit(1);
}

async function loadFile(path) {
  const buffer = await readFile(path);
  const filename = path.split(/[\\/]/).pop();
  return { filename, buffer };
}

let passed = 0;
function report(name) {
  passed += 1;
  console.log(`  ok - ${name}`);
}

const under = await loadFile(underPath);
const over = await loadFile(overPath);
const underCount = await getPdfPageCount(under.buffer);
const overCount = await getPdfPageCount(over.buffer);
console.log(`Loaded: "${under.filename}" = ${underCount} pages, "${over.filename}" = ${overCount} pages`);
assert.ok(underCount <= 100, `test setup error: "${under.filename}" (${underCount} pages) is not actually under the limit`);
assert.ok(overCount > 100, `test setup error: "${over.filename}" (${overCount} pages) is not actually over the limit`);

console.log('\ncheckPageLimits()');

{
  const result = await checkPageLimits([under]);
  assert.equal(result, null);
  report(`single under-limit PDF (${underCount} pages) -> accepted (null result)`);
}

{
  const result = await checkPageLimits([over]);
  assert.notEqual(result, null);
  assert.equal(result.oversizedFiles.length, 1);
  assert.equal(result.oversizedFiles[0].filename, over.filename);
  assert.equal(result.oversizedFiles[0].pageCount, overCount);
  assert.match(result.message, new RegExp(`${overCount} pages`));
  assert.match(result.message, /100-page limit/);
  assert.match(result.message, new RegExp(over.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  report(`single over-limit PDF (${overCount} pages) -> rejected with correct page count + filename in message`);
}

if (secondUnderPath) {
  const second = await loadFile(secondUnderPath);
  const secondCount = await getPdfPageCount(second.buffer);
  assert.ok(secondCount <= 100, `test setup error: "${second.filename}" (${secondCount} pages) is not actually under the limit`);
  console.log(`Loaded second under-limit file: "${second.filename}" = ${secondCount} pages`);

  const result = await checkPageLimits([under, over, second]);
  assert.notEqual(result, null);
  assert.equal(result.oversizedFiles.length, 1);
  assert.equal(result.oversizedFiles[0].filename, over.filename);
  report(
    `mixed selection (2 under-limit + 1 over-limit) -> only "${over.filename}" flagged, the two under-limit files are not in oversizedFiles`,
  );

  const namedFiles = result.oversizedFiles.map((f) => f.filename);
  assert.ok(!namedFiles.includes(under.filename));
  assert.ok(!namedFiles.includes(second.filename));
  report('confirmed under-limit files are absent from oversizedFiles (not blocked by the oversized one)');
} else {
  console.log('  (skipped multi-file mixed-selection test -- no third path given)');
}

console.log(`\n${passed} passed`);
