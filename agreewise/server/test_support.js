// server/test_support.js - Unit tests for support.js semantic gates
'use strict';
const { SUPPORT_VERSION, supports, describeScope, severityForArbitration } = require('./services/support');
const { CHECKLIST_DEFS, mergeFindings } = require('./services/checklist');
const { calculateScore, calculateRawGrade } = require('./services/score');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
  if (condition) { console.log(`  PASS  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); failed++; }
}

console.log('\n=== support.js tests ===\n');

assert('SUPPORT_VERSION is 3', SUPPORT_VERSION === 3);

// 1. mediation without "arbitrat" → dropped
assert('1. mediation only → dropped',
  supports('ARBITRATION', 'binding mediation decided by the mediator', '') === false);

// 2. mediation + binding arbitration limited to disputes about undisclosed paid → MEDIUM, narrow
{
  const q = 'binding arbitration for disputes regarding undisclosed paid contributions';
  assert('2. narrow arbitration → supported', supports('ARBITRATION', q, '') === true);
  assert('2. narrow arbitration → scope narrow', describeScope('ARBITRATION', q, '') === 'narrow');
  assert('2. narrow arbitration → severity MEDIUM', severityForArbitration(q, '') === 'MEDIUM');
}

// 3. general mandatory + class waiver → HIGH, general
{
  const q = 'any dispute shall be resolved by binding arbitration and you waive class actions';
  assert('3. mandatory+class waiver → supported', supports('ARBITRATION', q, '') === true);
  assert('3. mandatory+class waiver → scope general', describeScope('ARBITRATION', q, '') === 'general');
  assert('3. mandatory+class waiver → severity HIGH', severityForArbitration(q, '') === 'HIGH');
}

// 4. Discord class action waiver text → HIGH
{
  const q = 'you agree that disputes will be resolved solely by binding arbitration';
  const ctx = 'you waive any right to participate in a class action lawsuit or class-wide arbitration';
  assert('4. Discord-style → supported', supports('ARBITRATION', q, ctx) === true);
  assert('4. Discord-style → severity HIGH', severityForArbitration(q, ctx) === 'HIGH');
}

// 5. "Either party may elect arbitration" → dropped (optional without mandatory)
assert('5. optional arbitration → dropped',
  supports('ARBITRATION', 'Either party may elect arbitration', '') === false);

// 6. Creative Commons CC BY-SA 4.0 and GFDL → dropped
assert('6. CC BY-SA → dropped',
  supports('CONTENT_LICENSE', 'licensed under Creative Commons CC BY-SA 4.0', '') === false);
assert('6. GFDL → dropped',
  supports('CONTENT_LICENSE', 'available under the GNU Free Documentation License', '') === false);

// 7. broad company license → HIGH
{
  const q = 'You grant us a perpetual, irrevocable, sublicensable, worldwide license to your content';
  assert('7. broad company license → supported', supports('CONTENT_LICENSE', q, '') === true);
  assert('7. broad company license → scope general', describeScope('CONTENT_LICENSE', q, '') === 'general');
}

// 8. warranty disclaimer → reclassify to WARRANTY_DISCLAIMER
{
  const q = 'THE SERVICES ARE PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND';
  assert('8. warranty → reclassify', supports('LIABILITY_LIMIT', q, '') === 'reclassify');
  assert('8. WARRANTY_DISCLAIMER defined', !!CHECKLIST_DEFS.WARRANTY_DISCLAIMER);
  assert('8. WARRANTY_DISCLAIMER is LOW', CHECKLIST_DEFS.WARRANTY_DISCLAIMER.defaultSeverity === 'LOW');
}

// 9. actual liability limitation → supported
{
  const q = 'We are not liable for any indirect or consequential damages';
  assert('9. liability limit → supported', supports('LIABILITY_LIMIT', q, '') === true);
}

// 10. unilateral changes with "without notice" → supported
{
  const q = 'we reserve the right to suspend or end the services at any time, with or without notice';
  const ctx = 'we reserve the right to modify these terms without notice';
  assert('10. unilateral changes → supported', supports('UNILATERAL_CHANGES', q, ctx) === true);
}

// 10b. unilateral changes WITH notification → dropped
{
  const q = 'we may update these terms from time to time';
  const ctx = 'we will notify you of material changes. we may modify these terms at any time';
  assert('10b. unilateral changes + notify → dropped',
    supports('UNILATERAL_CHANGES', q, ctx) === false);
}

// 11. scoring: only HIGH finding dropped → should not be F
{
  process.env.MOCK_LLM = 'true';
  const findings = [
    { id: 'ARBITRATION', quote: 'binding mediation only', context: '', explanation: 'test' },
    { id: 'AUTO_RENEW', quote: 'Your subscription will automatically renew', context: 'Billing.', explanation: 'test' },
  ];
  const flags = mergeFindings(findings, '');
  // ARBITRATION should be dropped (no "arbitrat" word in the right context)
  const hasArb = flags.some(f => f.id === 'ARBITRATION');
  assert('11. dropped arbitration not in flags', !hasArb);
  const score = calculateScore(flags);
  const grade = calculateRawGrade(score);
  assert('11. grade without dropped finding is not F', grade !== 'F', `got ${grade}`);
  delete process.env.MOCK_LLM;
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
