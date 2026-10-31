// popup.js - Consent management and analysis results.
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

function showView(name) {
  const consent = document.getElementById('consent-view');
  const analysis = document.getElementById('analysis-view');
  consent.hidden = name !== 'consent';
  analysis.hidden = name !== 'analysis';
  return name === 'consent' ? consent : analysis;
}

function renderConsent(state) {
  const content = showView('consent');
  while (content.firstChild) content.removeChild(content.firstChild);
  const card = el('div', 'consent-card');
  card.appendChild(el('h2', '', 'Enable AgreeWise AI analysis'));
  card.appendChild(el('p', '', 'AgreeWise detects Terms & Conditions and Privacy Policy links on websites you visit.'));
  const list = el('ul');
  [
    'Relevant policy text may be extracted from those pages.',
    'The extracted text is sent to the AgreeWise backend, which uses Google Gemini AI.',
    'The analysis summarizes important terms, highlights potential risks, and explains privacy concerns.',
    'You can withdraw consent at any time. Without consent, policy content is not sent for AI analysis.',
  ].forEach((item) => list.appendChild(el('li', '', item)));
  card.appendChild(list);
  if (state.status === 'unavailable') {
    card.appendChild(el('p', 'notice-box', 'Consent status could not be read. Analysis is disabled until storage is available.'));
  } else if (state.status === 'denied') {
    card.appendChild(el('p', 'notice-box', 'AI analysis is disabled. You can enable it again below.'));
  }
  const actions = el('div', 'consent-actions');
  const allow = el('button', 'allow-btn', 'Allow & Enable AI Analysis');
  const deny = el('button', 'deny-btn', "Don't Allow");
  allow.onclick = () => updateConsent('granted');
  deny.onclick = () => updateConsent('denied');
  actions.append(allow, deny);
  card.appendChild(actions);
  content.appendChild(card);
}

async function updateConsent(status) {
  const content = showView('consent');
  content.textContent = 'Saving your preference...';
  const response = await chrome.runtime.sendMessage({ type: 'SET_CONSENT', status }).catch((error) => ({ success: false, error: error.message }));
  if (!response?.success) {
    renderConsent({ status: 'unavailable' });
    return;
  }
  if (status === 'granted') renderAnalysis();
  else renderConsent(response.state);
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

async function renderAnalysis() {
  const content = showView('analysis');
  while (content.firstChild) content.removeChild(content.firstChild);
  const status = el('div', 'consent-status', 'AI analysis is enabled. Policy content may be sent to AgreeWise and Google Gemini for analysis.');
  content.appendChild(status);
  const settings = el('div', 'settings');
  const withdraw = el('button', 'withdraw-btn', 'Withdraw AI analysis consent');
  withdraw.onclick = () => updateConsent('denied');
  settings.appendChild(withdraw);
  content.appendChild(settings);

  const [tabs] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.id) {
    content.appendChild(el('div', 'empty-state', 'No agreement found on this page yet'));
    return;
  }
  const res = await chrome.storage.session.get('tab_' + tabs.id).catch(() => ({}));
  const data = res['tab_' + tabs.id];
  if (!data || (!data.results?.length && data.status !== 'analyzing')) {
    content.appendChild(el('div', 'empty-state', 'No agreement found on this page yet'));
    return;
  }
  renderDetails(data, content);
}

function renderDetails(data, content) {
  const results = data.results || [];
  const primary = results.find(r => r.grade === data.worstGrade) || results[0] || {};
  const grade = data.worstGrade || primary.grade || '?';
  const card = el('div', 'grade-card');
  const circle = el('div', 'grade-circle', grade);
  circle.style.backgroundColor = GRADE_COLORS[grade] || '#888888';
  card.appendChild(circle);
  const info = el('div', 'grade-info');
  info.appendChild(el('p', 'summary-text', primary.summary || 'Analysis complete.'));
  if (primary.coverage != null) info.appendChild(el('p', 'coverage-text', `Analyzed ${Math.round(primary.coverage * 100)}% of the policy text`));
  card.appendChild(info);
  content.appendChild(card);

  const failed = results.flatMap(r => r.documents || []).filter(d => !d.analyzed);
  if (failed.length) content.appendChild(el('div', 'notice-box', `Some documents could not be read: ${failed.map(d => `${d.type || 'Doc'} (${d.reason || 'unreadable'})`).join(', ')}`));

  const allFlags = results.flatMap(r => r.flags || []);
  const tabsDiv = el('div', 'tabs');
  const flagsContainer = el('div', 'flags-container');
  function filterFlags(type) {
    while (flagsContainer.firstChild) flagsContainer.removeChild(flagsContainer.firstChild);
    const filtered = allFlags.filter(f => !type || type === 'ALL' || f.type === type);
    if (!filtered.length) flagsContainer.appendChild(el('div', 'empty-state', 'No flagged clauses.'));
    else filtered.forEach(f => flagsContainer.appendChild(renderFlag(f)));
  }
  ['ALL', 'TERMS', 'PRIVACY'].forEach((key, index) => {
    const tab = el('span', `tab ${index === 0 ? 'active' : ''}`, key === 'ALL' ? 'All' : key === 'TERMS' ? 'Terms' : 'Privacy');
    tab.onclick = () => {
      tabsDiv.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterFlags(key);
    };
    tabsDiv.appendChild(tab);
  });
  content.append(tabsDiv, flagsContainer);
  filterFlags('ALL');
}

async function initialize() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_CONSENT' }).catch(() => ({ success: false }));
  if (!response?.success || !AgreeWiseConsent.hasValidConsent(response.state)) {
    renderConsent(response?.state || { status: 'unavailable' });
    return;
  }
  await renderAnalysis();
}

initialize();

if (typeof module !== 'undefined') module.exports = { buildQuoteLink, renderConsent };
