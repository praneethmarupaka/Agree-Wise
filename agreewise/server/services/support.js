// services/support.js - Semantic gate: supports(id,quote,context) & describeScope(id,quote,context)
const SUPPORT_VERSION = 3;

const MANDATORY_RE = [
  /(shall|must|will|agree to|agree that)[^.]{0,150}(be (resolved|settled|decided|submitted|referred)|resolve|submit)[^.]{0,150}arbitrat/i,
  /binding arbitration/i,
  /exclusive(ly)?[^.]{0,100}arbitrat/i,
  /mandatory arbitration/i,
  /required arbitration/i,
  /arbitration is (mandatory|required)/i,
];
const CLASS_WAIVER_RE = [
  /waive[^.]{0,120}class/i,
  /(only|solely)[^.]{0,80}(individual capacity|individual basis)/i,
  /not as a (plaintiff or )?class member/i,
  /no (class|representative|collective) (action|proceeding)/i,
];
const OPT_OUT_RE = [/opt[- ]?out/i, /reject (this )?arbitration/i];
const OPTIONAL_ONLY_RE = [/may elect/i, /at your option/i, /you may choose/i];
const NARROW_RE = /applies only|only (applies|to)|with respect to|in the case of|regarding (undisclosed|paid)|for disputes (about|regarding|concerning)|violations? of/i;

const OPEN_LICENSE_RE = /creative commons|cc by|gfdl|gnu free documentation|open source license|public domain/i;
const COMPANY_LICENSE_RE = /(you|user|users?) (grant|license|give|assign)[^.]{0,120}(perpetual|irrevocable|sub[- ]?licens|worldwide)/i;

const WARRANTY_RE = /\b(as is|without warranty|disclaim(s|er)? (all |any )?warrant(y|ies))\b/i;
const LIABILITY_CAP_RE = /(limit(ation)? of liability|not be liable|shall not be liable|no event shall|aggregate liability|maximum liability|indirect|consequential|incidental|punitive damages)/i;

const UNILAT_POSITIVE_RE = /(modify|change|update|amend|revise)[^.]{0,120}(without (prior )?notice|at any time|sole discretion)|reserve the right to (modify|change|update|amend|revise)/i;
const UNILAT_NOTIFY_RE = /we will (notify|provide notice|inform|email)|notify you|provide you (with )?notice/i;

const AI_RE = /(train(ing)?|develop(ing)?|improv(ing)?)[^.]{0,100}(ai|artificial intelligence|machine learning|models?|algorithms?|llm)|(ai|machine learning|models?)[^.]{0,80}(train|learn)|generative ai/i;
const SELLS_RE = /(sell|sale of|selling)[^.]{0,80}(personal (data|information)|user (data|information)|your (personal )?data|your information)/i;
const SHARES_ADS_RE = /(share|disclose|provide|transfer)[^.]{0,100}(advertis|marketing partners?|ad networks?|third[- ]?party ads)|(targeted|personalized|behavioral) (ads?|advertising)/i;
const AUTO_RENEW_RE = /(auto(matically)?[- ]?renew|recurring (billing|charge|payment|subscription)|subscription (will|shall) renew|until (you cancel|cancelled))/i;

function supports(id, quote, context) {
  const text = `${quote || ''} ${context || ''}`;

  if (id === 'ARBITRATION') {
    if (!/arbitrat/i.test(text)) return false; // mediation alone → drop
    const isMandatory = MANDATORY_RE.some(r => r.test(text));
    const hasClassWaiver = CLASS_WAIVER_RE.some(r => r.test(text));
    if (!isMandatory && !hasClassWaiver) {
      if (OPTIONAL_ONLY_RE.some(r => r.test(text))) return false;
    }
    if (!isMandatory && !hasClassWaiver) return false;
    return true;
  }

  if (id === 'CONTENT_LICENSE') {
    if (OPEN_LICENSE_RE.test(text) && !COMPANY_LICENSE_RE.test(text)) return false;
    return COMPANY_LICENSE_RE.test(text) || /perpetual|irrevocable|sub[- ]?licens|worldwide/i.test(text);
  }

  if (id === 'LIABILITY_LIMIT') {
    if (WARRANTY_RE.test(text) && !LIABILITY_CAP_RE.test(text)) return 'reclassify';
    return LIABILITY_CAP_RE.test(text);
  }

  if (id === 'UNILATERAL_CHANGES') {
    if (!UNILAT_POSITIVE_RE.test(text)) return false;
    if (UNILAT_NOTIFY_RE.test(text)) return false;
    return true;
  }

  if (id === 'AI_TRAINING') return AI_RE.test(text);
  if (id === 'SELLS_DATA') return SELLS_RE.test(text);
  if (id === 'SHARES_ADS') return SHARES_ADS_RE.test(text);
  if (id === 'AUTO_RENEW') return AUTO_RENEW_RE.test(text);

  return true; // IDs without specific rules pass through
}

function describeScope(id, quote, context) {
  const text = `${quote || ''} ${context || ''}`;

  if (id === 'ARBITRATION') {
    if (NARROW_RE.test(text)) return 'narrow';
    if (OPT_OUT_RE.some(r => r.test(text))) return 'narrow';
  }

  if (id === 'CONTENT_LICENSE') {
    if (OPEN_LICENSE_RE.test(text)) return 'narrow';
  }

  return 'general';
}

function severityForArbitration(quote, context) {
  const text = `${quote || ''} ${context || ''}`;
  if (NARROW_RE.test(text)) return 'MEDIUM';
  if (OPT_OUT_RE.some(r => r.test(text))) return 'MEDIUM';
  return 'HIGH';
}

module.exports = {
  SUPPORT_VERSION,
  supports,
  describeScope,
  severityForArbitration,
};
