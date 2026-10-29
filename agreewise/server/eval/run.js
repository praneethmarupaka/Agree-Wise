// eval/run.js - Evaluator for policy sample files
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { splitIntoChunks } = require('../services/chunk');
const { analyzeChunk } = require('../services/llm');
const { filterFindings } = require('../services/checklist');

async function run() {
  const samplesDir = path.join(__dirname, 'samples');
  if (!fs.existsSync(samplesDir)) {
    console.log('[Eval] Samples directory does not exist:', samplesDir);
    return;
  }

  const files = fs.readdirSync(samplesDir).filter(f => f.endsWith('.txt'));
  if (!files.length) {
    console.log('[Eval] No .txt files found in:', samplesDir);
    return;
  }

  const hasKey = Boolean(process.env.LLM_API_KEY);
  console.log(`[Eval] Found ${files.length} sample file(s). LLM mode: ${hasKey ? 'Live API' : 'Mock'}\n`);

  for (const file of files) {
    const fullPath = path.join(samplesDir, file);
    const content = fs.readFileSync(fullPath, 'utf8').trim();
    console.log(`=== File: ${file} (${content.length} chars) ===`);

    const chunks = splitIntoChunks(content);
    console.log(`  Split into ${chunks.length} chunk(s). Processing...`);

    const rawFindings = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const findings = await analyzeChunk({ type: 'TERMS', text: chunks[i].text });
        if (Array.isArray(findings)) {
          rawFindings.push(...findings);
        }
      } catch (err) {
        console.error(`  Chunk ${i + 1} failed:`, err.message);
      }
    }

    const merged = filterFindings(rawFindings, content);
    console.log(`  Identified ${merged.length} unique clause(s):`);
    if (!merged.length) {
      console.log('    (None found)');
    } else {
      for (const flag of merged) {
        console.log(`    [${flag.id}] (${flag.severity})`);
        console.log(`      Quote: "${flag.quote}"`);
        if (flag.explanation) console.log(`      Explanation: ${flag.explanation}`);
      }
    }
    console.log('');
  }
}

run().catch(err => {
  console.error('[Eval] Error running evaluation:', err);
  process.exit(1);
});
