// services/chunk.js - Document chunking and coverage calculation
const MAX_DOC_CHARS = 60000;
const CHUNK_SIZE = 8000;
const OVERLAP = 500;
const MAX_CHUNKS = 10;

function splitIntoChunks(text, opts = {}) {
  if (!text || typeof text !== 'string') return [];
  const maxTotal = opts.maxTotalChars || MAX_DOC_CHARS;
  const size = opts.chunkSize || CHUNK_SIZE;
  const overlap = opts.overlap != null ? opts.overlap : OVERLAP;
  const maxChunks = opts.maxChunks || MAX_CHUNKS;

  const cappedText = text.slice(0, maxTotal);
  const total = cappedText.length;
  if (!total) return [];
  if (total <= size) {
    return [{ text: cappedText, start: 0, end: total }];
  }

  const chunks = [];
  let start = 0;

  while (start < total && chunks.length < maxChunks) {
    const idealEnd = start + size;
    if (idealEnd >= total) {
      chunks.push({ text: cappedText.slice(start, total), start, end: total });
      break;
    }

    let cut = idealEnd;
    const searchStart = Math.max(start + size - 1000, start + 500);
    const searchEnd = Math.min(total, idealEnd + 500);
    const zone = cappedText.slice(searchStart, searchEnd);

    const paraIdx = zone.lastIndexOf('\n\n');
    if (paraIdx !== -1) {
      cut = searchStart + paraIdx + 2;
    } else {
      const lineIdx = zone.lastIndexOf('\n');
      if (lineIdx !== -1) {
        cut = searchStart + lineIdx + 1;
      }
    }

    chunks.push({ text: cappedText.slice(start, cut), start, end: cut });

    const nextStart = Math.max(cut - overlap, start + 1);
    if (nextStart >= total) break;
    start = nextStart;
  }

  return chunks;
}

function calculateAnalyzedChars(successfulChunks = []) {
  if (!successfulChunks.length) return 0;
  const intervals = successfulChunks.map(c => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    if (!merged.length || merged[merged.length - 1][1] < start) {
      merged.push([start, end]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], end);
    }
  }
  return merged.reduce((acc, [start, end]) => acc + (end - start), 0);
}

function calculateCoverage(analyzedChars, totalChars) {
  if (!totalChars || totalChars <= 0) return 0;
  if (analyzedChars >= totalChars) return 1;
  return Math.round((analyzedChars / totalChars) * 100) / 100;
}

module.exports = {
  MAX_DOC_CHARS,
  CHUNK_SIZE,
  OVERLAP,
  MAX_CHUNKS,
  splitIntoChunks,
  calculateAnalyzedChars,
  calculateCoverage,
};
