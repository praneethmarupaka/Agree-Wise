// services/limits.js - Abuse limits, schema validation and multi-tier rate limiters
const rateLimit = require('express-rate-limit');
const net = require('net');
const MAX_PDF_BASE64_CHARS = 11 * 1024 * 1024;

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  const version = net.isIP(host);
  if (version === 4) {
    if (/^(0|10|127|169\.254|192\.0\.0|192\.168)\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  }
  if (version === 6 && (host === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/i.test(host))) return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped && isPrivateHost(mapped[1])) return true;
  return false;
}

function isSafeDocumentUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username && !parsed.password && !isPrivateHost(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function validateAnalyzeRequest(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.documents)) {
    return 'Invalid request: "documents" array is required.';
  }
  const { documents } = body;
  if (documents.length === 0 || documents.length > 4) return 'documents must be an array of 1 to 4 items.';

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (!doc || typeof doc !== 'object') return `Document at index ${i} must be an object.`;
    if (doc.type !== 'TERMS' && doc.type !== 'PRIVACY') return `Document at index ${i} type must be TERMS or PRIVACY.`;
    if (typeof doc.url !== 'string' || doc.url.length > 2000) return `Document at index ${i} URL must be a string under 2000 characters.`;
    if (!isSafeDocumentUrl(doc.url)) return `Document at index ${i} URL must be a public http or https URL.`;
    if (doc.pdfBase64 != null) {
      if (typeof doc.pdfBase64 !== 'string' || doc.pdfBase64.length > MAX_PDF_BASE64_CHARS ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(doc.pdfBase64)) {
        return `Document at index ${i} contains an invalid or oversized PDF payload.`;
      }
    }
    if (doc.text != null) {
      if (typeof doc.text !== 'string') return `Document at index ${i} text must be a string.`;
      if (doc.text.length > 120000) return `Document at index ${i} text exceeds maximum limit of 120,000 characters.`;
    }
    if (doc.originalLength != null) {
      if (typeof doc.originalLength !== 'number' || isNaN(doc.originalLength) || doc.originalLength < 0) return `Document at index ${i} originalLength must be a non-negative number.`;
      const textLen = typeof doc.text === 'string' ? doc.text.length : 0;
      if (!doc.pdfBase64 && doc.originalLength < textLen) return `Document at index ${i} originalLength cannot be smaller than received text length.`;
    }
    if (doc.truncated != null && typeof doc.truncated !== 'boolean') return `Document at index ${i} truncated must be a boolean.`;
  }
  return null;
}

const installLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: () => parseInt(process.env.RATE_LIMIT_INSTALL || '20', 10),
  keyGenerator: (req) => req.headers['x-install-id'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Rate limit exceeded: per-install limit reached.' }),
});

const ipLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: () => parseInt(process.env.RATE_LIMIT_IP || '60', 10),
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Rate limit exceeded: per-IP limit reached.' }),
});

const globalLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: () => parseInt(process.env.RATE_LIMIT_GLOBAL || '400', 10),
  keyGenerator: () => 'global',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Global daily capacity exceeded (400 analyses/day).' }),
});

module.exports = {
  validateAnalyzeRequest,
  isPrivateHost,
  isSafeDocumentUrl,
  limiters: [globalLimiter, ipLimiter, installLimiter],
};
