// server/test_extract.js - Unit tests for extraction, mapping, verification, and coverage
'use strict';
const { CHECKLIST_DEFS, mergeFindings, verifyQuote } = require('./services/checklist');
const { calculateAnalyzedChars, calculateCoverage } = require('./services/chunk');
const { evaluateGradeAndSummary } = require('./services/score');

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

console.log('\n=== test_extract.js ===\n');

// 1. ID to severity mapping
{
  const sourceText = 'dummy quote placeholder for testing';
  // Test HIGH IDs
  const highIds = ['SELLS_DATA', 'SHARES_ADS', 'AI_TRAINING', 'ARBITRATION', 'CONTENT_LICENSE', 'UNILATERAL_CHANGES'];
  for (const id of highIds) {
    const flags = mergeFindings([{ id, quote: sourceText }]);
    assert(`id mapping: ${id} → HIGH`, flags[0]?.severity === 'HIGH', `got ${flags[0]?.severity}`);
  }

  // Test MEDIUM IDs
  const medIds = ['BROAD_TRACKING', 'LONG_RETENTION', 'HARD_CANCEL', 'AFFILIATE_SHARING', 'LIABILITY_LIMIT', 'TERMINATION_AT_WILL'];
  for (const id of medIds) {
    const flags = mergeFindings([{ id, quote: sourceText }]);
    assert(`id mapping: ${id} → MEDIUM`, flags[0]?.severity === 'MEDIUM', `got ${flags[0]?.severity}`);
  }

  // AUTO_RENEW alone → LOW
  const autoRenewAlone = mergeFindings([{ id: 'AUTO_RENEW', quote: sourceText }]);
  assert('id mapping: AUTO_RENEW alone → LOW', autoRenewAlone[0]?.severity === 'LOW', `got ${autoRenewAlone[0]?.severity}`);

  // AUTO_RENEW combined with HARD_CANCEL → AUTO_RENEW is HIGH
  const combined = mergeFindings([
    { id: 'AUTO_RENEW', quote: sourceText },
    { id: 'HARD_CANCEL', quote: sourceText },
  ]);
  const autoRenewFlag = combined.find(f => f.id === 'AUTO_RENEW');
  const hardCancelFlag = combined.find(f => f.id === 'HARD_CANCEL');
  assert('id mapping: AUTO_RENEW combined with HARD_CANCEL → AUTO_RENEW is HIGH', autoRenewFlag?.severity === 'HIGH', `got ${autoRenewFlag?.severity}`);
  assert('id mapping: HARD_CANCEL remains MEDIUM in combined', hardCancelFlag?.severity === 'MEDIUM', `got ${hardCancelFlag?.severity}`);
}

// 2. Merging across chunks (one flag per id, longest verified quote)
{
  const sourceText = 'This is short. Here is a much longer and more complete arbitration agreement for dispute resolution.';
  const chunkFindings = [
    { id: 'ARBITRATION', quote: 'This is short.' },
    { id: 'ARBITRATION', quote: 'Here is a much longer and more complete arbitration agreement for dispute resolution.' },
  ];
  const merged = mergeFindings(chunkFindings, sourceText);
  assert('merge across chunks: exactly 1 ARBITRATION flag', merged.length === 1 && merged[0].id === 'ARBITRATION');
  assert('merge across chunks: keeps longest quote', merged[0].quote === 'Here is a much longer and more complete arbitration agreement for dispute resolution.');
}

// 3. Quote verification drops invented quotes
{
  const sourceText = 'We respect your privacy. All disputes shall be settled through binding arbitration.';
  const findings = [
    { id: 'ARBITRATION', quote: 'All disputes shall be settled through binding arbitration.' },
    { id: 'SELLS_DATA', quote: 'We sell your private data to any third party.' }, // invented!
  ];
  const verified = mergeFindings(findings, sourceText);
  assert('quote verification: keep verified quote', verified.some(f => f.id === 'ARBITRATION'));
  assert('quote verification: drop invented quote', !verified.some(f => f.id === 'SELLS_DATA'));
}

// 4. Coverage math
{
  const chunks = [
    { start: 0, end: 6000 },
    { start: 5500, end: 10000 },
  ];
  // Both succeed
  const fullChars = calculateAnalyzedChars(chunks);
  const fullCov = calculateCoverage(fullChars, 10000);
  assert('coverage math: full analysis = 1', fullCov === 1, `got ${fullCov}`);

  // One chunk fails
  const partialChars = calculateAnalyzedChars([chunks[0]]);
  const partialCov = calculateCoverage(partialChars, 10000);
  assert('coverage math: partial analysis = 0.6', partialCov === 0.6, `got ${partialCov}`);

  // Truncation by 60,000 char cap for 100,000 char doc
  const truncCov = calculateCoverage(60000, 100000);
  assert('coverage math: 60k cap of 100k doc = 0.6', truncCov === 0.6, `got ${truncCov}`);
}

// 5. Coverage < 0.7 rule
{
  // Coverage 0.5 with 0 flags → grade ? and summary "Only part of the policy could be read."
  const partialDoc = [{ type: 'TERMS', url: 'https://ex.com', analyzed: true, coverage: 0.5 }];
  const rPartial = evaluateGradeAndSummary([], partialDoc);
  assert('coverage < 0.7 rule: grade is ?', rPartial.grade === '?', `got ${rPartial.grade}`);
  assert('coverage < 0.7 rule: summary is "Only part of the policy could be read."', rPartial.summary === 'Only part of the policy could be read.', `got "${rPartial.summary}"`);

  // Coverage 0.8 with 0 flags → grade A
  const goodDoc = [{ type: 'TERMS', url: 'https://ex.com', analyzed: true, coverage: 0.8 }];
  const rGood = evaluateGradeAndSummary([], goodDoc);
  assert('coverage >= 0.7: grade is A', rGood.grade === 'A', `got ${rGood.grade}`);
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
