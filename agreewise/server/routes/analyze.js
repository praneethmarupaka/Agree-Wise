// routes/analyze.js - Full-coverage chunked document analysis with checklist extraction
const express = require('express');
const cache = require('../services/cache');
const { splitIntoChunks, calculateAnalyzedChars, calculateCoverage } = require('../services/chunk');
const { analyzeChunk } = require('../services/llm');
const { mergeFindings } = require('../services/checklist');
const { evaluateGradeAndSummary } = require('../services/score');
const { validateAnalyzeRequest, limiters } = require('../services/limits');

const router = express.Router();
const MIN_DOC_LENGTH = 1500;

router.use(limiters);

async function processDocument(doc) {
  const { type = 'TERMS', url = '', text } = doc;
  if (url && /\.pdf(\?.*)?$/i.test(url)) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, reason: 'PDF not supported yet', flags: [], rawFindings: [] };
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, reason: doc.error || "Couldn't fetch the page", flags: [], rawFindings: [] };
  }
  const cleaned = text.trim();
  if (cleaned.length < MIN_DOC_LENGTH) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, reason: 'Page text too short, it may load with JavaScript', flags: [], rawFindings: [] };
  }

  const cached = await cache.getAnalysis(cleaned);
  if (cached && Array.isArray(cached.flags) && (cached.coverage == null || cached.coverage >= 1)) {
    return { analyzed: true, coverage: 1, chunksOk: 1, chunksFailed: 0, flags: cached.flags, rawFindings: cached.flags, summary: cached.summary || '' };
  }

  const chunks = splitIntoChunks(cleaned);
  const successfulChunks = [];
  const rawFindings = [];

  for (const chunk of chunks) {
    try {
      const findings = await analyzeChunk({ type, text: chunk.text });
      successfulChunks.push(chunk);
      if (Array.isArray(findings)) {
        for (const f of findings) {
          rawFindings.push({ ...f, source: url, type });
        }
      }
    } catch (err) {
      console.warn(`[Chunk] error for ${url}:`, err.message);
    }
  }

  const chunksOk = successfulChunks.length;
  const chunksFailed = chunks.length - successfulChunks.length;
  const analyzedChars = calculateAnalyzedChars(successfulChunks);
  const coverage = calculateCoverage(analyzedChars, cleaned.length);

  if (analyzedChars === 0) {
    return { analyzed: false, coverage: 0, chunksOk, chunksFailed, reason: 'LLM analysis failed', flags: [], rawFindings: [] };
  }

  const verifiedFlags = mergeFindings(rawFindings, cleaned);

  if (coverage >= 1 && process.env.MOCK_LLM !== 'true') {
    await cache.saveAnalysis({ text: cleaned, url, type, flags: verifiedFlags, summary: '', analyzed: true, coverage: 1 });
  }

  return { analyzed: true, coverage, chunksOk, chunksFailed, flags: verifiedFlags, rawFindings };
}

router.post('/', async (req, res) => {
  const validationError = validateAnalyzeRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { site = 'unknown', documents = [] } = req.body;
  const docStatuses = [];
  const allFindings = [];

  for (const doc of documents) {
    try {
      const result = await processDocument(doc);
      docStatuses.push({
        type: doc.type,
        url: doc.url,
        analyzed: result.analyzed,
        coverage: result.coverage != null ? result.coverage : 0,
        chunksOk: result.chunksOk != null ? result.chunksOk : 0,
        chunksFailed: result.chunksFailed != null ? result.chunksFailed : 0,
        ...(result.analyzed ? {} : { reason: result.reason }),
      });
      if (result.analyzed && Array.isArray(result.rawFindings)) {
        allFindings.push(...result.rawFindings);
      }
    } catch (err) {
      docStatuses.push({
        type: doc.type,
        url: doc.url,
        analyzed: false,
        coverage: 0,
        chunksOk: 0,
        chunksFailed: 0,
        reason: err.message || "Couldn't fetch the page",
      });
    }
  }

  const finalFlags = mergeFindings(allFindings);
  const evaluation = evaluateGradeAndSummary(finalFlags, docStatuses);
  const coverages = docStatuses.map(d => typeof d.coverage === 'number' ? d.coverage : 0);
  const topCoverage = coverages.length
    ? Math.round((coverages.reduce((a, b) => a + b, 0) / coverages.length) * 100) / 100
    : 0;

  return res.json({
    site,
    riskScore: evaluation.riskScore,
    grade: evaluation.grade,
    summary: evaluation.summary,
    coverage: topCoverage,
    documents: docStatuses,
    flags: evaluation.grade === '?' && !docStatuses.some(d => d.analyzed) ? [] : finalFlags,
    disclaimer: 'AI summary, not legal advice.',
  });
});

module.exports = router;
