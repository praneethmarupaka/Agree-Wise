// test_final.js - Standalone assertion test for grading rules and caching policies
const assert = require('assert');
const { evaluateGradeAndSummary, calculateScore } = require('./services/score');
const cache = require('./services/cache');

async function runTests() {
  console.log('Running AgreeWise Final Stabilisation Test Suite...\n');

  // (a) No analyzed docs => grade "?"
  console.log('Assert (a): No analyzed docs => grade "?"');
  const resA = evaluateGradeAndSummary([], [
    { type: 'TERMS', analyzed: false, reason: "Couldn't fetch the page" },
    { type: 'PRIVACY', analyzed: false, reason: 'Page text too short, it may load with JavaScript' },
  ]);
  assert.strictEqual(resA.grade, '?', 'Grade must be "?" when no docs are analyzed');
  assert.strictEqual(resA.riskScore, null, 'Risk score must be null when no docs analyzed');
  assert.strictEqual(resA.summary, "Couldn't read the policy text, so no grade was given.");
  console.log('  PASSED: Grade is "?", riskScore is null, summary matches exact requirement.\n');

  // (b) One doc analyzed with score in A/B range and one failed => "?"
  console.log('Assert (b): One doc analyzed with score in A/B range and one failed => "?"');
  const resB = evaluateGradeAndSummary(
    [{ category: 'DATA_SHARING', severity: 'LOW', title: 'Minimal sharing' }], // score 0.5 -> rawGrade A
    [
      { type: 'TERMS', analyzed: true },
      { type: 'PRIVACY', analyzed: false, reason: "Couldn't fetch the page" },
    ]
  );
  assert.strictEqual(resB.grade, '?', 'Partial analysis with A/B score must return "?"');
  assert.strictEqual(resB.summary, 'Only part of the policy could be read.');
  console.log('  PASSED: Raw A/B grade blocked when partial policy is missing, returns "?".\n');

  // (c) All analyzed with no flags => "A"
  console.log('Assert (c): All analyzed with no flags => "A"');
  const resC = evaluateGradeAndSummary([], [
    { type: 'TERMS', analyzed: true },
    { type: 'PRIVACY', analyzed: true },
  ]);
  assert.strictEqual(resC.grade, 'A', 'All analyzed with zero flags must give grade "A"');
  assert.strictEqual(resC.riskScore, 0.0, 'Risk score must be 0.0');
  assert(resC.summary.includes('Low risk'), 'Summary must reflect low risk');
  console.log('  PASSED: Clean full agreement correctly receives grade "A".\n');

  // (d) Failed results are never written to the cache
  console.log('Assert (d): Failed results & mock results are never written to the cache');
  await cache.clearCache();

  // Failed document (analyzed: false)
  await cache.saveAnalysis({
    text: 'failed policy text',
    url: 'https://example.com/failed',
    type: 'TERMS',
    flags: [],
    summary: 'Error',
    analyzed: false,
  });
  const cachedFailed = await cache.getAnalysis('failed policy text');
  assert.strictEqual(cachedFailed, null, 'Unanalyzed/failed document must not be cached');

  // Mock result
  process.env.MOCK_LLM = 'true';
  await cache.saveAnalysis({
    text: 'mock policy text',
    url: 'https://example.com/mock',
    type: 'TERMS',
    flags: [{ title: 'Mock flag' }],
    summary: 'Mock summary',
    analyzed: true,
  });
  const cachedMock = await cache.getAnalysis('mock policy text');
  assert.strictEqual(cachedMock, null, 'Mock results must never be cached');

  // Real successful result
  process.env.MOCK_LLM = 'false';
  await cache.saveAnalysis({
    text: 'real policy text',
    url: 'https://example.com/real',
    type: 'TERMS',
    flags: [{ title: 'Real flag' }],
    summary: 'Real summary',
    analyzed: true,
  });
  const cachedReal = await cache.getAnalysis('real policy text');
  assert(cachedReal !== null, 'Real successful result should be cached');
  assert.strictEqual(cachedReal.summary, 'Real summary');
  console.log('  PASSED: Cache rejects failed & mock results; only saves genuine analyses.\n');

  console.log('ALL ASSERTIONS PASSED (100% compliant with final stabilisation rules).');
}

runTests().catch((err) => {
  console.error('Test assertion failed:', err);
  process.exit(1);
});
