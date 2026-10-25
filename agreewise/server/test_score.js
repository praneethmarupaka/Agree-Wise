// server/test_score.js - Unit tests for score.js grading logic and boundary intervals
'use strict';
const { SCORING_VERSION, calculateScore, calculateRawGrade, evaluateGradeAndSummary } = require('./services/score');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`);
    failed++;
  }
}

function makeFlag(category, severity) {
  return { category, severity, title: `${category} ${severity}`, quote: 'test quote', verified: true };
}

function allAnalyzed(urls) {
  return urls.map(u => ({ url: u, type: 'TERMS', analyzed: true }));
}

console.log('\n=== score.js tests ===\n');

// SCORING_VERSION export
assert('SCORING_VERSION exported as 1', SCORING_VERSION === 1);

// Boundary scores mapping: 1.5 -> A, 3.5 -> B, 6.0 -> C, 8.0 -> D, >8 -> F
assert('boundary: score 1.5 maps to A', calculateRawGrade(1.5) === 'A');
assert('boundary: score 1.6 maps to B', calculateRawGrade(1.6) === 'B');
assert('boundary: score 3.5 maps to B', calculateRawGrade(3.5) === 'B');
assert('boundary: score 3.6 maps to C', calculateRawGrade(3.6) === 'C');
assert('boundary: score 6.0 maps to C', calculateRawGrade(6.0) === 'C');
assert('boundary: score 6.1 maps to D', calculateRawGrade(6.1) === 'D');
assert('boundary: score 8.0 maps to D', calculateRawGrade(8.0) === 'D');
assert('boundary: score 8.1 maps to F', calculateRawGrade(8.1) === 'F');

// Pre-grade rounding to 1 decimal place
assert('rounding: 1.54 rounds to 1.5 (A)', calculateRawGrade(1.54) === 'A');
assert('rounding: 1.56 rounds to 1.6 (B)', calculateRawGrade(1.56) === 'B');
assert('rounding: 3.54 rounds to 3.5 (B)', calculateRawGrade(3.54) === 'B');
assert('rounding: 3.56 rounds to 3.6 (C)', calculateRawGrade(3.56) === 'C');
assert('rounding: 6.04 rounds to 6.0 (C)', calculateRawGrade(6.04) === 'C');
assert('rounding: 6.06 rounds to 6.1 (D)', calculateRawGrade(6.06) === 'D');
assert('rounding: 8.04 rounds to 8.0 (D)', calculateRawGrade(8.04) === 'D');
assert('rounding: 8.06 rounds to 8.1 (F)', calculateRawGrade(8.06) === 'F');

// (a) No flags => grade A
{
  const r = evaluateGradeAndSummary([], allAnalyzed(['https://example.com/terms']));
  assert('(a) no flags → grade A', r.grade === 'A', `got ${r.grade}`);
}

// (b) One MEDIUM flag (score 1.0) => grade A
{
  const flags = [makeFlag('TRACKING', 'MEDIUM')];
  const r = evaluateGradeAndSummary(flags, allAnalyzed(['https://example.com/terms']));
  assert('(b) one MEDIUM (1.0) → A', r.grade === 'A', `got ${r.grade}`);
}

// (c) Three flags in same category count once: score 2.0 => B
{
  const flags = [makeFlag('DATA_SHARING', 'LOW'), makeFlag('DATA_SHARING', 'MEDIUM'), makeFlag('DATA_SHARING', 'HIGH')];
  const score = calculateScore(flags);
  assert('(c) same-category stacking prevented: score = 2.0', score === 2.0);
  assert('(c) score 2.0 → grade B', calculateRawGrade(score) === 'B');
}

// (d) Five HIGH categories => score 10.0 => grade F
{
  const flags = [
    makeFlag('DATA_SHARING', 'HIGH'), makeFlag('ARBITRATION', 'HIGH'),
    makeFlag('CONTENT_LICENSE', 'HIGH'), makeFlag('AUTO_RENEWAL', 'HIGH'),
    makeFlag('UNILATERAL_CHANGES', 'HIGH'),
  ];
  const score = calculateScore(flags);
  assert('(d) five HIGH categories → score 10.0', score === 10.0);
  assert('(d) five HIGH categories → grade F', calculateRawGrade(score) === 'F');
}

// (e) 2H + 2M + 1L => 6.25 -> 6.3 => grade D
{
  const flags = [
    makeFlag('DATA_SHARING', 'HIGH'), makeFlag('ARBITRATION', 'HIGH'),
    makeFlag('TRACKING', 'MEDIUM'), makeFlag('RETENTION', 'MEDIUM'),
    makeFlag('DATA_COLLECTION', 'LOW'),
  ];
  const score = calculateScore(flags);
  assert('(e) 2H+2M+1L → score 6.3', score === 6.3, `got ${score}`);
  assert('(e) score 6.3 → grade D', calculateRawGrade(score) === 'D');
}

// (f) Partial analysis + low score => grade ?
{
  const flags = [makeFlag('DATA_COLLECTION', 'LOW')];
  const docs = [
    { url: 'https://example.com/terms', type: 'TERMS', analyzed: true, coverage: 1 },
    { url: 'https://example.com/privacy', type: 'PRIVACY', analyzed: false, reason: 'fetch failed' },
  ];
  const r = evaluateGradeAndSummary(flags, docs);
  assert('(f) partial analysis + would-be A → grade ?', r.grade === '?', `got ${r.grade}`);
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
