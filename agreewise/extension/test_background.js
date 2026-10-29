'use strict';

const assert = require('assert');

const storage = new Map();
const listeners = {};
global.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return { [key]: storage.get(key) };
        return {};
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => storage.set(key, value));
      },
    },
    session: {
      async remove() {},
    },
  },
  runtime: {
    onMessage: { addListener(listener) { listeners.message = listener; } },
  },
  tabs: {
    onUpdated: { addListener(listener) { listeners.updated = listener; } },
    onRemoved: { addListener(listener) { listeners.removed = listener; } },
  },
};

const { handleAnalyze, formatRetryTime } = require('./background.js');

function response(status, data, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers[name] || null; } },
    async text() { return typeof data === 'string' ? data : JSON.stringify(data); },
    async json() { return data; },
  };
}

async function run() {
  let apiCalls = 0;
  let resolveApi;
  global.fetch = async (url) => {
    if (url === 'https://example.com/terms-a') {
      return response(200, '<html>Terms text</html>');
    }
    if (url === 'https://example.com/terms-b') {
      return response(200, '<html>Terms text B</html>');
    }
    apiCalls++;
    if (resolveApi) await resolveApi;
    return response(200, { grade: 'A', flags: [], documents: [{ analyzed: true }] });
  };

  const payload = { site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms-a' }] };
  const first = handleAnalyze(payload);
  const second = handleAnalyze(payload);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepStrictEqual(firstResult, secondResult);
  assert.strictEqual(apiCalls, 1, 'concurrent identical analyses should share one API request');

  await handleAnalyze(payload);
  assert.strictEqual(apiCalls, 1, 'valid cached analysis should avoid a repeated API request');

  storage.clear();
  apiCalls = 0;
  let release;
  resolveApi = new Promise(resolve => { release = resolve; });
  const pending = handleAnalyze({ site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms-b' }] });
  const duplicatePending = handleAnalyze({ site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms-b' }] });
  release();
  await Promise.all([pending, duplicatePending]);
  assert.strictEqual(apiCalls, 1, 'duplicate concurrent analyses should not consume multiple requests');
  resolveApi = null;

  storage.clear();
  global.fetch = async (url) => {
    if (url === 'https://example.com/terms-a') return response(200, '<html>Terms text</html>');
    return response(429, { error: 'Rate limit exceeded: per-install limit reached.' }, { 'Retry-After': '3600' });
  };
  await assert.rejects(
    handleAnalyze({ site: 'example.com', documents: [{ type: 'TERMS', url: 'https://example.com/terms-a' }] }),
    /AgreeWise rate limit reached\. Retry after 60 minutes\..*per-install limit reached/
  );
  assert.strictEqual(formatRetryTime('45'), ' Retry after 45 seconds.');

  console.log('Background request deduplication, caching, and 429 tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
