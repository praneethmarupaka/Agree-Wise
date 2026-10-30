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
// Base64-encoded PDFs are accepted up to 8 MB (plus JSON/base64 overhead).
app.use(express.json({ limit: '12mb' }));

app.get('/', (req, res) => {
  res.json({ name: 'AgreeWise API', status: 'running' });
});

app.use('/analyze', analyzeRouter);

app.use((err, req, res, next) => {
  if (err) {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 400);
    return res.status(status).json({ error: err.message || 'Invalid request payload.' });
  }
  next();
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initCache();
  app.listen(PORT, () => console.log(`AgreeWise server listening on port ${PORT}`));
}

start();
module.exports = app;
