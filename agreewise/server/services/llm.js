// services/llm.js - Gemini API client over plain fetch with throttling and JSON mode
const { enqueue } = require('./throttle');

const CATEGORIES = [
  'DATA_SHARING', 'DATA_COLLECTION', 'TRACKING', 'RETENTION',
  'AUTO_RENEWAL', 'CANCELLATION', 'ARBITRATION', 'UNILATERAL_CHANGES',
  'CONTENT_LICENSE',
];

const RUBRIC = `Analyze the document for consumer risk.
Categories: ${CATEGORIES.join(', ')}.
Each flag must include:
- category: one of the categories above
- severity: HIGH, MEDIUM, or LOW
- title: concise title
- explanation: plain English explanation, max 25 words
- quote: EXACT sentence copied verbatim from the text, under 40 words
- section: section title if identifiable

Return a JSON object ONLY with:
{
  "summary": "1-2 sentence summary of top risks.",
  "flags": [ { "category", "severity", "title", "explanation", "quote", "section" } ]
}`;

function cleanAndParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.flags)) return parsed;
    if (Array.isArray(parsed)) return { summary: 'Analysis completed.', flags: parsed };
  } catch (e) {}
  return null;
}

async function requestGemini(type, text) {
  const model = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY not configured.');

  const prompt = `${RUBRIC}\n\nDOCUMENT TYPE: ${type}\n\nTEXT:\n${text}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
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
  if (!parsed) {
    throw new Error('LLM JSON parse error');
  }
  return parsed;
}

function getMockResult(type) {
  return {
    summary: `Mock analysis for ${type} document.`,
    flags: [
      {
        category: type === 'TERMS' ? 'AUTO_RENEWAL' : 'DATA_SHARING',
        severity: type === 'TERMS' ? 'HIGH' : 'MEDIUM',
        title: type === 'TERMS' ? 'Automatic subscription renewal' : 'Data sharing with third parties',
        explanation: type === 'TERMS'
          ? 'Terms include automatic renewal unless cancelled.'
          : 'The policy states that user data may be shared with affiliated companies.',
        quote: type === 'TERMS'
          ? 'Your subscription will automatically renew...'
          : 'We may share your information with our affiliates...',
        section: 'General',
      },
    ],
  };
}

async function analyzeText({ type = 'TERMS', text = '' }) {
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
    throw new Error(err.message || 'LLM analysis failed');
  }
}

module.exports = {
  CATEGORIES,
  analyzeText,
};
