// services/support.js - Semantic gate: supports(id,quote,context) & describeScope(id,quote,context)
const SUPPORT_VERSION = 4;

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
const DPF_RE = /(data privacy framework|\bDPF\b|privacy shield)/i;
const DPF_CONDITIONAL_RE = /(if|where|when|only if|provided that|eligible|participant|under|pursuant to|through)[^.]{0,100}(data privacy framework|\bDPF\b|privacy shield)|(?:data privacy framework|\bDPF\b|privacy shield)[^.]{0,100}(if|where|when|only if|provided that|eligible|participant|under|pursuant to|through)/i;
const GENERAL_ARBITRATION_RE = /(all|any) disputes?[^.]{0,120}(?:arbitrat|class action)|(?:arbitrat|class action)[^.]{0,120}(all|any) disputes?/i;

const OPEN_LICENSE_RE = /creative commons|cc by|gfdl|gnu free documentation|open source license|public domain/i;
const COMPANY_LICENSE_RE = /(you|user|users?) (grant|license|give|assign)[^.]{0,120}(perpetual|irrevocable|sub[- ]?licens|worldwide)/i;
const USER_CONTENT_RE = /(your|user|users'|uploaded|submitted|customer)[^.]{0,100}(content|material|photo|video|text|post)/i;
const SERVICE_ONLY_LICENSE_RE = /(?:solely|only|purpose of)[^.]{0,100}(?:provide|operate|display|host|deliver|run)[^.]{0,80}(?:service|platform|site|app)/i;
const COMMERCIAL_LICENSE_RE = /(advertis|market|promot|commercial|sell|train|improv|develop|sublicens|third[- ]part)/i;

const WARRANTY_RE = /\b(as is|without warranty|disclaim(s|er)? (all |any )?warrant(y|ies))\b/i;
const LIABILITY_CAP_RE = /(limit(ation)? of liability|not be liable|shall not be liable|no event shall|aggregate liability|maximum liability|indirect|consequential|incidental|punitive damages)/i;

const UNILAT_POSITIVE_RE = /(modify|change|update|amend|revise)[^.]{0,120}(without (prior )?notice|at any time|sole discretion)|reserve the right to (modify|change|update|amend|revise)/i;
const UNILAT_NOTIFY_RE = /we will (notify|provide notice|inform|email)|notify you|provide you (with )?notice/i;
const BETA_PREVIEW_RE = /\b(?:beta|preview)\b/i;
const BETA_SCOPE_RE = /\b(?:beta|preview)\b[^.]{0,120}(?:feature|service|program|release|version|product)/i;

const AI_RE = /(train(ing)?|develop(ing)?|improv(ing)?)[^.]{0,100}(ai|artificial intelligence|machine learning|models?|algorithms?|llm)|(ai|machine learning|models?)[^.]{0,80}(train|learn)|generative ai/i;
const SELLS_RE = /(sell|sale of|selling)[^.]{0,80}(personal (data|information)|user (data|information)|your (personal )?data|your information)/i;
const SHARE_ACTION_RE = /(share|disclose|provide|transfer|send|make available)/i;
const AD_RECIPIENT_RE = /(advertis|marketing partners?|ad networks?|third[- ]party ads?)/i;
const DATA_REFERENCE_RE = /(personal (data|information)|user (data|information)|your (?:personal )?(?:data|information)|browsing|activity|behavior|profile|cookies|device data|identifiers?)/i;
const AUTO_RENEW_RE = /(auto(matically)?[- ]?renew|recurring (billing|charge|payment|subscription)|subscription (will|shall) renew|until (you cancel|cancelled))/i;
const HARD_CANCEL_RE = /(cancel(?:lation)?|terminate)[^.]{0,140}(phone|call|email|mail|written|contact support|customer service|manual|no online|not available online|multiple steps|difficult|hard|complicated|notice period|early termination fee)|(?:phone|call|email|mail|written|contact support|customer service|manual|no online|not available online|multiple steps|difficult|hard|complicated|notice period|early termination fee)[^.]{0,140}(cancel(?:lation)?|terminate)/i;

function supports(id, quote, context) {
  const text = `${quote || ''} ${context || ''}`;

  if (id === 'ARBITRATION') {
    if (!/arbitrat/i.test(text)) return false; // mediation alone → drop
    const sentences = text.split(/(?<=[.!?])\s+/);
    const dpfScoped = DPF_RE.test(text) && DPF_CONDITIONAL_RE.test(text);
    const nonDpfText = sentences.filter(sentence => !DPF_RE.test(sentence)).join(' ');
    const isMandatory = MANDATORY_RE.some(r => r.test(text));
    const hasClassWaiver = CLASS_WAIVER_RE.some(r => r.test(text));
    const hasIndependentMandatory = MANDATORY_RE.some(r => r.test(nonDpfText)) || GENERAL_ARBITRATION_RE.test(nonDpfText);
    if (OPTIONAL_ONLY_RE.some(r => r.test(text)) && !hasClassWaiver && !hasIndependentMandatory) return false;
    if (dpfScoped && !hasClassWaiver && !hasIndependentMandatory) {
      return true;
    }
    if (!isMandatory && !hasClassWaiver) {
      return false;
    }
    if (!isMandatory && !hasClassWaiver) return false;
    return true;
  }

  if (id === 'CONTENT_LICENSE') {
    if (OPEN_LICENSE_RE.test(text) && !COMPANY_LICENSE_RE.test(text)) return false;
    if (!USER_CONTENT_RE.test(text)) return false;
    return COMPANY_LICENSE_RE.test(text);
  }

  if (id === 'LIABILITY_LIMIT') {
    if (WARRANTY_RE.test(text) && !LIABILITY_CAP_RE.test(text)) return 'reclassify';
    return LIABILITY_CAP_RE.test(text);
  }

  if (id === 'UNILATERAL_CHANGES') {
    if (!UNILAT_POSITIVE_RE.test(text)) return false;
    if (UNILAT_NOTIFY_RE.test(text)) return false;
    if (BETA_PREVIEW_RE.test(text) && BETA_SCOPE_RE.test(text) && !/\b(?:these|the) terms\b|\bagreement\b|\bpolicy\b/i.test(text)) {
      return false;
    }
    return true;
  }

  if (id === 'AI_TRAINING') return AI_RE.test(text);
  if (id === 'SELLS_DATA') return SELLS_RE.test(text);
  if (id === 'SHARES_ADS') return SHARE_ACTION_RE.test(text) && AD_RECIPIENT_RE.test(text) && DATA_REFERENCE_RE.test(text);
  if (id === 'AUTO_RENEW') return AUTO_RENEW_RE.test(text);
  if (id === 'HARD_CANCEL') return HARD_CANCEL_RE.test(text);

  return true; // IDs without specific rules pass through
}

function describeScope(id, quote, context) {
  const text = `${quote || ''} ${context || ''}`;

  if (id === 'ARBITRATION') {
    if (NARROW_RE.test(text)) return 'narrow';
    if (OPT_OUT_RE.some(r => r.test(text))) return 'narrow';
    if (DPF_RE.test(text) && DPF_CONDITIONAL_RE.test(text)) return 'narrow';
  }

  if (id === 'CONTENT_LICENSE') {
    if (OPEN_LICENSE_RE.test(text)) return 'narrow';
    if (SERVICE_ONLY_LICENSE_RE.test(text) && !COMMERCIAL_LICENSE_RE.test(text)) return 'narrow';
  }

  return 'general';
}

function severityForArbitration(quote, context) {
  const text = `${quote || ''} ${context || ''}`;
  if (NARROW_RE.test(text)) return 'MEDIUM';
  if (OPT_OUT_RE.some(r => r.test(text))) return 'MEDIUM';
  if (DPF_RE.test(text) && DPF_CONDITIONAL_RE.test(text)) return 'MEDIUM';
  return 'HIGH';
}

function severityForContentLicense(quote, context) {
  const text = `${quote || ''} ${context || ''}`;
  if (SERVICE_ONLY_LICENSE_RE.test(text) && !COMMERCIAL_LICENSE_RE.test(text)) return 'MEDIUM';
  return 'HIGH';
}

module.exports = {
  SUPPORT_VERSION,
  supports,
  describeScope,
  severityForArbitration,
  severityForContentLicense,
};
