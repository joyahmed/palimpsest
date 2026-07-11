/**
 * A toy you can break.
 *
 *   pnpm why "sentence one" "sentence two"
 *   pnpm why            (runs the built-in examples)
 *
 * Prints the cosine similarity between two claims, and - more importantly -
 * whether a naive top-k retriever could tell them apart.
 *
 * The point of this script is to build intuition for the ONE fact the whole
 * project rests on: contradiction and agreement look almost identical to a
 * vector store. Similarity is not truth.
 */

import { MODELS } from '../qwen/models.js';
import { embed, cosine } from '../qwen/client.js';

const PAIRS: [string, string, string][] = [
  // label                    a                                        b
  ['DIRECT CONTRADICTION', 'The dev server runs on port 3000.', 'The dev server runs on port 4000.'],
  ['SUPERSEDED FACT', 'Joy is working on the payroll branch.', 'Joy is working on the attendance branch.'],
  ['REVERSED DECISION', 'We decided to use Postgres.', 'We decided not to use Postgres.'],
  ['PARAPHRASE (same truth)', 'The API listens on port 3000.', 'Port 3000 is where the API listens.'],
  ['UNRELATED', 'The dev server runs on port 3000.', 'Joy prefers teal and slate in his UI work.'],
];

const args = process.argv.slice(2);
const pairs: [string, string, string][] =
  args.length >= 2 ? [['YOUR PAIR', args[0]!, args[1]!]] : PAIRS;

const texts = pairs.flatMap(([, a, b]) => [a, b]);
const vectors = await embed(MODELS.embed, texts);

console.log('');
for (const [i, [label, a, b]] of pairs.entries()) {
  const sim = cosine(vectors[i * 2]!, vectors[i * 2 + 1]!);

  // 0.85 is a generous-but-typical retrieval threshold. Anything above it, a
  // top-k retriever will happily return BOTH of - with no idea one may be dead.
  const bothRetrieved = sim >= 0.85;
  const bar = '█'.repeat(Math.round(sim * 40)).padEnd(40, '·');
  const flag = bothRetrieved
    ? '\x1b[31mRETRIEVER RETURNS BOTH - cannot tell which is true\x1b[0m'
    : '\x1b[2mdistinguishable\x1b[0m';

  console.log(`  \x1b[1m${label}\x1b[0m`);
  console.log(`    A: ${a}`);
  console.log(`    B: ${b}`);
  console.log(`    ${bar} ${sim.toFixed(4)}  ${flag}\n`);
}

console.log(
  '\x1b[2m  Notice: CONTRADICTION and PARAPHRASE score about the same.\n' +
    '  A vector store literally cannot distinguish "B updates A" from "B repeats A".\n' +
    '  That is not a tuning problem. It is the wrong question.\x1b[0m\n',
);
