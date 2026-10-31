'use strict';

const assert = require('assert');
const { isPrivateHost, isSafeDocumentUrl, validateAnalyzeRequest } = require('./services/limits');

['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', 'fd00::1', 'service.internal'].forEach((host) => {
  assert.strictEqual(isPrivateHost(host), true, host);
});
assert.strictEqual(isSafeDocumentUrl('https://docs.github.com/terms'), true);
assert.strictEqual(isSafeDocumentUrl('http://127.0.0.1/terms'), false);
assert.strictEqual(isSafeDocumentUrl('https://user:pass@example.com/terms'), false);
assert.match(validateAnalyzeRequest({
  documents: [{ type: 'TERMS', url: 'http://[::1]/terms', text: 'x' }],
}), /public http or https URL/);
assert.match(validateAnalyzeRequest({
  documents: [{ type: 'TERMS', url: 'https://example.com/terms', text: 'x'.repeat(120001) }],
}), /120,000/);
console.log('Backend URL validation tests passed.');
