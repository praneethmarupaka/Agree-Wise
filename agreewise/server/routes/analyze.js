// routes/analyze.js - Full-coverage chunked document analysis with checklist extraction
const express = require('express');
const cache = require('../services/cache');
const { splitIntoChunks, calculateAnalyzedChars, calculateCoverage } = require('../services/chunk');
const { analyzeChunk } = require('../services/llm');
const { filterFindings } = require('../services/checklist');
const { evaluateGradeAndSummary } = require('../services/score');
const { validateAnalyzeRequest, limiters } = require('../services/limits');

const router = express.Router();
const MIN_DOC_LENGTH = 1500;

router.use(limiters);

async function processDocument(doc, dependencies = {}) {
  const { type = 'TERMS', url = '', text } = doc;
  const analyzeChunkFn = dependencies.analyzeChunk || analyzeChunk;
  const cacheService = dependencies.cache || cache;
  const cleaned = (text || '').trim();
  const originalLength = (typeof doc.originalLength === 'number' && doc.originalLength >= cleaned.length)
    ? doc.originalLength : cleaned.length;
  const isTruncated = Boolean(doc.truncated) || originalLength > cleaned.length;

  if (url && /\.pdf(\?.*)?$/i.test(url)) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, truncated: isTruncated, originalLength, reason: 'PDF not supported yet', flags: [], rawFindings: [] };
  }
  if (!text || typeof text !== 'string' || !cleaned) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, truncated: isTruncated, originalLength, reason: doc.error || "Couldn't fetch the page", flags: [], rawFindings: [] };
  }
  if (cleaned.length < MIN_DOC_LENGTH) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, truncated: isTruncated, originalLength, reason: 'Page text too short, it may load with JavaScript', flags: [], rawFindings: [] };
  }

  const cached = await cacheService.getAnalysis(cleaned);
  if (cached && Array.isArray(cached.flags) && (cached.coverage == null || cached.coverage >= 1) && !isTruncated) {
    const cachedFlags = filterFindings(cached.flags, cleaned);
    return { analyzed: true, coverage: 1, chunksOk: 1, chunksFailed: 0, truncated: false, originalLength: cleaned.length, flags: cachedFlags, rawFindings: cached.flags, summary: cached.summary || '' };
  }

  const chunks = splitIntoChunks(cleaned);
  const successfulChunks = [];
  const rawFindings = [];

  for (const chunk of chunks) {
    try {
      const findings = await analyzeChunkFn({ type, text: chunk.text });
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
  let coverage = calculateCoverage(analyzedChars, originalLength);
  if (isTruncated && coverage >= 1) coverage = 0.99;

  if (analyzedChars === 0) {
    return { analyzed: false, coverage: 0, chunksOk, chunksFailed, truncated: isTruncated, originalLength, reason: 'LLM analysis failed', flags: [], rawFindings: [] };
  }

  const verifiedFlags = filterFindings(rawFindings, cleaned);
  if (coverage >= 1 && !isTruncated && process.env.MOCK_LLM !== 'true') {
    await cacheService.saveAnalysis({ text: cleaned, url, type, flags: verifiedFlags, summary: '', analyzed: true, coverage: 1 });
  }

  const reason = isTruncated ? 'Policy longer than the analysis limit' : undefined;
  return { analyzed: true, coverage, chunksOk, chunksFailed, truncated: isTruncated, originalLength, flags: verifiedFlags, rawFindings, ...(reason ? { reason } : {}) };
}

router.post('/', async (req, res) => {
  const validationError = validateAnalyzeRequest(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

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
        truncated: Boolean(result.truncated),
        originalLength: result.originalLength != null ? result.originalLength : (doc.text ? doc.text.length : 0),
        ...(result.reason ? { reason: result.reason } : (result.analyzed ? {} : { reason: 'Could not analyze document' })),
      });
      if (result.analyzed && Array.isArray(result.flags)) {
        allFindings.push(...result.flags);
      }
    } catch (err) {
      docStatuses.push({
        type: doc.type,
        url: doc.url,
        analyzed: false,
        coverage: 0,
        chunksOk: 0,
        chunksFailed: 0,
        truncated: false,
        originalLength: doc.text ? doc.text.length : 0,
        reason: err.message || "Couldn't fetch the page",
      });
    }
  }

  const finalFlags = filterFindings(allFindings);
  const evaluation = evaluateGradeAndSummary(finalFlags, docStatuses);
  const coverages = docStatuses.map(d => typeof d.coverage === 'number' ? d.coverage : 0);
  const anyTruncated = docStatuses.some(d => d.truncated);
  let topCoverage = coverages.length
    ? Math.round((coverages.reduce((a, b) => a + b, 0) / coverages.length) * 100) / 100
    : 0;
  if (anyTruncated && topCoverage >= 1) topCoverage = 0.99;

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
module.exports.processDocument = processDocument;
