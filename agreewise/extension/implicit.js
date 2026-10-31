// implicit.js - Implicit consent detection. Loaded after badge.js and content.js.
/* global createBadge, chrome */
(() => {
  // Skip policy pages themselves — no badge needed there
  if (/\/(terms|privacy|tos|legal|policy)(\/|$)/i.test(location.pathname)) return;

  const AGREE_RGX = [
    /\b(by|upon)\b[^.]{0,100}\b(click|clicking|continu\w*|sign\w* up|creat\w*|regist\w*|submit\w*|join\w*|log\w* in)\b[^.]{0,160}\b(agree|accept|consent|acknowledge)/i,
    /\b(you agree to|you accept|you acknowledge|read and agree|have read and agree)\b/i,
  ];
  const LINK_KEYS = { TERMS: /terms|agreement/i, PRIVACY: /privacy|policy/i };
  const SKIP_TAGS = new Set(['BODY', 'MAIN', 'FORM', 'HTML', 'NAV', 'HEADER', 'FOOTER', 'SECTION', 'ARTICLE']);
  const IMPLICIT_ATTR = 'data-agreewise-implicit';
  let implicitQueue = Promise.resolve();
  const pending = new Set();

  function collectLinks(root) {
    const docs = [];
    const seen = new Set();
    root.querySelectorAll('a[href]').forEach(a => {
      const txt = (a.innerText || a.href).trim();
      for (const [type, rg] of Object.entries(LINK_KEYS)) {
        if (rg.test(txt) && !seen.has(a.href)) {
          seen.add(a.href);
          docs.push({ type, url: a.href });
          break;
        }
      }
    });
    return docs;
  }

  function matchesAgreement(text) {
    return AGREE_RGX.some(r => r.test(text));
  }

  function findImplicitElements() {
    const TAGS = 'p, div, span, small, label';
    const candidates = [];
    document.querySelectorAll(TAGS).forEach(el => {
      if (SKIP_TAGS.has(el.tagName)) return;
      if (el.hasAttribute(IMPLICIT_ATTR)) return;
      if (el.querySelector('[data-agreewise-processed], [data-agreewise-implicit]')) return;
      const text = el.innerText || '';
      if (text.length > 600 || text.length < 20) return;
      if (!matchesAgreement(text)) return;
      const docs = collectLinks(el);
      if (!docs.length) return;
      // Skip if already handled by checkbox flow
      const urlKey = docs.map(d => d.url).sort().join('|');
      if (window.__awHandledUrls.has(urlKey)) return;
      candidates.push({ el, docs, urlKey });
    });

    // Prefer deepest elements — remove any candidate that is an ancestor of another
    return candidates.filter(({ el }) =>
      !candidates.some(({ el: other }) => other !== el && el.contains(other))
    );
  }

  function analyseImplicit(el, docs, urlKey) {
    if (pending.has(el)) return Promise.resolve();
    pending.add(el);
    el.setAttribute(IMPLICIT_ATTR, 'true');

    const badgeUI = createBadge();
    badgeUI.setHover('Analyzing legal agreements...');
    // Insert badge inline after the element
    el.parentNode.insertBefore(badgeUI.element, el.nextSibling);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE', payload: { site: location.hostname, documents: docs } },
        (res) => {
          pending.delete(el);
          if (!res || !res.success || !res.data) {
            if (res?.code === 'CONSENT_REQUIRED' || res?.code === 'CONSENT_UNAVAILABLE' || res?.code === 'CONSENT_WITHDRAWN') {
              el.removeAttribute(IMPLICIT_ATTR);
              badgeUI.element.remove();
              return resolve();
            }
            const err = res?.error || 'AgreeWise server is not running';
            badgeUI.setGrade('?');
            badgeUI.setHover(err);
            badgeUI.fillPopover({ grade: '?', summary: err, documents: docs.map(d => ({ ...d, analyzed: false, reason: err })) });
            return resolve();
          }
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

  function scanImplicit() {
    findImplicitElements().forEach(({ el, docs, urlKey }) => {
      implicitQueue = implicitQueue.then(() => analyseImplicit(el, docs, urlKey)).catch(() => {});
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONSENT_CHANGED') scanImplicit();
  });

  // Debounce MutationObserver to avoid hammering on SPA navigation
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanImplicit, 500);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Initial scan: delayed to let the page (and content.js) settle first
  setTimeout(scanImplicit, 1500);
})();
