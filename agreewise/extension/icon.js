// icon.js - OffscreenCanvas runtime icon generation and action state management
/* global OffscreenCanvas, chrome */
'use strict';

const GRADE_COLORS = {
  A: '#22c55e', B: '#84cc16', C: '#eab308',
  D: '#f97316', F: '#ef4444', '?': '#888888', '...': '#888888',
};
const GRADE_RANKS = { F: 5, D: 4, C: 3, B: 2, A: 1, '?': 0 };
const iconCache = {};

function computeWorstGrade(results = []) {
  if (!results.length) return '?';
  const known = results.map(r => r.grade).filter(g => g && g !== '?');
  if (!known.length) return '?';
  let worst = known[0];
  let worstRank = GRADE_RANKS[worst] || 0;
  for (const g of known) {
    const rank = GRADE_RANKS[g] || 0;
    if (rank > worstRank) { worstRank = rank; worst = g; }
  }
  return worst;
}

function drawRoundedRect(ctx, size, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, size, size, r);
  } else {
    ctx.moveTo(r, 0); ctx.lineTo(size - r, 0); ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r); ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size); ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.closePath();
  }
}

function createIconImageData(grade, size) {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const color = GRADE_COLORS[grade] || '#888888';

  drawRoundedRect(ctx, size, Math.round(size * 0.22));
  ctx.fillStyle = color;
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = Math.max(1, Math.round(size * 0.06));
  ctx.beginPath();
  const s = size;
  ctx.moveTo(s * 0.24, s * 0.18); ctx.lineTo(s * 0.76, s * 0.18); ctx.lineTo(s * 0.76, s * 0.52);
  ctx.quadraticCurveTo(s * 0.76, s * 0.82, s * 0.5, s * 0.90);
  ctx.quadraticCurveTo(s * 0.24, s * 0.82, s * 0.24, s * 0.52);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = grade === '...' ? Math.round(size * 0.45) : Math.round(size * 0.62);
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.fillText(grade, size / 2, size / 2 + (size >= 32 ? 1 : 0));
  return ctx.getImageData(0, 0, size, size);
}

function getGradeIconData(grade) {
  const g = GRADE_COLORS[grade] ? grade : '?';
  if (!iconCache[g]) {
    iconCache[g] = { 16: createIconImageData(g, 16), 32: createIconImageData(g, 32), 48: createIconImageData(g, 48) };
  }
  return iconCache[g];
}

async function setTabGradeAction(tabId, grade) {
  if (!tabId || typeof chrome === 'undefined' || !chrome.action) return;
  const color = GRADE_COLORS[grade] || '#888888';
  try {
    await chrome.action.setIcon({ tabId, imageData: getGradeIconData(grade) });
    await chrome.action.setBadgeText({ tabId, text: grade });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (e) {}
}

async function resetTabAction(tabId) {
  if (!tabId || typeof chrome === 'undefined' || !chrome.action) return;
  try {
    await chrome.action.setIcon({ tabId, path: { 16: 'icon16.png', 48: 'icon48.png', 128: 'icon128.png' } });
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch (e) {}
}

async function recordTabStart(tabId) {
  if (!tabId || !chrome.storage?.session) return;
  await setTabGradeAction(tabId, '...');
  const key = 'tab_' + tabId;
  const res = await chrome.storage.session.get(key).catch(() => ({}));
  const prev = res[key]?.results || [];
  await chrome.storage.session.set({ [key]: { status: 'analyzing', results: prev } }).catch(() => {});
}

async function recordTabResult(tabId, data) {
  if (!tabId || !chrome.storage?.session) return;
  const key = 'tab_' + tabId;
  const res = await chrome.storage.session.get(key).catch(() => ({}));
  const prev = res[key]?.results || [];
  const results = [...prev, data];
  const worstGrade = computeWorstGrade(results);
  await chrome.storage.session.set({ [key]: { status: 'done', results, worstGrade } }).catch(() => {});
  await setTabGradeAction(tabId, worstGrade);
}

async function recordTabError(tabId, errorMsg) {
  if (!tabId || !chrome.storage?.session) return;
  const key = 'tab_' + tabId;
  const res = await chrome.storage.session.get(key).catch(() => ({}));
  const prev = res[key]?.results || [];
  if (!prev.length) {
    await chrome.storage.session.set({ [key]: { status: 'error', error: errorMsg, results: [], worstGrade: '?' } }).catch(() => {});
    await setTabGradeAction(tabId, '?');
  } else {
    await setTabGradeAction(tabId, computeWorstGrade(prev));
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    GRADE_COLORS, GRADE_RANKS, computeWorstGrade,
    getGradeIconData, setTabGradeAction, resetTabAction,
    recordTabStart, recordTabResult, recordTabError,
  };
}
