/**
 * The baseline: naive RAG memory. The thing everyone else in this track is shipping.
 *
 * This is deliberately a FAIR fight, and that matters more than anything else in
 * the benchmark. It uses:
 *   - the same extraction (same model, same prompt, same atomic claims)
 *   - the same embeddings (text-embedding-v4)
 *   - the same Qwen model to answer the question
 *
 * Exactly ONE thing differs: it APPENDS instead of adjudicating, and retrieves by
 * pure cosine similarity instead of by belief.
 *
 * If we cripple the baseline, the number we publish is worthless - and worse, we
 * would never find out that our own idea doesn't work. The baseline exists to give
 * our thesis a real chance to lose.
 */

import { ClaimStore } from '../memory/store.js';
import { extractClaims } from '../memory/extract.js';
import { MODELS } from '../qwen/models.js';
import { chat, embed } from '../qwen/client.js';
import type { Session } from '../data/sessions.js';

const ANSWER_SYSTEM = `You answer questions using ONLY the memories provided.

Be direct and brief - a value, a name, a yes or no. Do not hedge, do not explain,
do not list alternatives. If the memories genuinely do not contain the answer, say
exactly: UNKNOWN`;

/** Build a naive memory: extract, embed, append. No adjudication. Nothing ever dies. */
export async function buildBaseline(sessions: Session[], dbPath: string): Promise<ClaimStore> {
  const store = new ClaimStore(dbPath);

  for (const session of sessions) {
    const observedAt = new Date(session.date).getTime();
    const extracted = await extractClaims(session.transcript);
    if (extracted.length === 0) continue;

    const vectors = await embed(
      MODELS.embed,
      extracted.map((c) => c.content),
    );

    for (const [i, e] of extracted.entries()) {
      // The whole baseline, right here: append. Never check. Never kill.
      store.add({
        content: e.content,
        kind: e.kind,
        subject: e.subject,
        sourceSession: session.id,
        sourceQuote: e.quote,
        observedAt,
        confidence: e.confidence,
        embedding: vectors[i],
      });
    }
  }

  return store;
}

/**
 * Answer a question the way a naive RAG memory does: embed it, take the top-k most
 * similar memories, hand them to the model.
 *
 * Note there is no notion of "current" here. There cannot be - every claim is
 * `active`, because nothing in this system is capable of marking one dead.
 */
export async function answerNaive(store: ClaimStore, question: string, k = 5): Promise<string> {
  const [qv] = await embed(MODELS.embed, [question]);
  const hits = store.collisionCandidates(qv!, k, 0.0);

  const context = hits.map((h) => `- ${h.content}`).join('\n');

  return (
    await chat({
      model: MODELS.adjudicate,
      system: ANSWER_SYSTEM,
      user: `MEMORIES:\n${context}\n\nQUESTION: ${question}`,
      thinking: false,
      temperature: 0,
      maxTokens: 64,
    })
  ).trim();
}

/**
 * Answer the way Palimpsest does.
 *
 * Two differences, and only two:
 *   1. Dead claims are not retrievable. They were superseded, and the store knows it.
 *   2. Surviving claims carry their decayed confidence into the prompt, so the model
 *      knows which beliefs are fresh and which are rotting.
 */
export async function answerPalimpsest(
  store: ClaimStore,
  question: string,
  now: number,
  k = 5,
): Promise<string> {
  const [qv] = await embed(MODELS.embed, [question]);

  // collisionCandidates() only ever returns ACTIVE claims - the dead are already gone.
  const hits = store.collisionCandidates(qv!, k, 0.0);
  const believed = new Map(store.believed(now, 0).map((c) => [c.id, c.confidence]));

  const context = hits
    .map((h) => {
      const conf = believed.get(h.id) ?? 0;
      const age = Math.round((now - h.observedAt) / 86_400_000);
      return `- ${h.content}  [confidence ${conf.toFixed(2)}, ${age}d old]`;
    })
    .join('\n');

  return (
    await chat({
      model: MODELS.adjudicate,
      system: `${ANSWER_SYSTEM}

Each memory carries a confidence. Low confidence means the belief has decayed and
may be stale - weigh it accordingly.`,
      user: `MEMORIES:\n${context}\n\nQUESTION: ${question}`,
      thinking: false,
      temperature: 0,
      maxTokens: 64,
    })
  ).trim();
}
