'use strict';

const AGREEWISE_CONSENT_VERSION = 1;
const AGREEWISE_CONSENT_KEY = 'agreewiseConsent';

function consentStorage(storage) {
  if (storage) return storage;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) return chrome.storage.local;
  throw new Error('Extension storage is unavailable');
}

async function getConsentState(storage) {
  try {
    const result = await consentStorage(storage).get(AGREEWISE_CONSENT_KEY);
    const state = result?.[AGREEWISE_CONSENT_KEY];
    if (!state || (state.status !== 'granted' && state.status !== 'denied')) {
      return { status: 'unset', version: AGREEWISE_CONSENT_VERSION, timestamp: null };
    }
    return {
      status: state.status,
      version: Number(state.version) || 0,
      timestamp: Number(state.timestamp) || null,
    };
  } catch (error) {
    return { status: 'unavailable', version: 0, timestamp: null, error: error.message };
  }
}

function hasValidConsent(state) {
  return Boolean(
    state &&
    state.status === 'granted' &&
    state.version === AGREEWISE_CONSENT_VERSION &&
    Number.isFinite(state.timestamp) &&
    state.timestamp > 0
  );
}

async function setConsent(status, storage, now = Date.now()) {
  if (status !== 'granted' && status !== 'denied') throw new Error('Invalid consent status');
  const value = { status, version: AGREEWISE_CONSENT_VERSION, timestamp: now };
  await consentStorage(storage).set({ [AGREEWISE_CONSENT_KEY]: value });
  return value;
}

async function clearPolicyCache(storage) {
  const target = consentStorage(storage);
  const all = await target.get(null);
  const keys = Object.keys(all || {}).filter((key) => key.startsWith('doc_'));
  if (keys.length) await target.remove(keys);
  return keys.length;
}

const AgreeWiseConsent = {
  AGREEWISE_CONSENT_VERSION,
  AGREEWISE_CONSENT_KEY,
  getConsentState,
  hasValidConsent,
  setConsent,
  clearPolicyCache,
};

if (typeof globalThis !== 'undefined') globalThis.AgreeWiseConsent = AgreeWiseConsent;
if (typeof module !== 'undefined') module.exports = AgreeWiseConsent;
