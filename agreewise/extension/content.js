// content.js - Queue-based checkbox detection. Depends on badge.js loaded first.
/* global createBadge, chrome, CSS */
(() => {
  const KEYWORDS = [/agree/i, /terms/i, /privacy/i, /policy/i];
  const LINK_KEYS = { TERMS: /terms|agreement/i, PRIVACY: /privacy|policy/i };
  const PROCESSED = 'data-agreewise-processed';
  let queue = Promise.resolve();
  const pending = new Set();

  function getLabel(cb) {
    if (cb.id) {
      const el = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
      if (el) return el.innerText;
    }
    const associatedLabel = cb.closest('label');
    const container = associatedLabel || cb.parentElement;
    return [associatedLabel?.innerText, container?.innerText].filter(Boolean).join(' ').trim();
  }

  function collectLinks(root) {
    const docs = [];
    const seen = new Set();
    root.querySelectorAll('a[href]').forEach(a => {
      const url = a.href;
      const text = (a.innerText || a.textContent || '').trim();
      const haystack = `${text} ${url}`;
      for (const [type, rg] of Object.entries(LINK_KEYS)) {
        if (rg.test(haystack) && !seen.has(url)) {
          seen.add(url);
          docs.push({ type, url });
          break;
        }
      }
    });
    return docs;
  }

  // Search progressively wider ancestors, while keeping discovery tied to this consent checkbox.
  function getLinks(cb) {
    const label = (cb.id && document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)) || cb.closest('label');
    let node = label || cb.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      const docs = collectLinks(node);
      if (docs.length) return docs;
      if (node.tagName === 'FORM') break;
      node = node.parentElement;
    }
    return [];
  }

  function insertBadge(cb, badgeEl) {
    const label = (cb.id && document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)) || cb.closest('label');
    if (label) label.parentNode.insertBefore(badgeEl, label.nextSibling);
    else cb.parentNode.insertBefore(badgeEl, cb.nextSibling);
  }

  function analyseCheckbox(cb) {
    if (cb.hasAttribute(PROCESSED) || pending.has(cb)) return Promise.resolve();
    if (!KEYWORDS.some(r => r.test(getLabel(cb)))) return Promise.resolve();
    const docs = getLinks(cb);
    if (!docs.length) return Promise.resolve();
    const urlKey = docs.map(d => d.url).sort().join('|');
    pending.add(cb);

    const badgeUI = createBadge();
    badgeUI.setHover('Analyzing legal agreements...');
    insertBadge(cb, badgeUI.element);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE', payload: { site: location.hostname, documents: docs } },
        (res) => {
          pending.delete(cb);
          if (!res || !res.success || !res.data) {
            if (res?.code === 'CONSENT_REQUIRED' || res?.code === 'CONSENT_UNAVAILABLE' || res?.code === 'CONSENT_WITHDRAWN') {
              badgeUI.element.remove();
              return resolve();
            }
            const err = res?.error || 'AgreeWise server is not running';
            badgeUI.setGrade('?');
            badgeUI.setHover(err);
            badgeUI.fillPopover({ grade: '?', summary: err, documents: docs.map(d => ({ ...d, analyzed: false, reason: err })) });
            return resolve();
          }
          cb.setAttribute(PROCESSED, 'true');
          window.__awHandledUrls.add(urlKey);
          const data = res.data;
          badgeUI.setGrade(data.grade);
          const covTxt = data.coverage != null ? ` (${Math.round(data.coverage * 100)}% analyzed)` : '';
          badgeUI.setHover(data.grade === '?' ? data.summary : `${data.grade}: ${data.summary}${covTxt}`);
          badgeUI.fillPopover(data);
          if (data.grade === 'D' || data.grade === 'F') badgeUI.popover.classList.remove('hidden');
          resolve();
        }
      );
    });
  }

  function scanPage() {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      queue = queue.then(() => analyseCheckbox(cb)).catch(() => {});
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONSENT_CHANGED') scanPage();
  });

  const observer = new MutationObserver(() => scanPage());
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanPage);
  else scanPage();
})();
