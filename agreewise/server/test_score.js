// server/test_score.js - Unit tests for score.js grading logic
// Run: node server/test_score.js  (from project root) or: node test_score.js (from server/)
'use strict';
const { calculateScore, calculateRawGrade, evaluateGradeAndSummary } = require('./services/score');

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

// (a) No flags => grade A
{
  const flags = [];
  const docs = allAnalyzed(['https://example.com/terms']);
  const r = evaluateGradeAndSummary(flags, docs);
  assert('(a) no flags → grade A', r.grade === 'A', `got ${r.grade}, score ${r.riskScore}`);
}

// (b) One MEDIUM flag => grade A or B (score = 1.0)
{
  const flags = [makeFlag('TRACKING', 'MEDIUM')];
  const docs = allAnalyzed(['https://example.com/terms']);
  const r = evaluateGradeAndSummary(flags, docs);
  assert('(b) one MEDIUM → A or B', r.grade === 'A' || r.grade === 'B', `got ${r.grade}, score ${r.riskScore}`);
}

// (c) Three flags in same category count as only ONE (highest severity = HIGH => score 2.0 => grade B)
{
  const flags = [
    makeFlag('DATA_SHARING', 'LOW'),
    makeFlag('DATA_SHARING', 'MEDIUM'),
    makeFlag('DATA_SHARING', 'HIGH'),
  ];
  const docs = allAnalyzed(['https://example.com/terms']);
  const score = calculateScore(flags);
  const grade = calculateRawGrade(score);
  assert('(c) same-category stacking prevented: score = 2.0', score === 2.0, `got ${score}`);
  assert('(c) same-category stacking → grade B', grade === 'B', `got ${grade}`);
}

// (d) Five different categories at HIGH => score 10.0 (capped) => grade F
{
  const flags = [
    makeFlag('DATA_SHARING', 'HIGH'),
    makeFlag('ARBITRATION', 'HIGH'),
    makeFlag('CONTENT_LICENSE', 'HIGH'),
    makeFlag('AUTO_RENEWAL', 'HIGH'),
    makeFlag('UNILATERAL_CHANGES', 'HIGH'),
  ];
  const docs = allAnalyzed(['https://example.com/terms']);
  const score = calculateScore(flags);
  const r = evaluateGradeAndSummary(flags, docs);
  assert('(d) five HIGH categories → score 10.0', score === 10.0, `got ${score}`);
  assert('(d) five HIGH categories → grade F', r.grade === 'F', `got ${r.grade}`);
}

// (e) Two HIGH + two MEDIUM + one LOW across 5 different categories
//     Score = 2*2.0 + 2*1.0 + 1*0.25 = 6.25 => grade D
{
  const flags = [
    makeFlag('DATA_SHARING', 'HIGH'),        // 2.0
    makeFlag('ARBITRATION', 'HIGH'),          // 2.0
    makeFlag('TRACKING', 'MEDIUM'),           // 1.0
    makeFlag('RETENTION', 'MEDIUM'),          // 1.0
    makeFlag('DATA_COLLECTION', 'LOW'),       // 0.25
  ];
  const docs = allAnalyzed(['https://example.com/terms']);
  const score = calculateScore(flags);
  const r = evaluateGradeAndSummary(flags, docs);
  // 2*2.0 + 2*1.0 + 1*0.25 = 6.25; after Math.round(6.25*10)/10 JS gives 6.3 (banker's rounding)
  assert('(e) 2H+2M+1L across 5 cats → score 6.25 or 6.3', score === 6.25 || score === 6.3, `got ${score}`);
  assert('(e) score 6.25 → grade C or D', r.grade === 'C' || r.grade === 'D', `got ${r.grade}`);
}

// (f) Not all docs analyzed + low score => grade "?"
{
  const flags = [makeFlag('DATA_COLLECTION', 'LOW')]; // score 0.25 → raw grade A
  const docs = [
    { url: 'https://example.com/terms', type: 'TERMS', analyzed: true },
    { url: 'https://example.com/privacy', type: 'PRIVACY', analyzed: false, reason: 'fetch failed' },
  ];
  const r = evaluateGradeAndSummary(flags, docs);
  assert('(f) partial analysis + would-be A → grade ?', r.grade === '?', `got ${r.grade}`);
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
