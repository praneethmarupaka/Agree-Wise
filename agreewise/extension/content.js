// content.js - Queue-based checkbox detection. Depends on badge.js loaded first.
/* global createBadge, chrome, CSS */
(() => {
  const KEYWORDS = [/agree/i, /terms/i, /privacy/i, /policy/i];
  const LINK_KEYS = { TERMS: /terms|agreement/i, PRIVACY: /privacy|policy/i };
  const PROCESSED = 'data-agreewise-processed';
  let queue = Promise.resolve();

  function getLabel(cb) {
    if (cb.id) {
      const el = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
      if (el) return el.innerText;
    }
    return cb.closest('label')?.innerText || cb.parentElement?.innerText || '';
  }

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

  // Only take links belonging to THIS checkbox, never the whole page
  function getLinks(cb) {
    const label = (cb.id && document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)) || cb.closest('label');
    let node = label || cb.parentElement;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      if (node.querySelectorAll('input[type="checkbox"]').length > 1) break;
      const docs = collectLinks(node);
      if (docs.length) return docs;
      node = node.parentElement;
    }
    return [];
  }

  // Insert badge after the label (or after the checkbox if no label)
  function insertBadge(cb, badgeEl) {
    const label = (cb.id && document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)) || cb.closest('label');
    if (label) {
      label.parentNode.insertBefore(badgeEl, label.nextSibling);
    } else {
      cb.parentNode.insertBefore(badgeEl, cb.nextSibling);
    }
  }

  function analyseCheckbox(cb) {
    if (cb.hasAttribute(PROCESSED)) return Promise.resolve();
    if (!KEYWORDS.some(r => r.test(getLabel(cb)))) return Promise.resolve();
    const docs = getLinks(cb);
    if (!docs.length) return Promise.resolve();
    cb.setAttribute(PROCESSED, 'true');

    const badgeUI = createBadge();
    badgeUI.setHover('Analyzing legal agreements...');
    insertBadge(cb, badgeUI.element);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE', payload: { site: location.hostname, documents: docs } },
        (res) => {
          if (!res || !res.success || !res.data) {
            const err = res?.error || 'AgreeWise server is not running';
            badgeUI.setGrade('?');
            badgeUI.setHover(err);
            badgeUI.fillPopover({ grade: '?', summary: err, documents: docs.map(d => ({ ...d, analyzed: false, reason: err })) });
            return resolve();
          }
          const data = res.data;
          badgeUI.setGrade(data.grade);
          badgeUI.setHover(data.grade === '?' ? data.summary : `${data.grade}: ${data.summary}`);
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

  const observer = new MutationObserver(() => scanPage());
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanPage);
  else scanPage();
})();
