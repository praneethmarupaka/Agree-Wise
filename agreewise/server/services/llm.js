// services/llm.js - Gemini API client for checklist extraction (temperature 0)
const { enqueue } = require('./throttle');

const PROMPT_VERSION = 3;

const CHECKLIST_PROMPT = `Analyze the text for legal clauses. For each match, return an object in a JSON array.
Allowed IDs (use ONLY these IDs):
- SELLS_DATA: Provider sells personal data to third parties
- SHARES_ADS: Shares user data with advertisers or ad networks
- AI_TRAINING: Uses user content or data to train AI/ML models
- BROAD_TRACKING: Cross-site tracking, fingerprinting, or profiling
- LONG_RETENTION: Keeps data indefinitely or for an unspecified long time
- ARBITRATION: Mandatory arbitration or class-action waiver
- CONTENT_LICENSE: Perpetual, irrevocable, or sublicensable license to user content
- AUTO_RENEW: Subscriptions automatically renew
- HARD_CANCEL: Cancellation is hard, requires phone call, or no refund
- UNILATERAL_CHANGES: Terms can change without prior notice
- LIABILITY_LIMIT: Severe limitation of provider liability or warranty disclaimers
- TERMINATION_AT_WILL: Provider can terminate account at any time for any reason
- AFFILIATE_SHARING: Shares user data with corporate affiliates or subsidiaries

RULES:
1. Include a finding ONLY when the text explicitly says it. Never infer or guess.
2. The quote must be copied EXACTLY from the chunk (under 40 words).
3. If none are found, return an empty array [].
4. Return a JSON array ONLY: [ { "id": "...", "quote": "...", "explanation": "..." } ]`;

function cleanAndParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.findings)) return parsed.findings;
    if (parsed && Array.isArray(parsed.flags)) return parsed.flags;
  } catch (e) {}
  return null;
}

async function requestGemini(type, text) {
  const model = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY not configured.');

  const prompt = `${CHECKLIST_PROMPT}\n\nDOCUMENT TYPE: ${type}\n\nCHUNK TEXT:\n${text}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const isDaily = /per-day|per day|daily|quota.*day/i.test(errText);
    const is429 = res.status === 429 || /quota/i.test(errText);
    const msg = isDaily
      ? 'Daily LLM quota exceeded'
      : (is429 ? 'Rate limited, try again in a minute' : `LLM error ${res.status}`);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = cleanAndParse(rawText);
  if (!parsed) throw new Error('LLM JSON parse error');
  return parsed;
}

function getMockResult(type) {
  return [
    {
      id: type === 'TERMS' ? 'AUTO_RENEW' : 'AFFILIATE_SHARING',
      quote: type === 'TERMS' ? 'Your subscription will automatically renew' : 'We may share your information with our affiliates',
      explanation: type === 'TERMS' ? 'Subscriptions renew automatically.' : 'Data shared across corporate affiliates.',
    },
  ];
}

async function analyzeChunk({ type = 'TERMS', text = '' }) {
  if (process.env.MOCK_LLM === 'true') {
    return getMockResult(type);
  }

  try {
    return await enqueue(() => requestGemini(type, text));
  } catch (err) {
    if (err.message.includes('Rate limited') || err.message.includes('quota')) {
      throw err;
    }
    console.warn('[LLM] Attempt 1 failed:', err.message);
  }

  try {
    return await enqueue(() => requestGemini(type, text));
  } catch (err) {
    console.warn('[LLM] Attempt 2 failed:', err.message);
    throw new Error(err.message || 'LLM chunk analysis failed');
  }
}

module.exports = {
  PROMPT_VERSION,
  analyzeChunk,
  analyzeText: analyzeChunk,
};
