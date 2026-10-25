// server/test_extract.js - Unit tests for extraction, mapping, verification, negation, and coverage
'use strict';
const { mergeFindings, isNegated } = require('./services/checklist');
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
  const highIds = ['SELLS_DATA', 'SHARES_ADS', 'AI_TRAINING', 'ARBITRATION', 'CONTENT_LICENSE', 'UNILATERAL_CHANGES'];
  for (const id of highIds) {
    const flags = mergeFindings([{ id, quote: sourceText }]);
    assert(`id mapping: ${id} → HIGH`, flags[0]?.severity === 'HIGH');
  }

  const medIds = ['BROAD_TRACKING', 'LONG_RETENTION', 'HARD_CANCEL', 'AFFILIATE_SHARING', 'LIABILITY_LIMIT', 'TERMINATION_AT_WILL'];
  for (const id of medIds) {
    const flags = mergeFindings([{ id, quote: sourceText }]);
    assert(`id mapping: ${id} → MEDIUM`, flags[0]?.severity === 'MEDIUM');
  }

  const autoRenewAlone = mergeFindings([{ id: 'AUTO_RENEW', quote: sourceText }]);
  assert('id mapping: AUTO_RENEW alone → LOW', autoRenewAlone[0]?.severity === 'LOW');

  const combined = mergeFindings([{ id: 'AUTO_RENEW', quote: sourceText }, { id: 'HARD_CANCEL', quote: sourceText }]);
  assert('id mapping: AUTO_RENEW + HARD_CANCEL → HIGH', combined.find(f => f.id === 'AUTO_RENEW')?.severity === 'HIGH');
}

// 2. Merging across chunks (one flag per id, longest verified quote, context preserved)
{
  const sourceText = 'Short quote. Here is a much longer and more complete arbitration agreement for dispute resolution.';
  const chunkFindings = [
    { id: 'ARBITRATION', quote: 'Short quote.', context: 'Section 1. Short quote.' },
    { id: 'ARBITRATION', quote: 'Here is a much longer and more complete arbitration agreement for dispute resolution.', context: 'Section 2. Here is a much longer and more complete arbitration agreement for dispute resolution.' },
  ];
  const merged = mergeFindings(chunkFindings, sourceText);
  assert('merge across chunks: exactly 1 ARBITRATION flag', merged.length === 1 && merged[0].id === 'ARBITRATION');
  assert('merge across chunks: keeps longest quote', merged[0].quote.length > 20);
  assert('merge across chunks: preserves context', merged[0].context.includes('Section 2'));
}

// 3. Negated sentences are not reported (stubbed LLM output / checklist filter)
{
  const sourceText = 'We respect your privacy. We do not sell your personal data. We never share your data.';
  const findings = [
    { id: 'SELLS_DATA', quote: 'We do not sell your personal data', context: 'Privacy Policy. We do not sell your personal data.' },
    { id: 'SHARES_ADS', quote: 'We never share your data', context: 'Data. We never share your data.' },
  ];
  assert('isNegated detects "do not sell"', isNegated(findings[0]));
  assert('isNegated detects "never share"', isNegated(findings[1]));
  const merged = mergeFindings(findings, sourceText);
  assert('negation: negated findings are dropped', merged.length === 0);
}

// 4. Quote verification drops invented quotes
{
  const sourceText = 'We respect your privacy. Disputes shall be settled through binding arbitration.';
  const findings = [
    { id: 'ARBITRATION', quote: 'Disputes shall be settled through binding arbitration.' },
    { id: 'SELLS_DATA', quote: 'We sell your private data to any third party.' }, // invented!
  ];
  const verified = mergeFindings(findings, sourceText);
  assert('quote verification: keep verified quote', verified.some(f => f.id === 'ARBITRATION'));
  assert('quote verification: drop invented quote', !verified.some(f => f.id === 'SELLS_DATA'));
}

// 5. Coverage math (unique ranges, no overlap inflation)
{
  const chunks = [{ start: 0, end: 6000 }, { start: 5500, end: 10000 }];
  const fullChars = calculateAnalyzedChars(chunks);
  assert('coverage math: overlapping chunks merged to unique range (10000)', fullChars === 10000);
  assert('coverage math: full analysis = 1', calculateCoverage(fullChars, 10000) === 1);

  const partialChars = calculateAnalyzedChars([chunks[0]]);
  assert('coverage math: partial analysis = 0.6', calculateCoverage(partialChars, 10000) === 0.6);

  const truncCov = calculateCoverage(60000, 100000);
  assert('coverage math: 60k cap of 100k doc = 0.6', truncCov === 0.6);
}

// 6. Coverage < 0.7 rule
{
  const partialDoc = [{ type: 'TERMS', url: 'https://ex.com', analyzed: true, coverage: 0.5 }];
  const rPartial = evaluateGradeAndSummary([], partialDoc);
  assert('coverage < 0.7 rule: grade is ?', rPartial.grade === '?');
  assert('coverage < 0.7 rule: summary is "Only part of the policy could be read."', rPartial.summary === 'Only part of the policy could be read.');

  const goodDoc = [{ type: 'TERMS', url: 'https://ex.com', analyzed: true, coverage: 0.8 }];
  assert('coverage >= 0.7: grade is A', evaluateGradeAndSummary([], goodDoc).grade === 'A');
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
