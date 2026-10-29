// background.js - Policy fetching, text cleaning, storage cache and backend bridge
/* global importScripts, chrome, recordTabStart, recordTabResult, recordTabError, resetTabAction */
'use strict';
if (typeof importScripts === 'function') importScripts('icon.js');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const API_BASE_URL = 'https://agree-wise-7hjb.onrender.com';
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
    documents: documents.map(({ type, url, text }) => ({ type, url, text })).sort((a, b) =>
      `${a.type}:${a.url}`.localeCompare(`${b.type}:${b.url}`)),
  }));
}

function requestKey(site, documents) {
  return JSON.stringify({
    site: site || 'unknown',
    documents: documents.map(({ type, url }) => ({ type, url })).sort((a, b) =>
      `${a.type}:${a.url}`.localeCompare(`${b.type}:${b.url}`)),
  });
}

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
  const text = truncated ? cleaned.slice(0, 60000) : cleaned;
  return { text, originalLength, truncated };
}

function isBlockedAddress(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return true; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) || /^169\.254\./.test(host)) return true;
  return host === '::1' || host === '0:0:0:0:0:0:0:1';
}

async function getInstallId() {
  const res = await chrome.storage.local.get('installId');
  if (res.installId) return res.installId;
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
    if (item && item.timestamp && (Date.now() - item.timestamp < CACHE_TTL_MS)) {
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
    if (item && item.timestamp && Date.now() - item.timestamp < CACHE_TTL_MS && item.data) {
      return item.data;
    }
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

async function fetchDocument(doc) {
  const { type, url } = doc;
  if (isBlockedAddress(url)) return { type, url, text: null, originalLength: 0, truncated: false, error: 'Blocked address' };

  try {
    const cached = await getCachedDoc(url);
    if (cached !== null) return { type, url, ...cached };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const cleaned = cleanHtml(html);
    if (cleaned.text) await setCachedDoc(url, cleaned);
    return { type, url, ...cleaned };
  } catch (err) {
    return { type, url, text: null, originalLength: 0, truncated: false, error: err.message || "Couldn't fetch the page" };
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

async function requestAnalysis(site, processedDocs) {
  const installId = await getInstallId();
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
      body: JSON.stringify({ site, documents: processedDocs }),
    });
  } catch (err) {
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

async function analyzePayload(payload) {
  const { site, documents = [] } = payload;
  const processedDocs = await Promise.all(documents.map(fetchDocument));
  const cacheKey = analysisCacheKey(site, processedDocs);
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return cached;

  const data = await requestAnalysis(site, processedDocs);
  if (isCacheableAnalysis(data)) await setCachedAnalysis(cacheKey, data);
  return data;
}

async function handleAnalyze(payload) {
  const site = payload.site;
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const key = requestKey(site, documents);
  if (analysisRequests.has(key)) return analysisRequests.get(key);
  const request = analyzePayload({ site, documents }).finally(() => analysisRequests.delete(key));
  analysisRequests.set(key, request);
  return request;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'ANALYZE' && message.type !== 'analyze') return false;
  const tabId = sender?.tab?.id;
  if (tabId) recordTabStart(tabId);

  handleAnalyze(message.payload || message)
    .then(data => {
      if (tabId) recordTabResult(tabId, data);
      sendResponse({ success: true, data });
    })
    .catch(err => {
      const errMsg = err.message || 'AgreeWise server is not running';
      if (tabId) recordTabError(tabId, errMsg);
      sendResponse({ success: false, error: errMsg });
    });
  return true;
});

if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.storage.session.remove('tab_' + tabId).catch(() => {});
    resetTabAction(tabId).catch(() => {});
  }
});

if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('tab_' + tabId).catch(() => {});
});

if (typeof module !== 'undefined') {
  module.exports = {
    analysisCacheKey,
    formatRetryTime,
    handleAnalyze,
    isCacheableAnalysis,
    requestKey,
  };
}
