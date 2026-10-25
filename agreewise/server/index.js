// index.js - AgreeWise backend server
   require('dns').setServers(['8.8.8.8', '1.1.1.1']);
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const analyzeRouter = require('./routes/analyze');
const { initCache } = require('./services/cache');

const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Health / root endpoint
app.get('/', (req, res) => {
  res.json({ name: 'AgreeWise API', status: 'running' });
});

// Main analyze route
app.use('/analyze', analyzeRouter);

// JSON parse error & payload too large handler
app.use((err, req, res, next) => {
  if (err) {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 400);
    return res.status(status).json({
      error: err.message || 'Invalid request payload.',
    });
  }
  next();
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initCache();
  app.listen(PORT, () => {
    console.log(`AgreeWise server listening on port ${PORT}`);
  });
}

start();

module.exports = app;
