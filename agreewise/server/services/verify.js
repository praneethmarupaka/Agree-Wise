// services/verify.js - Quote verification and cross-document deduplication
function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

function verifyFlags(flags = [], sourceText = '') {
  if (!Array.isArray(flags)) return [];
  const normalizedSource = normalizeText(sourceText);

  return flags
    .filter(flag => {
      if (!flag || !flag.quote) return false;
      // In mock mode, keep the standard mock flags
      if (process.env.MOCK_LLM === 'true') return true;
      const normalizedQuote = normalizeText(flag.quote);
      if (!normalizedQuote) return false;
      return normalizedSource.includes(normalizedQuote);
    })
    .map(flag => ({
      ...flag,
      verified: true,
    }));
}

function isSimilarQuote(q1, q2) {
  const n1 = normalizeText(q1);
  const n2 = normalizeText(q2);
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  return false;
}

function deduplicateFlags(flags = []) {
  const result = [];
  const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };

  for (const flag of flags) {
    const existingIdx = result.findIndex(existing =>
      existing.category === flag.category &&
      isSimilarQuote(existing.quote, flag.quote)
    );

    if (existingIdx === -1) {
      result.push(flag);
    } else {
      // Keep whichever has higher severity
      const existingRank = severityRank[result[existingIdx].severity] || 0;
      const newRank = severityRank[flag.severity] || 0;
      if (newRank > existingRank) {
        result[existingIdx] = flag;
      }
    }
  }

  return result;
}

module.exports = {
  normalizeText,
  verifyFlags,
  deduplicateFlags,
};
