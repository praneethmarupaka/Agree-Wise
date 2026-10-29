// background.js - Policy fetching, text cleaning, storage cache and backend bridge
/* global importScripts, chrome, recordTabStart, recordTabResult, recordTabError, resetTabAction */
'use strict';
importScripts('icon.js');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const API_BASE_URL = 'https://agree-wise-7hjb.onrender.com';

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

async function handleAnalyze(payload) {
  const { site, documents = [] } = payload;
  const processedDocs = await Promise.all(documents.map(fetchDocument));
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
    throw new Error(`AgreeWise API returned HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }

  try {
    return await res.json();
  } catch (err) {
    const detail = err && err.message ? `: ${err.message}` : '';
    throw new Error(`AgreeWise API returned invalid JSON (HTTP ${res.status})${detail}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.storage.session.remove('tab_' + tabId).catch(() => {});
    resetTabAction(tabId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('tab_' + tabId).catch(() => {});
});
