'use strict';

const assert = require('assert');
const consent = require('./consent');

function storage(initial = {}) {
  const data = { ...initial };
  return {
    async get(key) {
      if (key === null) return { ...data };
      return { [key]: data[key] };
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

async function run() {
  const local = storage({ doc_a: { text: 'cached policy' }, keep: true });
  let state = await consent.getConsentState(local);
  assert.strictEqual(state.status, 'unset');
  assert.strictEqual(consent.hasValidConsent(state), false);

  const granted = await consent.setConsent('granted', local, 123);
  assert.strictEqual(granted.status, 'granted');
  assert.strictEqual(consent.hasValidConsent(await consent.getConsentState(local)), true);

  const changedVersion = storage({ agreewiseConsent: { status: 'granted', version: 0, timestamp: 123 } });
  assert.strictEqual(consent.hasValidConsent(await consent.getConsentState(changedVersion)), false);

  await consent.setConsent('denied', local, 456);
  assert.strictEqual(consent.hasValidConsent(await consent.getConsentState(local)), false);
  assert.strictEqual(await consent.clearPolicyCache(local), 1);
  assert.deepStrictEqual(await local.get(null), {
    agreewiseConsent: { status: 'denied', version: 1, timestamp: 456 },
    keep: true,
  });

  const unavailable = {
    async get() { throw new Error('storage unavailable'); },
  };
  assert.strictEqual((await consent.getConsentState(unavailable)).status, 'unavailable');
  console.log('Consent tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
