// services/cache.js - SHA-256 (url+model) caching with MongoDB and in-memory fallback
const crypto = require('crypto');
const mongoose = require('mongoose');
const Analysis = require('../models/Analysis');

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const memoryCache = new Map();
let isMongoConnected = false;

function hashUrl(url, model) {
  const m = model || process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
  return crypto.createHash('sha256').update(String(url || '') + '|' + String(m)).digest('hex');
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

async function getAnalysis(url, model) {
  const urlHash = hashUrl(url, model);
  if (isMongoConnected) {
    try {
      const doc = await Analysis.findOne({ urlHash }).lean();
      if (doc) return doc;
    } catch (err) {
      console.warn('[Cache] MongoDB read failed, falling back to memory:', err.message);
    }
  }

  const mem = memoryCache.get(urlHash);
  if (mem) {
    const age = Date.now() - new Date(mem.createdAt).getTime();
    if (age < TTL_MS) return mem;
    memoryCache.delete(urlHash);
  }
  return null;
}

async function saveAnalysis({ url, type, flags = [], summary = '', model, analyzed = true }) {
  // Never cache mock results, failed analyses, or unanalyzed documents
  if (process.env.MOCK_LLM === 'true' || !analyzed) {
    return null;
  }

  const urlHash = hashUrl(url, model);
  const data = { urlHash, url, type, flags, summary, createdAt: new Date() };

  if (isMongoConnected) {
    try {
      await Analysis.findOneAndUpdate({ urlHash }, data, { upsert: true, new: true });
      return data;
    } catch (err) {
      console.warn('[Cache] MongoDB write failed, saving to memory:', err.message);
    }
  }

  memoryCache.set(urlHash, data);
  return data;
}

async function clearCache() {
  memoryCache.clear();
  if (isMongoConnected) {
    await Analysis.deleteMany({});
  }
}

module.exports = {
  initCache,
  hashUrl,
  getAnalysis,
  saveAnalysis,
  clearCache,
  isUsingMongo: () => isMongoConnected,
  getMemorySize: () => memoryCache.size,
};
