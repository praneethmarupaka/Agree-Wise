'use strict';

const assert = require('assert');
const storage = new Map();
const listeners = {};
const local = {
  async get(key) {
    if (key === null) return Object.fromEntries(storage);
    if (typeof key === 'string') return { [key]: storage.get(key) };
    return {};
  },
  async set(values) { Object.entries(values).forEach(([key, value]) => storage.set(key, value)); },
  async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key); },
};
const session = { ...local };
global.chrome = {
  storage: { local, session },
  runtime: { onMessage: { addListener(listener) { listeners.message = listener; } } },
  tabs: {
    onUpdated: { addListener(listener) { listeners.updated = listener; } },
    onRemoved: { addListener(listener) { listeners.removed = listener; } },
    async query() { return []; },
  },
};

const { cleanHtml, isBlockedAddress, handleAnalyze, formatRetryTime, updateConsent } = require('./background.js');

assert.strictEqual(cleanHtml('<script>x</script><h1>Terms</h1> text').text, 'Terms text');
[
  'http://localhost/policy', 'http://127.0.0.1/policy', 'http://10.0.0.1/policy',
  'http://192.168.1.1/policy', 'http://[::1]/policy', 'http://[fd00::1]/policy',
  'http://service.internal/policy',
].forEach((url) => assert.strictEqual(isBlockedAddress(url), true, url));
assert.strictEqual(isBlockedAddress('https://docs.github.com/terms'), false);

function response(status, data, headers = {}, url = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get(name) { return headers[name] || null; } },
    async text() { return typeof data === 'string' ? data : JSON.stringify(data); },
    async json() { return data; },
    async arrayBuffer() { return data; },
  };
}

(async () => {
  const originalFetch = global.fetch;
  let apiCalls = 0;
  global.fetch = async (url) => {
    if (url === 'https://example.com/terms') {
      return response(200, '<html><body>Terms and conditions with enough content.</body></html>', { 'content-type': 'text/html' }, url);
    }
    apiCalls++;
    return response(200, { grade: 'A', flags: [], documents: [{ analyzed: true }] });
  };

  await updateConsent('granted');
  const payload = { site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms' }] };
  await Promise.all([handleAnalyze(payload), handleAnalyze(payload)]);
  assert.strictEqual(apiCalls, 1, 'concurrent identical analyses should share one API request');
  await handleAnalyze(payload);
  assert.strictEqual(apiCalls, 1, 'valid cached analysis should avoid a repeated API request');

  await updateConsent('denied');
  await assert.rejects(handleAnalyze(payload), (error) => error.code === 'CONSENT_REQUIRED');
  assert.strictEqual(apiCalls, 1, 'denied consent must not transmit policy content');
  assert.strictEqual(formatRetryTime('45'), ' Retry after 45 seconds.');

  global.fetch = originalFetch;
  console.log('Background security, consent gating, caching and deduplication tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
