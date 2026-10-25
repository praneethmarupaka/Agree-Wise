// services/limits.js - Abuse limits, schema validation and multi-tier rate limiters
const rateLimit = require('express-rate-limit');

function validateAnalyzeRequest(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.documents)) {
    return 'Invalid request: "documents" array is required.';
  }
  const { documents } = body;
  if (documents.length === 0 || documents.length > 4) {
    return 'documents must be an array of 1 to 4 items.';
  }

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (!doc || typeof doc !== 'object') {
      return `Document at index ${i} must be an object.`;
    }
    if (doc.type !== 'TERMS' && doc.type !== 'PRIVACY') {
      return `Document at index ${i} type must be TERMS or PRIVACY.`;
    }
    if (typeof doc.url !== 'string' || doc.url.length > 2000) {
      return `Document at index ${i} URL must be a string under 2000 characters.`;
    }
    try {
      const parsed = new URL(doc.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Document at index ${i} URL must use http or https protocol.`;
      }
    } catch (_) {
      return `Document at index ${i} has an invalid URL.`;
    }
    if (doc.text != null) {
      if (typeof doc.text !== 'string') {
        return `Document at index ${i} text must be a string.`;
      }
      if (doc.text.length > 120000) {
        return `Document at index ${i} text exceeds maximum limit of 120,000 characters.`;
      }
    }
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
  limiters: [globalLimiter, ipLimiter, installLimiter],
};
