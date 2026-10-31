// background.js - Consent-gated policy fetching, caching and backend bridge.
/* global importScripts, chrome, recordTabStart, recordTabResult, recordTabError, resetTabAction */
'use strict';

if (typeof importScripts === 'function') importScripts('icon.js', 'consent.js');

const CONSENT = typeof AgreeWiseConsent !== 'undefined'
  ? AgreeWiseConsent
  : (typeof require === 'function' ? require('./consent') : null);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const API_BASE_URL = 'https://agree-wise-7hjb.onrender.com';
const BACKEND_URL = `${API_BASE_URL}/analyze`;
const pendingControllers = new Set();
const analysisRequests = new Map();

function hashKey(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function analysisCacheKey(site, documents) {
  return 'analysis_' + hashKey(JSON.stringify({
    site: site || 'unknown',
    documents: documents.map(({ type, url, text, pdfBase64 }) => ({ type, url, text, pdfBase64 }))
      .sort((a, b) => `${a.type}:${a.url}`.localeCompare(`${b.type}:${b.url}`)),
  }));
}

function requestKey(site, documents) {
  return JSON.stringify({
    site: site || 'unknown',
    documents: documents.map(({ type, url }) => ({ type, url }))
      .sort((a, b) => `${a.type}:${a.url}`.localeCompare(`${b.type}:${b.url}`)),
  });
}

function cleanHtml(html) {
  if (!html || typeof html !== 'string') {
    return { text: '', originalLength: 0, truncated: false };
  }

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
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  if (parsed.username || parsed.password) return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  if (/^(0|10|127|169\.254|192\.0\.0|192\.168)\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || /^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return Boolean(mapped && isBlockedAddress(`http://${mapped[1]}`));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
    const key = 'doc_' + url;
    const res = await chrome.storage.local.get(key);
    const item = res[key];
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

async function getCachedAnalysis(key) {
  try {
    const res = await chrome.storage.local.get(key);
    const item = res[key];
    if (item && item.timestamp && Date.now() - item.timestamp < CACHE_TTL_MS && item.data) return item.data;
  } catch (_) {}
  return null;
}

async function setCachedAnalysis(key, data) {
  try {
    await chrome.storage.local.set({ [key]: { data, timestamp: Date.now() } });
  } catch (_) {}
}

function isCacheableAnalysis(data) {
  return Boolean(data && typeof data === 'object' &&
    Array.isArray(data.documents) && data.documents.some(doc => doc && doc.analyzed));
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
    const isPdf = /\.pdf(?:$|[?#])/i.test(response.url || url) || contentType.includes('application/pdf');
    if (isPdf) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_PDF_BYTES) throw new Error('PDF is larger than the 8 MB limit');
      return { type, url, pdfBase64: bytesToBase64(new Uint8Array(buffer)), originalLength: 0, truncated: false, isPdf: true };
    }
    if (contentType && !/(text\/html|text\/plain|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error('Unsupported policy content type');
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

function formatRetryTime(retryAfter) {
  if (!retryAfter) return '';
  const numeric = Number(retryAfter);
  if (!Number.isFinite(numeric)) return ` Retry after ${retryAfter}.`;
  const seconds = numeric > 1000000000
    ? Math.max(0, Math.ceil(numeric - Date.now() / 1000))
    : Math.max(0, Math.ceil(numeric));
  if (seconds < 60) return ` Retry after ${seconds} second${seconds === 1 ? '' : 's'}.`;
  const minutes = Math.ceil(seconds / 60);
  return ` Retry after ${minutes} minute${minutes === 1 ? '' : 's'}.`;
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

async function requestAnalysis(site, processedDocs, signal) {
  const initialConsent = await CONSENT.getConsentState();
  if (!CONSENT.hasValidConsent(initialConsent)) throw consentError(initialConsent);
  const installId = await getInstallId();
  let res;
  try {
    res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
      body: JSON.stringify({ site, documents: processedDocs }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError') throw withdrawnError();
    const detail = err && err.message ? `: ${err.message}` : '';
    throw new Error(`Unable to reach AgreeWise API at ${API_BASE_URL}${detail}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429) {
      const retryAfter = res.headers?.get('Retry-After') || res.headers?.get('RateLimit-Reset');
      const detail = errText ? ` ${errText.slice(0, 160)}` : '';
      throw new Error(`AgreeWise rate limit reached.${formatRetryTime(retryAfter)}${detail}`);
    }
    throw new Error(`AgreeWise API returned HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }
  try {
    return await res.json();
  } catch (err) {
    const detail = err && err.message ? `: ${err.message}` : '';
    throw new Error(`AgreeWise API returned invalid JSON (HTTP ${res.status})${detail}`);
  }
}

async function analyzePayload(payload, controller) {
  const { site, documents = [] } = payload;
  const processedDocs = [];
  for (const document of documents) {
    const currentConsent = await CONSENT.getConsentState();
    if (!CONSENT.hasValidConsent(currentConsent)) throw withdrawnError();
    processedDocs.push(await fetchDocument(document, controller.signal));
  }
  const finalConsent = await CONSENT.getConsentState();
  if (!CONSENT.hasValidConsent(finalConsent)) throw withdrawnError();
  const cacheKey = analysisCacheKey(site, processedDocs);
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return cached;
  const data = await requestAnalysis(site, processedDocs, controller.signal);
  if (isCacheableAnalysis(data)) await setCachedAnalysis(cacheKey, data);
  return data;
}

async function handleAnalyze(payload) {
  const site = payload?.site;
  const documents = Array.isArray(payload?.documents) ? payload.documents : [];
  const key = requestKey(site, documents);
  if (analysisRequests.has(key)) return analysisRequests.get(key);

  const controller = new AbortController();
  pendingControllers.add(controller);
  const request = (async () => {
    const initialConsent = await CONSENT.getConsentState();
    if (!CONSENT.hasValidConsent(initialConsent)) throw consentError(initialConsent);
    return analyzePayload({ site, documents }, controller);
  })()
    .finally(() => {
      pendingControllers.delete(controller);
      analysisRequests.delete(key);
    });
  analysisRequests.set(key, request);
  return request;
}

async function clearLocalAnalysisState() {
  await CONSENT.clearPolicyCache();
  const all = await chrome.storage.local.get(null).catch(() => ({}));
  const analysisKeys = Object.keys(all || {}).filter((key) => key.startsWith('analysis_'));
  if (analysisKeys.length) await chrome.storage.local.remove(analysisKeys).catch(() => {});
  if (chrome.storage?.session) {
    const session = await chrome.storage.session.get(null).catch(() => ({}));
    const tabKeys = Object.keys(session || {}).filter((key) => key.startsWith('tab_'));
    if (tabKeys.length) await chrome.storage.session.remove(tabKeys).catch(() => {});
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
    const tabId = sender?.tab?.id;
    if (tabId && typeof recordTabStart === 'function') recordTabStart(tabId);
    handleAnalyze(payload)
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
      });
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
    MAX_PDF_BYTES,
    BACKEND_URL,
    cleanHtml,
    isBlockedAddress,
    readResponseText,
    fetchDocument,
    analysisCacheKey,
    formatRetryTime,
    handleAnalyze,
    isCacheableAnalysis,
    requestKey,
    updateConsent,
  };
}
