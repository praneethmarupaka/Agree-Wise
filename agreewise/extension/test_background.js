'use strict';

const assert = require('assert');
const { cleanHtml, isBlockedAddress, analysisKey, handleAnalyze, updateConsent } = require('./background');

assert.strictEqual(cleanHtml('<script>x</script><h1>Terms</h1> text').text, 'Terms text');
[
  'http://localhost/policy',
  'http://127.0.0.1/policy',
  'http://10.0.0.1/policy',
  'http://192.168.1.1/policy',
  'http://[::1]/policy',
  'http://[fd00::1]/policy',
  'http://service.internal/policy',
].forEach((url) => assert.strictEqual(isBlockedAddress(url), true, url));
assert.strictEqual(isBlockedAddress('https://docs.github.com/terms'), false);

const a = analysisKey({ documents: [{ type: 'PRIVACY', url: 'https://example.com/privacy' }, { type: 'TERMS', url: 'https://example.com/terms' }] });
const b = analysisKey({ documents: [{ type: 'TERMS', url: 'https://example.com/terms' }, { type: 'PRIVACY', url: 'https://example.com/privacy' }] });
assert.strictEqual(a, b);

function fakeStorage() {
  const values = {};
  return {
    async get(key) {
      if (key === null) return { ...values };
      return { [key]: values[key] };
    },
    async set(input) { Object.assign(values, input); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

(async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  global.chrome = {
    storage: { local, session },
    tabs: { async query() { return []; } },
  };
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async (url) => {
    fetchCalls++;
    if (url.includes('onrender.com')) {
      return { ok: true, status: 200, async json() { return { grade: 'A', flags: [] }; }, async text() { return ''; } };
    }
    return {
      ok: true,
      status: 200,
      url,
      headers: { get() { return 'text/html'; } },
      async text() { return '<html><body>Terms and conditions with enough content.</body></html>'; },
    };
  };

  await updateConsent('granted');
  await handleAnalyze({ site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms' }] });
  assert.strictEqual(fetchCalls, 2);
  await updateConsent('denied');
  await assert.rejects(
    handleAnalyze({ site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms' }] }),
    (error) => error.code === 'CONSENT_REQUIRED'
  );
  assert.strictEqual(fetchCalls, 2);
  global.fetch = originalFetch;
  console.log('Background security, consent gating and deduplication tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
