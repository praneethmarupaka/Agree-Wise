// services/cache.js - SHA-256 (text+model+promptVersion+scoringVersion+supportVersion) caching with 30-day app TTL
const crypto = require('crypto');
const mongoose = require('mongoose');
const Analysis = require('../models/Analysis');
const { PROMPT_VERSION } = require('./llm');
const { SCORING_VERSION } = require('./score');
const { SUPPORT_VERSION } = require('./support');

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const memoryCache = new Map();
let isMongoConnected = false;

function hashKey(text, model) {
  const m = model || process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
  const p = String(PROMPT_VERSION || 5);
  const s = String(SCORING_VERSION || 1);
  const sp = String(SUPPORT_VERSION || 2);
  return crypto.createHash('sha256').update(String(text || '') + '|' + String(m) + '|' + p + '|' + s + '|' + sp).digest('hex');
}

async function initCache() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[Cache] MONGODB_URI not set; using in-memory Map cache fallback.');
    return;
  }
  try {
    await mongoose.connect(uri);
    isMongoConnected = true;
    console.log('[Cache] Connected to MongoDB.');
  } catch (err) {
    isMongoConnected = false;
    console.warn('[Cache] MongoDB connection failed, falling back to memory cache:', err.message);
  }
}

async function getAnalysis(text, model) {
  const docHash = hashKey(text, model);
  if (isMongoConnected) {
    try {
      const doc = await Analysis.findOne({ urlHash: docHash }).lean();
      if (doc) {
        const age = Date.now() - new Date(doc.createdAt).getTime();
        if (age < TTL_MS) return doc;
      }
    } catch (err) {
      console.warn('[Cache] MongoDB read failed, falling back to memory:', err.message);
    }
  }

  const mem = memoryCache.get(docHash);
  if (mem) {
    const age = Date.now() - new Date(mem.createdAt).getTime();
    if (age < TTL_MS) return mem;
    memoryCache.delete(docHash);
  }
  return null;
}

async function saveAnalysis({ text, url, type, flags = [], summary = '', model, analyzed = true, coverage = 1 }) {
  // Never cache mock results, unanalyzed docs, or partial documents (coverage < 1)
  if (process.env.MOCK_LLM === 'true' || !analyzed || coverage < 1 || !text) {
    return null;
  }

  const docHash = hashKey(text, model);
  const data = { urlHash: docHash, url: url || '', type, flags, summary, coverage: 1, createdAt: new Date() };

  if (isMongoConnected) {
    try {
      await Analysis.findOneAndUpdate({ urlHash: docHash }, data, { upsert: true, new: true });
      return data;
    } catch (err) {
      console.warn('[Cache] MongoDB write failed, saving to memory:', err.message);
    }
  }

  memoryCache.set(docHash, data);
  return data;
}

async function clearCache() {
  memoryCache.clear();
  if (isMongoConnected) {
    await Analysis.deleteMany({});
  }
}

module.exports = {
  TTL_MS,
  initCache,
  hashKey,
  hashText: hashKey,
  hashUrl: hashKey,
  getAnalysis,
  saveAnalysis,
  clearCache,
  isUsingMongo: () => isMongoConnected,
  getMemorySize: () => memoryCache.size,
};
