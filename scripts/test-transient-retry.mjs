// Exercises callWithTransientRetry() and describeGeminiFailure() (api/_lib/
// gemini.js) against fabricated failures -- no real Gemini API call, so
// this is safe to run anytime without touching quota. Run with:
//   node scripts/test-transient-retry.mjs
import assert from 'node:assert/strict';
import { callWithTransientRetry, describeGeminiFailure } from '../api/_lib/gemini.js';

let passed = 0;
function check(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok - ${name}`);
  });
}

function fakeError(status) {
  const err = new Error(`simulated HTTP ${status}`);
  err.status = status;
  return err;
}

// Fast: sleepFn is stubbed out so this suite doesn't actually wait through
// real 1s/2s/4s backoffs -- the delay VALUES are still asserted via onRetry.
const instant = async () => {};

console.log('callWithTransientRetry()');

await check('503 twice then success -> succeeds, called 3 times, backoff 1000ms then 2000ms', async () => {
  let calls = 0;
  const retries = [];
  const result = await callWithTransientRetry(
    async () => {
      calls += 1;
      if (calls <= 2) throw fakeError(503);
      return 'ok';
    },
    { onRetry: (info) => retries.push(info), sleepFn: instant },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(
    retries.map((r) => r.delayMs),
    [1000, 2000],
  );
  assert.ok(retries.every((r) => r.status === 503));
});

await check('503 every time -> exhausts all 3 retries (4 attempts), then throws the 503', async () => {
  let calls = 0;
  const retries = [];
  await assert.rejects(
    () =>
      callWithTransientRetry(
        async () => {
          calls += 1;
          throw fakeError(503);
        },
        { onRetry: (info) => retries.push(info), sleepFn: instant },
      ),
    (err) => err.status === 503,
  );
  assert.equal(calls, 4);
  assert.deepEqual(
    retries.map((r) => r.delayMs),
    [1000, 2000, 4000],
  );
});

await check('500/502/504/408 are also retried (Google SDK\'s own transient set, minus 429)', async () => {
  for (const status of [500, 502, 504, 408]) {
    let calls = 0;
    const result = await callWithTransientRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw fakeError(status);
        return 'ok';
      },
      { sleepFn: instant },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 2, `status ${status} should have been retried once`);
  }
});

await check('429 is NEVER retried, even once (rules.md #12) -> throws immediately on first failure', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      callWithTransientRetry(
        async () => {
          calls += 1;
          throw fakeError(429);
        },
        { sleepFn: instant },
      ),
    (err) => err.status === 429,
  );
  assert.equal(calls, 1);
});

await check('a non-retryable status (400) throws immediately, no retry', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      callWithTransientRetry(
        async () => {
          calls += 1;
          throw fakeError(400);
        },
        { sleepFn: instant },
      ),
    (err) => err.status === 400,
  );
  assert.equal(calls, 1);
});

await check('an already-aborted signal stops retrying after the first failure', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      callWithTransientRetry(
        async () => {
          calls += 1;
          throw fakeError(503);
        },
        { signal: controller.signal, sleepFn: instant },
      ),
    (err) => err.status === 503,
  );
  assert.equal(calls, 1);
});

console.log('\ndescribeGeminiFailure() message for exhausted-retry case');

await check('503 after retries exhausted -> distinct message naming retry + HTTP 503, not the 429/truncation wording', () => {
  const message = describeGeminiFailure(fakeError(503), 5000);
  assert.match(message, /temporary issue/i);
  assert.match(message, /retrying/i);
  assert.match(message, /503/);
  assert.doesNotMatch(message, /rate limit/i);
  assert.doesNotMatch(message, /truncat/i);
  assert.doesNotMatch(message, /daily/i);
});

await check('500 gets the same transient-retry message class as 503 (both in the retryable set)', () => {
  const message500 = describeGeminiFailure(fakeError(500), 5000);
  const message503 = describeGeminiFailure(fakeError(503), 5000);
  assert.match(message500, /temporary issue/i);
  // Same wording template, just the status number differs.
  assert.equal(message500.replace('500', '503'), message503);
});

await check('a genuinely different failure (400) still gets its own distinct message, unaffected by this change', () => {
  const message = describeGeminiFailure(fakeError(400), 5000);
  assert.match(message, /malformed or unreadable/i);
  assert.doesNotMatch(message, /temporary issue/i);
});

console.log(`\n${passed} passed`);
