// services/checklist.js - Fixed checklist definitions, ID mapping, negation filtering and merging
const { normalizeText } = require('./verify');
const { supports, describeScope, severityForArbitration, severityForContentLicense } = require('./support');

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
  WARRANTY_DISCLAIMER: { category: 'WARRANTY', title: 'Warranty disclaimer', defaultSeverity: 'LOW' },
};

function verifyQuote(quote, sourceText) {
  if (process.env.MOCK_LLM === 'true') return true;
  if (!quote || typeof quote !== 'string') return false;
  const nQuote = normalizeText(quote);
  const nSource = normalizeText(sourceText);
  if (!nQuote) return false;
  return nSource.includes(nQuote);
}

function isNegated(f) {
  const combined = `${f.quote || ''} ${f.context || ''}`;
  return /\b(we\s+do\s+not|do\s+not|does\s+not|will\s+not|we\s+never|never\s+(sell|share|track|use|disclose)|neither\s+sell|not\s+sell)\b/i.test(combined);
}

function mergeFindings(findings = [], sourceText = '') {
  const verified = [];
  for (const f of findings) {
    if (!f || !f.id || !f.quote) continue;
    let id = f.id;

    // Must be a known ID (before or after reclassification)
    if (!CHECKLIST_DEFS[id]) continue;
    if (isNegated(f)) continue;
    if (sourceText && !verifyQuote(f.quote, sourceText)) continue;

    const supportResult = supports(id, f.quote, f.context);
    if (supportResult === false) {
      console.log(`[SUPPORT] dropped ${id}`);
      continue;
    }
    if (supportResult === 'reclassify') {
      id = 'WARRANTY_DISCLAIMER';
      console.log(`[SUPPORT] reclassified LIABILITY_LIMIT → WARRANTY_DISCLAIMER`);
    }

    const scope = describeScope(id, f.quote, f.context);

    // Determine severity
    let severity;
    if (id === 'ARBITRATION') {
      severity = severityForArbitration(f.quote, f.context);
    } else if (id === 'CONTENT_LICENSE') {
      severity = severityForContentLicense(f.quote, f.context);
    } else {
      severity = f.severity || CHECKLIST_DEFS[id].defaultSeverity;
    }

    verified.push({ ...f, id, severity, scope });
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
    let severity = f.severity || def.defaultSeverity;
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
      context: typeof f.context === 'string' ? f.context.slice(0, 300) : '',
      section: f.section || '',
      source: f.source || '',
      type: f.type || 'TERMS',
      scope: f.scope || 'general',
      verified: true,
    });
  }

  return flags;
}

function filterFindings(findings = [], sourceText = '') {
  return mergeFindings(findings, sourceText);
}

module.exports = {
  CHECKLIST_DEFS,
  verifyQuote,
  isNegated,
  mergeFindings,
  filterFindings,
};
