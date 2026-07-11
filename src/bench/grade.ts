/**
 * The grader.
 *
 * Three outcomes, and the distinction between the last two is the entire point of
 * the benchmark:
 *
 *   CORRECT  - reported the current truth.
 *   STALE    - reported a fact that USED to be true. This is the damning one. The
 *              memory did not fail to find an answer; it found a dead one and
 *              served it with total confidence. This is the failure mode we exist
 *              to eliminate, and a benchmark that lumps it in with "wrong" would
 *              hide the only thing worth measuring.
 *   WRONG    - neither. Confused, hallucinated, or honestly said UNKNOWN.
 *
 * Graded by a model, because string matching cannot tell that "SQLite" and "we use
 * SQLite now, not Postgres" are the same answer. The grader is given the truth AND
 * the known stale value, so it can only ever be asked an easy question - which
 * keeps it honest.
 */

import { z } from 'zod';
import { MODELS } from '../qwen/models.js';
import { chat } from '../qwen/client.js';

export type Grade = 'correct' | 'stale' | 'wrong';

const SYSTEM = `You grade one answer from a memory system. Be strict and literal.

You are given: the QUESTION, the TRUE answer, the STALE answer (a fact that used to
be true but is now dead - may be "none"), and the system's ANSWER.

Grade:
- "correct" if ANSWER conveys the TRUE answer. Wording may differ freely; only the
  meaning matters. Extra correct detail is fine.
- "stale"   if ANSWER conveys the STALE answer - the fact that used to be true.
- "wrong"   if it is neither: confused, hallucinated, contradictory, or UNKNOWN.

If the answer gives BOTH the true and the stale value without committing to one
("it was 3000, now 4000" is committing; "3000 or 4000" is not), grade "wrong" -
a memory that cannot decide has not remembered anything.

Return JSON: {"grade": "correct"|"stale"|"wrong", "why": "<one short sentence>"}`;

const Schema = z.object({
  grade: z.enum(['correct', 'stale', 'wrong']),
  why: z.string(),
});

async function gradeOnce(
  question: string,
  truth: string,
  stale: string | null,
  answer: string,
  vote: number,
): Promise<{ grade: Grade; why: string }> {
  const raw = await chat({
    model: MODELS.adjudicate,
    system: SYSTEM,
    user: `QUESTION: ${question}
TRUE ANSWER: ${truth}
STALE ANSWER: ${stale ?? 'none - this fact never changed'}
SYSTEM'S ANSWER: ${answer}`,
    json: true,
    thinking: false,
    temperature: 0,
    maxTokens: 128,
    // Same prompt, independent sample. See ChatOptions.cacheSalt.
    cacheSalt: `vote-${vote}`,
  });

  const parsed = Schema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Grader returned malformed JSON: ${parsed.error.message}`);
  return parsed.data;
}

export interface GradeResult {
  grade: Grade;
  why: string;
  /** True when the three votes did not agree. Tracked and reported, not hidden. */
  contested: boolean;
}

const VOTES = 3;

/**
 * Grade by majority of three independent votes.
 *
 * WHY THIS EXISTS. v2 of the benchmark graded two systems that had returned the
 * IDENTICAL answer ("Session cookies") and marked one correct and one wrong. Same
 * input, different verdict.
 *
 * Part of that was a cache race (now fixed, see client.ts). But the deeper cause is
 * that `temperature: 0` does not make a large MoE model deterministic - so a single
 * LLM verdict is a noisy measurement, and our headline number was resting on one.
 *
 * Three samples, majority rules. Disagreements are COUNTED and REPORTED rather than
 * quietly resolved, because the rate at which the grader argues with itself is
 * exactly the error bar on everything else this benchmark claims.
 */
export async function grade(
  question: string,
  truth: string,
  stale: string | null,
  answer: string,
): Promise<GradeResult> {
  const votes = await Promise.all(
    Array.from({ length: VOTES }, (_, i) => gradeOnce(question, truth, stale, answer, i)),
  );

  const tally = new Map<Grade, number>();
  for (const v of votes) tally.set(v.grade, (tally.get(v.grade) ?? 0) + 1);

  const [winner, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const why = votes.find((v) => v.grade === winner)!.why;

  return { grade: winner, why, contested: count < VOTES };
}
