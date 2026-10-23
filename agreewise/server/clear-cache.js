// clear-cache.js - Clear cached legal analyses from MongoDB and memory
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const Analysis = require('./models/Analysis');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[Clear-Cache] MONGODB_URI is not set; in-memory cache resets on server restart.');
    process.exit(0);
  }

  try {
    await mongoose.connect(uri);
    const result = await Analysis.deleteMany({});
    console.log(`[Clear-Cache] Successfully deleted ${result.deletedCount || 0} cached document(s).`);
  } catch (err) {
    console.error('[Clear-Cache] Failed to clear MongoDB cache:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
