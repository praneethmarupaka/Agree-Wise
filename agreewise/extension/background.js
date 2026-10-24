// background.js - Policy fetching, text cleaning, storage cache and backend bridge
/* global importScripts, chrome, recordTabStart, recordTabResult, recordTabError, resetTabAction */
'use strict';
importScripts('icon.js');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cleanHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60000);
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
      return item.text;
    }
  } catch (e) {}
  return null;
}

async function setCachedDoc(url, text) {
  try {
    const key = 'doc_' + url;
    await chrome.storage.local.set({ [key]: { text, timestamp: Date.now() } });
  } catch (e) {}
}

async function fetchDocument(doc) {
  const { type, url } = doc;
  try {
    const cachedText = await getCachedDoc(url);
    if (cachedText !== null) return { type, url, text: cachedText };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const text = cleanHtml(html);
    if (text) await setCachedDoc(url, text);
    return { type, url, text };
  } catch (err) {
    return { type, url, text: null, error: err.message || "Couldn't fetch the page" };
  }
}

async function handleAnalyze(payload) {
  const { site, documents = [] } = payload;
  const processedDocs = await Promise.all(documents.map(fetchDocument));
  const installId = await getInstallId();

  let res;
  try {
    res = await fetch('http://localhost:3001/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
      body: JSON.stringify({ site, documents: processedDocs }),
    });
  } catch (err) {
    throw new Error('AgreeWise server is not running');
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Server returned ${res.status}: ${errText.slice(0, 100)}`);
  }
  return await res.json();
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
