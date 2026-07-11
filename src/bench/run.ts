/**
 * The benchmark.
 *
 *   pnpm bench
 *
 * Same sessions, same extraction, same embeddings, same answering model. The only
 * difference between the two systems is that one of them can kill a claim.
 *
 * Two question classes, and we report them SEPARATELY - because reporting only the
 * aggregate would let us hide the thing that would most damn us:
 *
 *   CHANGED   the fact moved. Can the memory find the current truth, or does it
 *             serve the corpse?
 *   UNCHANGED the fact never moved. Does the memory still know it - or did we
 *             build something so eager to forget that it destroys stable facts?
 *
 * A system that aces CHANGED and fails UNCHANGED is not better than append-only.
 * It is worse. That column is the one that can kill this project, so it gets
 * printed just as loudly as the one that flatters it.
 */

import { rmSync } from 'node:fs';
import { BENCH_SESSIONS as SESSIONS, BENCH_TRUTH as GROUND_TRUTH } from '../data/bench-sessions.js';
import { ClaimStore } from '../memory/store.js';
import { remember } from '../memory/remember.js';
import { buildBaseline, answerNaive, answerPalimpsest } from './baseline.js';
import { grade, type Grade } from './grade.js';
import { cacheStats } from '../qwen/client.js';

const NOW = new Date('2026-07-11').getTime();
const DIM = '\x1b[2m';
const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

const MARK: Record<Grade, string> = {
  correct: `${GREEN}✓${R}`,
  stale: `${RED}☠${R}`, // served a dead fact - the failure that matters
  wrong: `${YELLOW}?${R}`,
};

// ---------------------------------------------------------------- build both memories

rmSync('./bench-naive.db', { force: true });
rmSync('./bench-palimpsest.db', { force: true });

console.log(`\n${DIM}  building naive RAG memory (append-only)...${R}`);
const naive = await buildBaseline(SESSIONS, './bench-naive.db');

console.log(`${DIM}  building palimpsest (adjudicated)...${R}`);
const pal = new ClaimStore('./bench-palimpsest.db');
for (const s of SESSIONS) await remember(pal, s);

const deadCount = pal.all().filter((c) => c.status !== 'active').length;
console.log(
  `${DIM}  naive: ${naive.all().length} claims, 0 dead${R}\n` +
    `${DIM}  palimpsest: ${pal.all().length} claims, ${deadCount} dead${R}\n`,
);

// ---------------------------------------------------------------- ask both, grade both

interface Row {
  question: string;
  changed: boolean;
  naive: { answer: string; grade: Grade };
  pal: { answer: string; grade: Grade };
  /** The three grader votes did not agree. Counted and reported, never hidden. */
  contested: boolean;
}
const rows: Row[] = [];

for (const q of GROUND_TRUTH) {
  const [nAns, pAns] = await Promise.all([
    answerNaive(naive, q.question),
    answerPalimpsest(pal, q.question, NOW),
  ]);
  const [nG, pG] = await Promise.all([
    grade(q.question, q.truth, q.stale, nAns),
    grade(q.question, q.truth, q.stale, pAns),
  ]);

  const contested = nG.contested || pG.contested;

  rows.push({
    question: q.question,
    changed: q.stale !== null,
    naive: { answer: nAns, grade: nG.grade },
    pal: { answer: pAns, grade: pG.grade },
    contested,
  });

  console.log(
    `  ${MARK[nG.grade]} ${MARK[pG.grade]}  ${DIM}${q.question}${R}` +
      (contested ? ` ${YELLOW}(grader split)${R}` : ''),
  );
  console.log(`        ${DIM}naive:      ${nAns}${R}`);
  console.log(`        ${DIM}palimpsest: ${pAns}${R}`);
}

// ---------------------------------------------------------------- score

function score(subset: Row[], pick: (r: Row) => Grade) {
  const n = subset.length;
  const correct = subset.filter((r) => pick(r) === 'correct').length;
  const staleN = subset.filter((r) => pick(r) === 'stale').length;
  return { n, correct, staleN, pct: n ? Math.round((correct / n) * 100) : 0 };
}

const changed = rows.filter((r) => r.changed);
const unchanged = rows.filter((r) => !r.changed);

const table = [
  ['FACTS THAT CHANGED', changed],
  ['FACTS THAT NEVER CHANGED', unchanged],
  ['OVERALL', rows],
] as const;

console.log(`\n${BOLD}  RESULTS${R}\n`);
console.log(`  ${DIM}${'─'.repeat(66)}${R}`);
console.log(`  ${' '.repeat(26)} ${BOLD}${'naive RAG'.padEnd(18)}${'palimpsest'.padEnd(18)}${R}`);
console.log(`  ${DIM}${'─'.repeat(66)}${R}`);

for (const [label, subset] of table) {
  if (subset.length === 0) continue;
  const n = score([...subset], (r) => r.naive.grade);
  const p = score([...subset], (r) => r.pal.grade);
  const fmt = (s: typeof n) =>
    `${String(s.pct).padStart(3)}%  ${DIM}(${s.correct}/${s.n})${R}`.padEnd(28);
  console.log(`  ${label.padEnd(26)} ${fmt(n)}${fmt(p)}`);
}
console.log(`  ${DIM}${'─'.repeat(66)}${R}`);

const nStale = rows.filter((r) => r.naive.grade === 'stale').length;
const pStale = rows.filter((r) => r.pal.grade === 'stale').length;
console.log(
  `  ${'served a DEAD fact'.padEnd(26)} ${String(nStale).padStart(3)}   ${' '.repeat(18)}${String(pStale).padStart(3)}\n`,
);

// The line that would kill the project, printed whether it flatters us or not.
const regressions = unchanged.filter(
  (r) => r.naive.grade === 'correct' && r.pal.grade !== 'correct',
);
if (regressions.length > 0) {
  console.log(
    `${RED}${BOLD}  ⚠ REGRESSION: we FORGOT ${regressions.length} fact(s) that never changed.${R}\n` +
      `${RED}  A memory that destroys stable facts is worse than append-only, not better.${R}`,
  );
  for (const r of regressions) console.log(`${RED}    · ${r.question} → "${r.pal.answer}"${R}`);
  console.log('');
}

// The grader's own reliability, printed next to the numbers it produced. If it
// argues with itself often, every figure above is softer than it looks - and the
// reader is entitled to know that without digging.
const contestedN = rows.filter((r) => r.contested).length;
console.log(
  `${DIM}  grader: majority of 3 votes · disagreed with itself on ${contestedN}/${rows.length} questions${R}`,
);
console.log(
  `${DIM}  cache: ${cacheStats.hits} hit / ${cacheStats.misses} miss / ${cacheStats.coalesced} coalesced${R}\n`,
);

naive.close();
pal.close();
