'use strict';

const assert = require('assert');
const { processDocument } = require('./routes/analyze');

const URL = 'https://example.com/terms';

function makeDocument(sentence) {
  const padding = ' Policy text.';
  const text = `${sentence}${padding}${' Additional policy language.'.repeat(100)}`;
  return { type: 'TERMS', url: URL, text };
}

async function analyzeWith(findings, sentence) {
  const saves = [];
  const cache = {
    async getAnalysis() { return null; },
    async saveAnalysis(data) {
      saves.push(data);
      return data;
    },
  };
  const result = await processDocument(makeDocument(sentence), {
    cache,
    analyzeChunk: async () => findings,
  });
  return { result, saves };
}

async function run() {
  process.env.MOCK_LLM = 'false';

  {
    const quote = 'If you are eligible under the Data Privacy Framework, disputes may be resolved through binding arbitration.';
    const { result } = await analyzeWith([
      { id: 'ARBITRATION', quote, context: `Privacy. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 1);
    assert.strictEqual(result.flags[0].scope, 'narrow');
    assert.strictEqual(result.flags[0].severity, 'MEDIUM');
  }

  {
    const quote = 'The beta preview feature may change or be discontinued without notice.';
    const { result } = await analyzeWith([
      { id: 'UNILATERAL_CHANGES', quote, context: `Beta Preview. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 0);
  }

  {
    const quote = 'All purchases are non-refundable.';
    const { result } = await analyzeWith([
      { id: 'HARD_CANCEL', quote, context: `Refunds. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 0);
  }

  {
    const quote = 'You grant us a perpetual, irrevocable license to your content solely to provide the service.';
    const { result } = await analyzeWith([
      { id: 'SHARES_ADS', quote, context: `Content. ${quote}` },
      { id: 'CONTENT_LICENSE', quote, context: `Content. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 1);
    assert.strictEqual(result.flags[0].id, 'CONTENT_LICENSE');
    assert.strictEqual(result.flags[0].scope, 'narrow');
    assert.strictEqual(result.flags[0].severity, 'MEDIUM');
  }

  {
    const quote = 'We may show targeted ads based on general site activity.';
    const { result } = await analyzeWith([
      { id: 'SHARES_ADS', quote, context: `Advertising. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 0);
  }

  {
    const quote = 'We may share your personal data with advertisers and ad networks.';
    const { result } = await analyzeWith([
      { id: 'SHARES_ADS', quote, context: `Advertising. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 1);
    assert.strictEqual(result.flags[0].id, 'SHARES_ADS');
  }

  {
    const quote = 'You grant us a perpetual, irrevocable, sublicensable, worldwide license to your content for advertising, commercial promotion, and AI model training.';
    const { result, saves } = await analyzeWith([
      { id: 'CONTENT_LICENSE', quote, context: `Content rights. ${quote}` },
    ], quote);
    assert.strictEqual(result.flags.length, 1);
    assert.strictEqual(result.flags[0].scope, 'general');
    assert.strictEqual(result.flags[0].severity, 'HIGH');
    assert.strictEqual(saves.length, 1);
  }

  {
    const quote = 'All purchases are non-refundable.';
    const text = makeDocument(quote).text;
    const cached = {
      flags: [{ id: 'HARD_CANCEL', quote, context: `Refunds. ${quote}` }],
      coverage: 1,
      createdAt: new Date(),
    };
    const result = await processDocument(
      { type: 'TERMS', url: URL, text },
      {
        cache: {
          async getAnalysis() { return cached; },
          async saveAnalysis() { throw new Error('cache hit must not save'); },
        },
        analyzeChunk: async () => {
          throw new Error('cache hit must not invoke the analyzer');
        },
      }
    );
    assert.strictEqual(result.flags.length, 0);
  }

  console.log('Production pipeline false-positive regression tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
