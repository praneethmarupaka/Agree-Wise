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

// Enable mock to bypass sourceText verification for mapping tests
process.env.MOCK_LLM = 'true';

// 1. ID to severity mapping (using realistic quotes that pass supports())
{
  const REALISTIC = {
    SELLS_DATA: 'We may sell your personal data to third parties',
    SHARES_ADS: 'We share your data with advertisers and ad networks',
    AI_TRAINING: 'We use your content to train our AI models',
    ARBITRATION: 'Any dispute shall be resolved by binding arbitration and you waive class actions',
    CONTENT_LICENSE: 'You grant us a perpetual, irrevocable, sublicensable, worldwide license to your content',
    UNILATERAL_CHANGES: 'We reserve the right to modify these terms without notice',
    BROAD_TRACKING: 'We use cross-site tracking and fingerprinting',
    LONG_RETENTION: 'We retain your data indefinitely',
    HARD_CANCEL: 'Cancellation requires phone call and there is no refund',
    AFFILIATE_SHARING: 'We share your data with our affiliates and subsidiaries',
    LIABILITY_LIMIT: 'We are not liable for any indirect or consequential damages',
    TERMINATION_AT_WILL: 'We may terminate your account at any time for any reason',
    AUTO_RENEW: 'Your subscription will automatically renew each month',
  };

  const highIds = ['SELLS_DATA', 'SHARES_ADS', 'AI_TRAINING', 'ARBITRATION', 'CONTENT_LICENSE', 'UNILATERAL_CHANGES'];
  for (const id of highIds) {
    const flags = mergeFindings([{ id, quote: REALISTIC[id] }]);
    assert(`id mapping: ${id} → HIGH`, flags[0]?.severity === 'HIGH', `got ${flags[0]?.severity}`);
  }

  const medIds = ['BROAD_TRACKING', 'LONG_RETENTION', 'HARD_CANCEL', 'AFFILIATE_SHARING', 'LIABILITY_LIMIT', 'TERMINATION_AT_WILL'];
  for (const id of medIds) {
    const flags = mergeFindings([{ id, quote: REALISTIC[id] }]);
    assert(`id mapping: ${id} → MEDIUM`, flags[0]?.severity === 'MEDIUM', `got ${flags[0]?.severity}`);
  }

  const autoRenewAlone = mergeFindings([{ id: 'AUTO_RENEW', quote: REALISTIC.AUTO_RENEW }]);
  assert('id mapping: AUTO_RENEW alone → LOW', autoRenewAlone[0]?.severity === 'LOW');

  const combined = mergeFindings([
    { id: 'AUTO_RENEW', quote: REALISTIC.AUTO_RENEW },
    { id: 'HARD_CANCEL', quote: REALISTIC.HARD_CANCEL },
  ]);
  assert('id mapping: AUTO_RENEW + HARD_CANCEL → HIGH', combined.find(f => f.id === 'AUTO_RENEW')?.severity === 'HIGH');
}

delete process.env.MOCK_LLM;

// 2. Merging across chunks (one flag per id, longest verified quote, context preserved)
{
  const sourceText = 'Short arbitration clause. Here is a much longer binding arbitration agreement for dispute resolution and you waive class actions.';
  const chunkFindings = [
    { id: 'ARBITRATION', quote: 'Short arbitration clause.', context: 'Section 1. Short arbitration clause.' },
    { id: 'ARBITRATION', quote: 'Here is a much longer binding arbitration agreement for dispute resolution and you waive class actions.', context: 'Section 2. Here is a much longer binding arbitration agreement.' },
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
  const sourceText = 'We respect your privacy. Disputes shall be settled through binding arbitration and you waive class action rights.';
  const findings = [
    { id: 'ARBITRATION', quote: 'Disputes shall be settled through binding arbitration and you waive class action rights.' },
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

// 7. scope field is set on flags
{
  process.env.MOCK_LLM = 'true';
  const flags = mergeFindings([
    { id: 'ARBITRATION', quote: 'binding arbitration for disputes regarding undisclosed paid contributions' },
  ]);
  assert('scope: narrow arbitration has scope=narrow', flags[0]?.scope === 'narrow');
  const flags2 = mergeFindings([
    { id: 'ARBITRATION', quote: 'any dispute shall be resolved by binding arbitration and you waive class actions' },
  ]);
  assert('scope: general arbitration has scope=general', flags2[0]?.scope === 'general');
  delete process.env.MOCK_LLM;
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
