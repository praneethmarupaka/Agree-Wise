// services/prefilter.js - Extracts candidate paragraphs with surrounding context
const TRIGGER_PHRASES = [
  'sell your data', 'sell data', 'third part', 'share',
  'automatically renew', 'auto-renew', 'cancel', 'refund',
  'binding arbitration', 'class action', 'waive', 'without notice',
  'perpetual', 'irrevocable', 'license', 'retain', 'retention',
  'tracking', 'cookies', 'advertis',
];

function prefilterText(text, maxChars = 12000) {
  if (!text || typeof text !== 'string') return '';
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return text.slice(0, maxChars);

  const matchedIndices = new Set();
  paras.forEach((para, idx) => {
    const lower = para.toLowerCase();
    if (TRIGGER_PHRASES.some(phrase => lower.includes(phrase))) {
      if (idx > 0) matchedIndices.add(idx - 1);
      matchedIndices.add(idx);
      if (idx < paras.length - 1) matchedIndices.add(idx + 1);
    }
  });

  if (!matchedIndices.size) {
    return text.slice(0, maxChars);
  }

  const sortedIndices = Array.from(matchedIndices).sort((a, b) => a - b);
  const selected = [];
  let currentLen = 0;

  for (const idx of sortedIndices) {
    const p = paras[idx];
    if (currentLen + p.length > maxChars && selected.length > 0) break;
    selected.push(p);
    currentLen += p.length + 2;
  }

  return selected.join('\n\n').slice(0, maxChars);
}

module.exports = {
  TRIGGER_PHRASES,
  prefilterText,
};
