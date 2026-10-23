// models/Analysis.js
const mongoose = require('mongoose');

const AnalysisSchema = new mongoose.Schema({
  urlHash: {
    type: String,
    required: true,
    index: true,
  },
  url: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['TERMS', 'PRIVACY'],
  },
  flags: {
    type: Array,
    default: [],
  },
  summary: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 30 * 24 * 60 * 60, // 30-day TTL index
  },
});

module.exports = mongoose.models.Analysis || mongoose.model('Analysis', AnalysisSchema);
