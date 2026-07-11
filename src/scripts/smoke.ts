/**
 * Day-1 gate: can we chat, embed, and cache against Qwen Cloud from localhost?
 *
 * Run: pnpm smoke
 */

import { MODELS } from '../qwen/models.js';
import { chat, embed, cosine, cacheStats } from '../qwen/client.js';

function ok(label: string, detail: string): void {
  console.log(`  \x1b[32m✓\x1b[0m ${label} - ${detail}`);
}

const t0 = performance.now();
console.log(`\nPalimpsest smoke test → ${process.env.QWEN_BASE_URL}\n`);

// 1. Extraction model, thinking OFF. This is the cheap high-volume path.
const reply = await chat({
  model: MODELS.extract,
  user: 'Reply with exactly one word: alive',
  thinking: false,
  maxTokens: 16,
});
ok('chat', `${MODELS.extract} → "${reply.trim()}"`);

// 2. Adjudication model. This is where the real reasoning happens later.
const verdict = await chat({
  model: MODELS.adjudicate,
  system: 'You rule on whether two statements conflict. Answer with JSON: {"conflict": boolean}.',
  user: 'A: "The dev server runs on port 3000." B: "The dev server runs on port 4000."',
  json: true,
  maxTokens: 64,
});
ok('adjudicate', `${MODELS.adjudicate} → ${verdict.replace(/\s+/g, ' ').trim()}`);

// 3. Embeddings + the collision-retrieval property the whole design leans on:
//    a superseded claim and its replacement look ALMOST IDENTICAL to a vector
//    store. That is precisely why naive RAG memory serves stale facts - it
//    cannot tell an update from a duplicate. We must not rely on distance alone.
const [oldClaim, newClaim, unrelated] = await embed(MODELS.embed, [
  'The dev server runs on port 3000.',
  'The dev server runs on port 4000.',
  'Joy prefers teal and slate in his UI work.',
]);
const conflictSim = cosine(oldClaim!, newClaim!);
const unrelatedSim = cosine(oldClaim!, unrelated!);
ok('embed', `${MODELS.embed} → dim ${oldClaim!.length}`);
ok('cosine', `stale-vs-current ${conflictSim.toFixed(4)} | unrelated ${unrelatedSim.toFixed(4)}`);

console.log(
  `\n  \x1b[2mThe two contradictory claims sit at ${conflictSim.toFixed(3)} similarity.\n` +
    `  A top-k retriever cannot tell which one is DEAD. That is the bug we exist to fix.\x1b[0m`,
);

console.log(
  `\n  cache: ${cacheStats.hits} hit / ${cacheStats.misses} miss` +
    `   elapsed: ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
console.log(`  \x1b[2mRe-run this - it should be all hits, zero network, zero spend.\x1b[0m\n`);
