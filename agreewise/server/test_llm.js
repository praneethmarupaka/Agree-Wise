'use strict';

const assert = require('assert');
const { cleanAndParse, requestGemini, LLM_TIMEOUT_MS } = require('./services/llm');

assert.deepStrictEqual(cleanAndParse('```json\n[]\n```'), []);
assert.strictEqual(cleanAndParse('not json'), null);
assert(LLM_TIMEOUT_MS >= 10000);

(async () => {
  const originalKey = process.env.LLM_API_KEY;
  const originalFetch = global.fetch;
  process.env.LLM_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: false, status: 429, async text() { return 'quota exceeded'; } });
  await assert.rejects(requestGemini('TERMS', 'test text'), (error) => error.status === 429 && /Rate limited/.test(error.message));

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
    },
  });
  await assert.rejects(requestGemini('TERMS', 'test text'), /LLM JSON parse error/);

  if (originalKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = originalKey;
  global.fetch = originalFetch;
  console.log('Gemini error and response validation tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
