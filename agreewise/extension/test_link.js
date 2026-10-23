// extension/test_link.js - tests for buildQuoteLink
'use strict';
const { buildQuoteLink } = require('./badge.js');

let passed = 0;
let failed = 0;

function test(desc, result, expected) {
  if (result === expected) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  FAIL: ${desc}`);
    console.error(`    Expected: ${expected}`);
    console.error(`    Got:      ${result}`);
    failed++;
  }
}

console.log('buildQuoteLink tests:\n');

// 1. Normal quote - first 8 words, URL-encoded
const q1 = 'Your subscription will automatically renew each month unless cancelled at least 24 hours prior.';
const r1 = buildQuoteLink('https://example.com/terms', q1);
// First 8 words: "Your subscription will automatically renew each month unless"
const expected1 = 'https://example.com/terms#:~:text=' + encodeURIComponent('Your subscription will automatically renew each month unless').replace(/-/g, '%2D').replace(/,/g, '%2C');
test('Normal quote produces text fragment', r1, expected1);

// 2. Quote with a hyphen and a comma
// Split on whitespace: "We", "may", "share", "your", "data", "with", "third-party,", "affiliated"
const q2 = 'We may share your data with third-party, affiliated companies without notice.';
const r2 = buildQuoteLink('https://example.com/privacy', q2);
const snippet2 = q2.trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
const enc2 = encodeURIComponent(snippet2).replace(/-/g, '%2D').replace(/,/g, '%2C');
test('Hyphen becomes %2D, comma becomes %2C', r2, `https://example.com/privacy#:~:text=${enc2}`);
console.log('    snippet:', snippet2);
console.log('    encoded:', enc2);

// 3. URL that already has a hash - hash must be stripped before new fragment
const r3 = buildQuoteLink('https://example.com/terms#section-3', q1);
test('Existing hash is stripped before adding fragment', r3, expected1);

// 4. Very short quote (fewer than 3 words) - returns plain URL without fragment
const r4 = buildQuoteLink('https://example.com/terms', 'auto-renew');
test('Short quote (<3 words) returns plain URL', r4, 'https://example.com/terms');

// 5. javascript: URL - must return null (unsafe protocol)
const r5 = buildQuoteLink('javascript:alert(1)', 'Some legitimate-looking quote here is present in the document');
test('javascript: URL returns null', r5, null);

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
