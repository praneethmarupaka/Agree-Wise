// background.js - Consent-gated policy fetching, caching and backend bridge.
/* global importScripts, chrome, recordTabStart, recordTabResult, recordTabError, resetTabAction */
'use strict';

if (typeof importScripts === 'function') importScripts('icon.js', 'consent.js');

const CONSENT = typeof AgreeWiseConsent !== 'undefined'
  ? AgreeWiseConsent
  : (typeof require === 'function' ? require('./consent') : null);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const BACKEND_URL = 'https://agree-wise-7hjb.onrender.com/analyze';
const pendingControllers = new Set();
const inFlightAnalyses = new Map();

function cleanHtml(html) {
  if (!html || typeof html !== 'string') return { text: '', originalLength: 0, truncated: false };
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ').trim();
  const originalLength = cleaned.length;
  const truncated = originalLength > 60000;
  return { text: truncated ? cleaned.slice(0, 60000) : cleaned, originalLength, truncated };
}

function isBlockedAddress(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return true; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  if (parsed.username || parsed.password) return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  if (/^(0|127|10|169\.254|192\.0\.0|192\.168)\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || /^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return Boolean(mapped && isBlockedAddress(`http://${mapped[1]}`));
}

async function getInstallId() {
  const res = await chrome.storage.local.get('installId');
  if (res.installId && typeof res.installId === 'string') return res.installId;
  const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'inst_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  await chrome.storage.local.set({ installId: newId });
  return newId;
}

async function getCachedDoc(url) {
  try {
    const res = await chrome.storage.local.get('doc_' + url);
    const item = res['doc_' + url];
    if (item && item.timestamp && Date.now() - item.timestamp < CACHE_TTL_MS) {
      if (typeof item.data === 'object' && item.data !== null) return item.data;
      if (typeof item.text === 'string') {
        return { text: item.text, originalLength: item.originalLength || item.text.length, truncated: Boolean(item.truncated) };
      }
    }
  } catch (_) {}
  return null;
}

async function setCachedDoc(url, docData) {
  try {
    await chrome.storage.local.set({ ['doc_' + url]: { ...docData, timestamp: Date.now() } });
  } catch (_) {}
}

async function readResponseText(response, signal) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('Policy response too large');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let total = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Policy response too large');
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

async function fetchDocument(doc, signal) {
  const { type, url } = doc;
  if (isBlockedAddress(url)) return { type, url, text: null, originalLength: 0, truncated: false, error: 'Blocked address' };
  const cached = await getCachedDoc(url);
  if (cached !== null) return { type, url, ...cached };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.url && isBlockedAddress(response.url)) throw new Error('Redirected to a blocked address');
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (/application\/pdf|\.pdf(?:$|[?#])/i.test(response.url || url) || contentType.includes('application/pdf')) {
      return { type, url, text: null, originalLength: 0, truncated: false, error: 'PDF not supported yet' };
    }
    if (contentType && !/(text\/html|text\/plain|application\/xhtml\+xml)/i.test(contentType)) {
      return { type, url, text: null, originalLength: 0, truncated: false, error: 'Unsupported policy content type' };
    }
    const cleaned = cleanHtml(await readResponseText(response, signal));
    if (cleaned.text) await setCachedDoc(url, cleaned);
    return { type, url, ...cleaned };
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    return { type, url, text: null, originalLength: 0, truncated: false, error: error.message || "Couldn't fetch the page" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function consentError(state) {
  const error = new Error(state.status === 'unavailable'
    ? 'Consent status unavailable; analysis is disabled.'
    : 'Consent is required before AI analysis.');
  error.code = state.status === 'unavailable' ? 'CONSENT_UNAVAILABLE' : 'CONSENT_REQUIRED';
  return error;
}

function withdrawnError() {
  const error = new Error('Consent was withdrawn; analysis cancelled.');
  error.code = 'CONSENT_WITHDRAWN';
  return error;
}

async function handleAnalyze(payload) {
  const initialConsent = await CONSENT.getConsentState();
  if (!CONSENT.hasValidConsent(initialConsent)) throw consentError(initialConsent);
  const { site, documents = [] } = payload || {};
  const controller = new AbortController();
  pendingControllers.add(controller);
  try {
    const processedDocs = [];
    for (const document of documents) {
      const currentConsent = await CONSENT.getConsentState();
      if (!CONSENT.hasValidConsent(currentConsent)) throw withdrawnError();
      processedDocs.push(await fetchDocument(document, controller.signal));
    }
    const finalConsent = await CONSENT.getConsentState();
    if (!CONSENT.hasValidConsent(finalConsent)) throw withdrawnError();
    const installId = await getInstallId();
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
      body: JSON.stringify({ site, documents: processedDocs }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Server returned ${response.status}: ${errorText.slice(0, 100)}`);
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') throw withdrawnError();
    throw error;
  } finally {
    pendingControllers.delete(controller);
  }
}

function analysisKey(payload) {
  return JSON.stringify((payload?.documents || [])
    .map((doc) => ({ type: doc.type, url: doc.url }))
    .sort((a, b) => `${a.type}:${a.url}`.localeCompare(`${b.type}:${b.url}`)));
}

async function clearLocalAnalysisState() {
  await CONSENT.clearPolicyCache();
  if (chrome.storage?.session) {
    const all = await chrome.storage.session.get(null).catch(() => ({}));
    const keys = Object.keys(all || {}).filter((key) => key.startsWith('tab_'));
    if (keys.length) await chrome.storage.session.remove(keys).catch(() => {});
  }
}

async function broadcastConsentChange() {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.map((tab) => tab.id
    ? chrome.tabs.sendMessage(tab.id, { type: 'CONSENT_CHANGED' }).catch(() => {})
    : null));
}

async function updateConsent(status) {
  if (status === 'denied') {
    for (const controller of pendingControllers) controller.abort();
    await clearLocalAnalysisState();
  }
  try {
    const state = await CONSENT.setConsent(status);
    await broadcastConsentChange();
    return state;
  } catch (error) {
    await chrome.storage.local.remove(CONSENT.AGREEWISE_CONSENT_KEY).catch(() => {});
    throw error;
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CONSENT') {
      CONSENT.getConsentState()
        .then((state) => sendResponse({ success: true, state }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }
    if (message.type === 'SET_CONSENT') {
      updateConsent(message.status)
        .then((state) => sendResponse({ success: true, state }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }
    if (message.type !== 'ANALYZE' && message.type !== 'analyze') return false;
    const payload = message.payload || message;
    const key = analysisKey(payload);
    if (inFlightAnalyses.has(key)) {
      inFlightAnalyses.get(key)
        .then((data) => sendResponse({ success: true, data }))
        .catch((error) => sendResponse({ success: false, code: error.code, error: error.message }));
      return true;
    }
    const tabId = sender?.tab?.id;
    if (tabId && typeof recordTabStart === 'function') recordTabStart(tabId);
    const request = handleAnalyze(payload);
    inFlightAnalyses.set(key, request);
    request
      .then((data) => {
        if (tabId && typeof recordTabResult === 'function') recordTabResult(tabId, data);
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        if (tabId && typeof recordTabError === 'function' &&
            !['CONSENT_REQUIRED', 'CONSENT_UNAVAILABLE', 'CONSENT_WITHDRAWN'].includes(error.code)) {
          recordTabError(tabId, error.message);
        }
        sendResponse({ success: false, code: error.code, error: error.message || 'Analysis failed' });
      })
      .finally(() => inFlightAnalyses.delete(key));
    return true;
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      chrome.storage.session.remove('tab_' + tabId).catch(() => {});
      if (typeof resetTabAction === 'function') resetTabAction(tabId).catch(() => {});
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.session.remove('tab_' + tabId).catch(() => {});
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    CACHE_TTL_MS,
    MAX_RESPONSE_BYTES,
    BACKEND_URL,
    cleanHtml,
    isBlockedAddress,
    readResponseText,
    fetchDocument,
    handleAnalyze,
    analysisKey,
    updateConsent,
  };
}
