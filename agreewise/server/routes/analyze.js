// routes/analyze.js - Full-coverage chunked document analysis with PDF text extraction
const express = require('express');
const pdfParse = require('pdf-parse');
const cache = require('../services/cache');
const { splitIntoChunks, calculateAnalyzedChars, calculateCoverage } = require('../services/chunk');
const { analyzeChunk } = require('../services/llm');
const { filterFindings } = require('../services/checklist');
const { evaluateGradeAndSummary } = require('../services/score');
const { validateAnalyzeRequest, limiters } = require('../services/limits');

const router = express.Router();
const MIN_DOC_LENGTH = 1500;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_ANALYSIS_CHARS = 60000;

router.use(limiters);

async function processDocument(doc, dependencies = {}) {
  const { type = 'TERMS', url = '' } = doc;
  const analyzeChunkFn = dependencies.analyzeChunk || analyzeChunk;
  const cacheService = dependencies.cache || cache;
  const parsePdf = dependencies.parsePdf || pdfParse;
  let text = typeof doc.text === 'string' ? doc.text : '';
  let pdfTruncated = false;

  if (doc.pdfBase64) {
    try {
      const pdfBuffer = Buffer.from(doc.pdfBase64, 'base64');
      if (!pdfBuffer.length || pdfBuffer.length > MAX_PDF_BYTES || pdfBuffer.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('Invalid PDF file or PDF exceeds the 8 MB limit');
      }
      const parsed = await parsePdf(pdfBuffer);
      text = typeof parsed.text === 'string' ? parsed.text : '';
      if (text.length > MAX_ANALYSIS_CHARS) {
        text = text.slice(0, MAX_ANALYSIS_CHARS);
        pdfTruncated = true;
      }
    } catch (err) {
      return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, truncated: false, originalLength: 0, reason: err.message || 'Could not extract PDF text', flags: [], rawFindings: [] };
    }
  }

  const cleaned = text.trim();
  // For PDFs, measure coverage against extracted text length, not binary file size.
  const originalLength = doc.pdfBase64
    ? (pdfTruncated ? cleaned.length + 1 : cleaned.length)
    : Math.max(typeof doc.originalLength === 'number' ? doc.originalLength : 0, cleaned.length);
  const isTruncated = Boolean(doc.truncated) || pdfTruncated || originalLength > cleaned.length;

 if (!text || !cleaned) {
  const reason = doc.error || (
    doc.pdfBase64
      ? 'PDF contains no readable text; it may contain scanned images only'
      : 'No readable text found in this document'
  );

  return {
    analyzed: false,
    coverage: 0,
    chunksOk: 0,
    chunksFailed: 0,
    truncated: isTruncated,
    originalLength,
    reason,
    flags: [],
    rawFindings: []
  };
}
  if (cleaned.length < MIN_DOC_LENGTH) {
    return { analyzed: false, coverage: 0, chunksOk: 0, chunksFailed: 0, truncated: isTruncated, originalLength, reason: 'Document text is too short or the PDF may contain scanned images only', flags: [], rawFindings: [] };
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
        for (const f of findings) rawFindings.push({ ...f, source: url, type });
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

  const reason = isTruncated ? 'Document exceeds the analysis text limit' : undefined;
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
      if (result.analyzed && Array.isArray(result.flags)) allFindings.push(...result.flags);
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
        reason: err.message || "Couldn't analyze document",
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
