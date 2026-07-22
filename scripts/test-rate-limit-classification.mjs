// Exercises classifyRateLimit()/describeRateLimit() (api/_lib/gemini.js)
// against realistic mocked 429 payloads -- no real Gemini API call, so this
// is safe to run anytime without touching the daily quota. Run with:
//   node scripts/test-rate-limit-classification.mjs
import assert from 'node:assert/strict';
import { classifyRateLimit, describeRateLimit } from '../api/_lib/gemini.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// Shape mirrors what @google/genai's throwErrorIfNotOK actually produces:
// `err.message` is JSON.stringify(the raw Google API error body). See the
// comment above parseGeminiErrorBody() in gemini.js.
function fakeApiError(errorBody) {
  return { name: 'ApiError', status: 429, message: JSON.stringify({ error: errorBody }) };
}

console.log('classifyRateLimit / describeRateLimit');

check('real captured daily-quota 429 -> kind=daily, correct message', () => {
  // This is the ACTUAL body captured from a real 429 during a previous
  // session's live testing (api key values redacted/irrelevant -- this is
  // response body, not a credential).
  const err = fakeApiError({
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. ' +
      '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
      'limit: 20, model: gemini-2.5-flash\nPlease retry in 36.980079466s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            quotaDimensions: { location: 'global', model: 'gemini-2.5-flash' },
            quotaValue: '20',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '36s' },
    ],
  });

  const classification = classifyRateLimit(err);
  assert.equal(classification.kind, 'daily');
  assert.equal(classification.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  // The key point this whole test file exists to prove: retryDelay here is
  // SHORT (36s) despite this being a genuine daily-quota exhaustion --
  // confirming why retryDelay must not be used to infer per-minute.
  assert.equal(classification.retryDelaySeconds, 36);

  const message = describeRateLimit(classification);
  assert.equal(message, 'Daily API limit reached. This resets at midnight Pacific time.');
});

check('plausible per-minute 429 (quotaId names PerMinute) -> kind=perMinute, correct message', () => {
  // Representative shape based on Google's documented quotaId naming
  // convention (metric + "Per<Unit>" + scope + tier) -- not independently
  // captured live like the daily case above, since triggering a real RPM
  // 429 would also burn quota. If Google's actual per-minute quotaId
  // wording ever differs from this, the /perminute/i.test() in
  // classifyRateLimit would need revisiting.
  const err = fakeApiError({
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_requests_per_minute',
            quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
            quotaValue: '15',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
    ],
  });

  const classification = classifyRateLimit(err);
  assert.equal(classification.kind, 'perMinute');

  const message = describeRateLimit(classification);
  assert.equal(message, "You're sending requests too quickly -- wait about a minute and try again.");
});

check('ambiguous 429 (no quotaId at all, short retryDelay) -> kind=unknown, hedged message', () => {
  // Proves the code does NOT fall back to guessing from retryDelaySeconds
  // when quotaId is absent, even though this retryDelay (5s) looks exactly
  // like what the (rejected) "short delay = per-minute" heuristic would
  // have confidently mislabeled.
  const err = fakeApiError({
    code: 429,
    message: 'Too many requests.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '5s' }],
  });

  const classification = classifyRateLimit(err);
  assert.equal(classification.kind, 'unknown');
  assert.equal(classification.quotaId, null);
  assert.equal(classification.retryDelaySeconds, 5);

  const message = describeRateLimit(classification);
  assert.match(message, /wasn't possible to tell which/);
  assert.match(message, /midnight Pacific time/);
});

check('malformed/non-JSON err.message -> does not throw, kind=unknown', () => {
  const err = { name: 'ApiError', status: 429, message: 'not json at all' };
  const classification = classifyRateLimit(err);
  assert.equal(classification.kind, 'unknown');
  assert.equal(classification.quotaId, null);
  assert.equal(classification.retryDelaySeconds, null);
});

check('the three distinct messages are genuinely different strings', () => {
  const daily = describeRateLimit({ kind: 'daily' });
  const perMinute = describeRateLimit({ kind: 'perMinute' });
  const unknown = describeRateLimit({ kind: 'unknown' });
  assert.notEqual(daily, perMinute);
  assert.notEqual(daily, unknown);
  assert.notEqual(perMinute, unknown);
});

console.log(`\n${passed} passed`);
