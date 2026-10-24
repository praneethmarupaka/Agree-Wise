// services/checklist.js - Fixed checklist definitions, ID mapping and merging
const { normalizeText } = require('./verify');

const CHECKLIST_DEFS = {
  SELLS_DATA: { category: 'DATA_SHARING', title: 'Sale of personal data', defaultSeverity: 'HIGH' },
  SHARES_ADS: { category: 'DATA_SHARING', title: 'Data shared with advertisers', defaultSeverity: 'HIGH' },
  AI_TRAINING: { category: 'AI_TRAINING', title: 'User data used for AI model training', defaultSeverity: 'HIGH' },
  ARBITRATION: { category: 'ARBITRATION', title: 'Mandatory arbitration or class-action waiver', defaultSeverity: 'HIGH' },
  CONTENT_LICENSE: { category: 'CONTENT_LICENSE', title: 'Broad license over user content', defaultSeverity: 'HIGH' },
  UNILATERAL_CHANGES: { category: 'UNILATERAL_CHANGES', title: 'Terms can change without notice', defaultSeverity: 'HIGH' },
  BROAD_TRACKING: { category: 'TRACKING', title: 'Broad tracking or cross-site profiling', defaultSeverity: 'MEDIUM' },
  LONG_RETENTION: { category: 'RETENTION', title: 'Indefinite or long data retention', defaultSeverity: 'MEDIUM' },
  HARD_CANCEL: { category: 'CANCELLATION', title: 'Difficult cancellation or no refund', defaultSeverity: 'MEDIUM' },
  AFFILIATE_SHARING: { category: 'DATA_SHARING', title: 'Data sharing with affiliates', defaultSeverity: 'MEDIUM' },
  LIABILITY_LIMIT: { category: 'LIABILITY', title: 'Significant limitation of liability', defaultSeverity: 'MEDIUM' },
  TERMINATION_AT_WILL: { category: 'TERMINATION', title: 'Account termination at will', defaultSeverity: 'MEDIUM' },
  AUTO_RENEW: { category: 'AUTO_RENEWAL', title: 'Automatic subscription renewal', defaultSeverity: 'LOW' },
};

function verifyQuote(quote, sourceText) {
  if (process.env.MOCK_LLM === 'true') return true;
  if (!quote || typeof quote !== 'string') return false;
  const nQuote = normalizeText(quote);
  const nSource = normalizeText(sourceText);
  if (!nQuote) return false;
  return nSource.includes(nQuote);
}

function mergeFindings(findings = [], sourceText = '') {
  const verified = [];
  for (const f of findings) {
    if (!f || !f.id || !CHECKLIST_DEFS[f.id] || !f.quote) continue;
    if (sourceText && !verifyQuote(f.quote, sourceText)) continue;
    verified.push(f);
  }

  // One finding per ID, keeping longest verified quote
  const byId = new Map();
  for (const f of verified) {
    const existing = byId.get(f.id);
    const existingLen = existing && existing.quote ? existing.quote.length : 0;
    const curLen = f.quote ? f.quote.length : 0;
    if (!existing || curLen > existingLen) {
      byId.set(f.id, f);
    }
  }

  const hasAutoRenew = byId.has('AUTO_RENEW');
  const hasHardCancel = byId.has('HARD_CANCEL');
  const flags = [];

  for (const [id, f] of byId.entries()) {
    const def = CHECKLIST_DEFS[id];
    let severity = def.defaultSeverity;
    if (id === 'AUTO_RENEW') {
      severity = hasHardCancel ? 'HIGH' : 'LOW';
    }
    flags.push({
      id,
      category: def.category,
      severity,
      title: def.title,
      explanation: f.explanation || '',
      quote: f.quote,
      section: f.section || '',
      source: f.source || '',
      type: f.type || 'TERMS',
      verified: true,
    });
  }

  return flags;
}

module.exports = {
  CHECKLIST_DEFS,
  verifyQuote,
  mergeFindings,
};
