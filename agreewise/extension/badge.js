// badge.js - Shadow DOM badge + popover UI. Loaded before content.js.
/* global chrome */
'use strict';

// Escape any untrusted text before inserting into innerHTML
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Build a Chrome text-fragment URL so the browser highlights the quote.
 * Pure function – also exported for test_link.js via module trick at bottom.
 */
function buildQuoteLink(rawUrl, quote) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let proto;
  try { proto = new URL(rawUrl).protocol; } catch (_) { return null; }
  if (proto !== 'http:' && proto !== 'https:') return null;

  // Strip existing hash
  const baseUrl = rawUrl.split('#')[0];
  if (!quote || typeof quote !== 'string') return baseUrl;

  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return baseUrl;

  const snippet = words.slice(0, 8).join(' ');
  const encoded = encodeURIComponent(snippet)
    .replace(/-/g, '%2D')
    .replace(/,/g, '%2C');

  return `${baseUrl}#:~:text=${encoded}`;
}

function createBadge() {
  const wrapper = document.createElement('span');
  wrapper.style.cssText = 'position:relative;display:inline-block;margin-left:8px;vertical-align:middle;';
  const shadow = wrapper.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .badge { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #fff; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.3); background: #888; font-family: sans-serif; user-select: none; }
    .popover { position: absolute; top: 28px; left: 0; width: 300px; max-width: 90vw; background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 2147483647; font-family: Arial, sans-serif; font-size: 12px; color: #333; line-height: 1.4; }
    .popover.hidden { display: none; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-weight: 600; }
    .close-btn { cursor: pointer; font-size: 16px; color: #888; line-height: 1; padding: 0 2px; }
    .tabs { display: flex; gap: 6px; margin: 8px 0; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    .tab { cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #666; }
    .tab.active { background: #e0f2fe; color: #0369a1; font-weight: bold; }
    .flags { max-height: 180px; overflow-y: auto; margin-bottom: 8px; }
    .flag-item { margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #f0f0f0; }
    .severity-chip { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: bold; color: #fff; margin-right: 4px; background: #888; }
    .severity-HIGH { background: #ef4444; } .severity-MEDIUM { background: #f59e0b; } .severity-LOW { background: #3b82f6; }
    .quote { font-style: italic; color: #555; margin: 3px 0 0; font-size: 11px; }
    .view-link { display: inline-block; margin-top: 3px; font-size: 10px; color: #0369a1; text-decoration: none; }
    .view-link:hover { text-decoration: underline; }
    .notice { font-size: 11px; color: #b45309; background: #fef3c7; padding: 4px 6px; border-radius: 4px; margin: 6px 0; }
    .disc { font-size: 10px; color: #888; margin: 6px 0 0; text-align: center; }
  `;
  shadow.appendChild(style);

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = '...';
  shadow.appendChild(badge);

  const popover = document.createElement('div');
  popover.className = 'popover hidden';
  shadow.appendChild(popover);

  function flagHtml(f) {
    const link = buildQuoteLink(f.source, f.quote);
    const viewHtml = link
      ? `<a class="view-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View original</a>`
      : '';
    return `<div class="flag-item">
      <span class="severity-chip severity-${esc(f.severity)}">${esc(f.severity)}</span><strong>${esc(f.title)}</strong>
      ${f.quote ? `<div class="quote">"${esc(f.quote)}"</div>` : ''}
      ${viewHtml}
    </div>`;
  }

  function fillPopover(data) {
    const { summary, flags = [], documents = [], disclaimer, grade } = data;
    const failed = documents.filter(d => !d.analyzed);
    const noticeHtml = (failed.length && ['C', 'D', 'F'].includes(grade))
      ? `<div class="notice">Some documents could not be read: ${failed.map(d => `${esc(d.type)} (${esc(d.reason || 'unreadable')})`).join(', ')}</div>` : '';
    const docListHtml = (grade === '?' && failed.length)
      ? `<div class="notice">${failed.map(d => `<strong>${esc(d.type)}:</strong> ${esc(d.reason || 'Could not be read')}`).join('<br>')}</div>` : '';

    popover.innerHTML = `
      <div class="header"><span>AgreeWise Summary</span><span class="close-btn">&times;</span></div>
      <p style="margin:0 0 6px;">${esc(summary || 'Analysis complete.')}</p>
      ${noticeHtml}${docListHtml}
      <div class="tabs"><span class="tab active" data-tab="ALL">All</span><span class="tab" data-tab="TERMS">Terms</span><span class="tab" data-tab="PRIVACY">Privacy</span></div>
      <div class="flags"></div>
      <div class="disc">${esc(disclaimer || 'AI summary, not legal advice.')}</div>`;

    popover.querySelector('.close-btn').onclick = () => popover.classList.add('hidden');
    const flagsEl = popover.querySelector('.flags');
    const render = (type) => {
      const filtered = flags.filter(f => !type || type === 'ALL' || f.type === type);
      flagsEl.innerHTML = filtered.length ? filtered.map(flagHtml).join('') : '<div style="color:#888;">No flagged clauses.</div>';
    };
    render('ALL');
    popover.querySelectorAll('.tab').forEach(t => t.onclick = () => {
      popover.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      render(t.dataset.tab);
    });
  }

  badge.addEventListener('click', (e) => { e.stopPropagation(); popover.classList.remove('hidden'); });
  document.addEventListener('click', (e) => { if (!e.composedPath().includes(wrapper)) popover.classList.add('hidden'); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') popover.classList.add('hidden'); });

  return {
    element: wrapper,
    setGrade: (g) => { badge.style.background = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444', '?': '#888' }[g] || '#888'; badge.textContent = g; },
    setHover: (t) => { badge.title = t; },
    fillPopover,
    popover,
  };
}

// Allow node to test buildQuoteLink without the browser globals
if (typeof module !== 'undefined') module.exports = { buildQuoteLink, createBadge };
