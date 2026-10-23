// services/throttle.js - Serial queue with 5s pacing and 429 backoff
let lastStartTime = 0;
const MIN_GAP_MS = 5000;
let queue = Promise.resolve();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryDelay(err) {
  const msg = String(err?.message || '');
  const match = msg.match(/retry(?:-after)?\s*(?:in|after)?\s*(\d+)/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return 20000; // default 20s
}

async function runThrottled(fn) {
  const waitTime = MIN_GAP_MS - (Date.now() - lastStartTime);
  if (waitTime > 0) {
    await sleep(waitTime);
  }
  lastStartTime = Date.now();

  const start = Date.now();
  let retries = 0;

  while (true) {
    try {
      const res = await fn();
      console.log(`[LLM] ok in ${Date.now() - start}ms`);
      return res;
    } catch (err) {
      const msg = String(err?.message || '');
      const is429 = msg.includes('429') || err?.status === 429;
      const isPerDay = /per-day|per day|daily|quota.*day/i.test(msg);

      if (is429 && !isPerDay && retries < 2) {
        retries++;
        const delay = parseRetryDelay(err);
        console.warn(`[LLM] 429 rate limit (retry ${retries}/2), waiting ${delay / 1000}s`);
        await sleep(delay);
        lastStartTime = Date.now();
        continue;
      }

      console.log(`[LLM] failed in ${Date.now() - start}ms`);
      throw err;
    }
  }
}

function enqueue(fn) {
  const resultPromise = queue.then(() => runThrottled(fn));
  queue = resultPromise.catch(() => {});
  return resultPromise;
}

module.exports = {
  enqueue,
};
