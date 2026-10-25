// server/test_cache.js - Unit tests for cache keys, TTL, boundaries, coverage, and negation
'use strict';
const { hashKey, hashText } = require('./services/cache');
const { calculateRawGrade } = require('./services/score');
const { calculateAnalyzedChars, calculateCoverage } = require('./services/chunk');
const { mergeFindings } = require('./services/checklist');

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

console.log('\n=== test_cache.js ===\n');

// 1. Two different texts for the same URL produce different cache keys
{
  const text1 = 'Privacy Policy Version 1: We collect standard cookie data.';
  const text2 = 'Privacy Policy Version 2: We sell your data to third party advertisers.';
  const key1 = hashKey(text1, 'gemini-3.5-flash-lite');
  const key2 = hashKey(text2, 'gemini-3.5-flash-lite');
  assert('cache key: two different texts produce different keys', key1 !== key2, `key1: ${key1.slice(0, 8)}, key2: ${key2.slice(0, 8)}`);
}

// 2. Identical text gives an identical key
{
  const text = 'Terms of Service: All disputes are subject to binding arbitration.';
  const keyA = hashKey(text, 'gemini-3.5-flash-lite');
  const keyB = hashText(text, 'gemini-3.5-flash-lite');
  assert('cache key: identical text gives identical key', keyA === keyB, `keyA: ${keyA.slice(0, 8)}, keyB: ${keyB.slice(0, 8)}`);
}

// 3. Boundary scores 1.5, 3.5, 6, 8 map to A, B, C, D
{
  assert('boundary: score 1.5 maps to A', calculateRawGrade(1.5) === 'A');
  assert('boundary: score 3.5 maps to B', calculateRawGrade(3.5) === 'B');
  assert('boundary: score 6.0 maps to C', calculateRawGrade(6.0) === 'C');
  assert('boundary: score 8.0 maps to D', calculateRawGrade(8.0) === 'D');
  assert('boundary: score 8.1 maps to F', calculateRawGrade(8.1) === 'F');
}

// 4. Overlapping chunks do not inflate coverage
{
  // 10,000 char total text, split into two chunks of 6,000 chars with 2,000 char overlap [0-6000] and [4000-10000]
  const totalChars = 10000;
  const chunks = [
    { start: 0, end: 6000 },
    { start: 4000, end: 10000 },
  ];
  const uniqueChars = calculateAnalyzedChars(chunks);
  const coverage = calculateCoverage(uniqueChars, totalChars);
  assert('overlapping chunks: unique chars equals total (10000, not 12000)', uniqueChars === 10000);
  assert('overlapping chunks: coverage does not exceed 1 (100%)', coverage === 1);
}

// 5. Negated sentence is not reported (stubbed LLM)
{
  const sourceText = 'Data Practices: We do not sell your personal information to third parties. We never share it.';
  // Stubbed LLM that mistakenly flagged the negated practice
  const stubbedFindings = [
    {
      id: 'SELLS_DATA',
      quote: 'We do not sell your personal information',
      context: 'Data Practices: We do not sell your personal information to third parties.',
      explanation: 'States company does not sell data.',
    },
    {
      id: 'SHARES_ADS',
      quote: 'We never share it',
      context: 'We never share it.',
      explanation: 'Mentions sharing.',
    },
  ];
  const finalFlags = mergeFindings(stubbedFindings, sourceText);
  assert('negation: stubbed LLM negated findings are dropped', finalFlags.length === 0, `got ${finalFlags.length} flags`);
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
