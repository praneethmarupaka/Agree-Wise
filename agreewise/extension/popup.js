// popup.js - Detailed analysis popup with tabs, safe DOM creation, and quote links
/* global chrome */
'use strict';

const GRADE_COLORS = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444', '?': '#888888' };

function buildQuoteLink(rawUrl, quote) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const proto = new URL(rawUrl).protocol;
    if (proto !== 'http:' && proto !== 'https:') return null;
  } catch (e) { return null; }
  const base = rawUrl.split('#')[0];
  if (!quote || typeof quote !== 'string') return base;
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return base;
  const enc = encodeURIComponent(words.slice(0, 8).join(' ')).replace(/-/g, '%2D').replace(/,/g, '%2C');
  return `${base}#:~:text=${enc}`;
}

function el(tag, cls, text) {
  const elem = document.createElement(tag);
  if (cls) elem.className = cls;
  if (text != null) elem.textContent = text;
  return elem;
}

function showEmpty(text) {
  const content = document.getElementById('content');
  while (content.firstChild) content.removeChild(content.firstChild);
  content.appendChild(el('div', 'empty-state', text));
}

function renderFlag(f) {
  const item = el('div', 'flag-item');
  item.appendChild(el('span', `chip severity-${f.severity || 'LOW'}`, f.severity || 'INFO'));
  item.appendChild(el('span', 'flag-title', f.title || ''));
  if (f.quote) item.appendChild(el('div', 'flag-quote', `"${f.quote}"`));

  const link = buildQuoteLink(f.source, f.quote);
  if (link && (link.startsWith('http://') || link.startsWith('https://'))) {
    const a = el('a', 'view-link', 'View original');
    a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    item.appendChild(a);
  }
  return item;
}

function renderDetails(data) {
  const content = document.getElementById('content');
  while (content.firstChild) content.removeChild(content.firstChild);

  const results = data.results || [];
  const primary = results.find(r => r.grade === data.worstGrade) || results[0] || {};
  const grade = data.worstGrade || primary.grade || '?';

  // Grade card
  const card = el('div', 'grade-card');
  const circle = el('div', 'grade-circle', grade);
  circle.style.backgroundColor = GRADE_COLORS[grade] || '#888888';
  card.appendChild(circle);

  const info = el('div', 'grade-info');
  info.appendChild(el('p', 'summary-text', primary.summary || 'Analysis complete.'));
  if (primary.coverage != null) {
    info.appendChild(el('p', 'coverage-text', `Analyzed ${Math.round(primary.coverage * 100)}% of the policy text`));
  }
  card.appendChild(info);
  content.appendChild(card);

  // Failed document notice
  const failed = results.flatMap(r => r.documents || []).filter(d => !d.analyzed);
  if (failed.length) {
    const msg = `Some documents could not be read: ${failed.map(d => `${d.type || 'Doc'} (${d.reason || 'unreadable'})`).join(', ')}`;
    content.appendChild(el('div', 'notice-box', msg));
  }

  // Tabs and flags list
  const allFlags = results.flatMap(r => r.flags || []);
  const tabsDiv = el('div', 'tabs');
  const flagsContainer = el('div', 'flags-container');

  function filterFlags(type) {
    while (flagsContainer.firstChild) flagsContainer.removeChild(flagsContainer.firstChild);
    const filtered = allFlags.filter(f => !type || type === 'ALL' || f.type === type);
    if (!filtered.length) {
      flagsContainer.appendChild(el('div', 'empty-state', 'No flagged clauses.'));
    } else {
      filtered.forEach(f => flagsContainer.appendChild(renderFlag(f)));
    }
  }

  ['ALL', 'TERMS', 'PRIVACY'].forEach((k, i) => {
    const tab = el('span', `tab ${i === 0 ? 'active' : ''}`, k === 'ALL' ? 'All' : (k === 'TERMS' ? 'Terms' : 'Privacy'));
    tab.onclick = () => {
      tabsDiv.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterFlags(k);
    };
    tabsDiv.appendChild(tab);
  });

  content.appendChild(tabsDiv);
  content.appendChild(flagsContainer);
  filterFlags('ALL');
}

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  if (!tab || !tab.id) return showEmpty('No agreement found on this page yet');
  const res = await chrome.storage.session.get('tab_' + tab.id).catch(() => ({}));
  const data = res['tab_' + tab.id];
  if (!data || (!data.results?.length && data.status !== 'analyzing')) {
    showEmpty('No agreement found on this page yet');
  } else if (data.status === 'analyzing' && !data.results?.length) {
    showEmpty('Analyzing...');
  } else {
    renderDetails(data);
  }
});
