// routes/analyze.js - Document pipeline orchestration, caching and grading
const express = require('express');
const rateLimit = require('express-rate-limit');
const cache = require('../services/cache');
const { prefilterText } = require('../services/prefilter');
const { analyzeText } = require('../services/llm');
const { verifyFlags, deduplicateFlags } = require('../services/verify');
const { evaluateGradeAndSummary } = require('../services/score');

const router = express.Router();
const MIN_DOC_LENGTH = 1500;

const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.headers['x-install-id'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded: 20 analyses per day.' },
});

router.use(limiter);

async function processDocument(doc) {
  const { type = 'TERMS', url = '', text } = doc;

  if (url && /\.pdf(\?.*)?$/i.test(url)) {
    return { analyzed: false, reason: 'PDF not supported yet', flags: [] };
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { analyzed: false, reason: doc.error || "Couldn't fetch the page", flags: [] };
  }

  const cleaned = text.trim();
  if (cleaned.length < MIN_DOC_LENGTH) {
    return { analyzed: false, reason: 'Page text too short, it may load with JavaScript', flags: [] };
  }

  const cached = await cache.getAnalysis(url);
  if (cached && Array.isArray(cached.flags)) {
    return { analyzed: true, flags: cached.flags, summary: cached.summary || '' };
  }

  let llmResult;
  try {
    const candidateText = prefilterText(cleaned);
    llmResult = await analyzeText({ type, text: candidateText });
  } catch (err) {
    const is429 = /rate limit|429|quota/i.test(err.message);
    const reason = is429 ? 'Rate limited, try again in a minute' : 'LLM analysis failed';
    return { analyzed: false, reason, flags: [] };
  }

  const verified = verifyFlags(llmResult.flags || [], cleaned).map(flag => ({
    ...flag,
    source: url,
    type,
  }));

  if (process.env.MOCK_LLM !== 'true') {
    await cache.saveAnalysis({
      url,
      type,
      flags: verified,
      summary: llmResult.summary || '',
      analyzed: true,
    });
  }

  return { analyzed: true, flags: verified, summary: llmResult.summary || '' };
}

router.post('/', async (req, res) => {
  if (!req.body || !Array.isArray(req.body.documents)) {
    return res.status(400).json({ error: 'Invalid request: "documents" array is required.' });
  }

  const { site = 'unknown', documents = [] } = req.body;
  const docStatuses = [];
  const rawFlags = [];

  for (const doc of documents) {
    try {
      const result = await processDocument(doc);
      docStatuses.push({
        type: doc.type,
        url: doc.url,
        analyzed: result.analyzed,
        ...(result.analyzed ? {} : { reason: result.reason }),
      });
      if (result.analyzed && result.flags) {
        rawFlags.push(...result.flags);
      }
    } catch (err) {
      docStatuses.push({
        type: doc.type,
        url: doc.url,
        analyzed: false,
        reason: err.message || "Couldn't fetch the page",
      });
    }
  }

  const finalFlags = deduplicateFlags(rawFlags);
  const evaluation = evaluateGradeAndSummary(finalFlags, docStatuses);

  return res.json({
    site,
    riskScore: evaluation.riskScore,
    grade: evaluation.grade,
    summary: evaluation.summary,
    documents: docStatuses,
    flags: evaluation.grade === '?' && !docStatuses.some(d => d.analyzed) ? [] : finalFlags,
    disclaimer: 'AI summary, not legal advice.',
  });
});

module.exports = router;
