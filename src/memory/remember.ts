/**
 * The full pipeline: a conversation goes in, a REVISED belief-set comes out.
 *
 *   transcript
 *     → extract      atomic, provenanced claims
 *     → embed        so we can shortlist what each might collide with
 *     → shortlist    cosine, top-k - cheap, and only a candidate generator
 *     → adjudicate   Qwen rules on what dies (the only step that DECIDES)
 *     → apply        supersede the dead, keep the body, record the reason
 *
 * The difference between this and every other memory system is one word: `apply`.
 */

import { ClaimStore } from './store.js';
import { extractClaims } from './extract.js';
import { adjudicate, type Ruling } from './adjudicate.js';
import { MODELS } from '../qwen/models.js';
import { embed } from '../qwen/client.js';
import type { Claim } from './types.js';

export interface Revision {
  /** The claim that arrived. */
  incoming: Claim;
  /** What it killed, and why. */
  killed: Array<{ claim: Claim; reason: string }>;
  /** Facts it merely restated - stored as nothing, because they add nothing. */
  duplicateOf: Claim[];
}

export interface RememberResult {
  sessionId: string;
  added: Claim[];
  revisions: Revision[];
}

export async function remember(
  store: ClaimStore,
  session: { id: string; date: string; transcript: string },
): Promise<RememberResult> {
  const observedAt = new Date(session.date).getTime();

  const extracted = await extractClaims(session.transcript);
  if (extracted.length === 0) return { sessionId: session.id, added: [], revisions: [] };

  const vectors = await embed(
    MODELS.embed,
    extracted.map((c) => c.content),
  );

  const added: Claim[] = [];
  const revisions: Revision[] = [];

  for (const [i, e] of extracted.entries()) {
    const embedding = vectors[i]!;

    // Cosine's entire job: turn "compare against everything I believe" into
    // "compare against these five". It cannot rule; it can only shortlist.
    const candidates = store.collisionCandidates(embedding, 5, 0.5);

    let rulings: Ruling[] = [];
    if (candidates.length > 0) {
      rulings = await adjudicate(
        { content: e.content, kind: e.kind, observedAt },
        candidates,
      );
    }

    const byId = new Map(candidates.map((c) => [c.id, c as Claim]));
    const duplicates = rulings.filter((r) => r.relation === 'duplicate');

    // A duplicate carries no new information. Storing it would inflate the memory
    // with restatements and - worse - make the same fact compete with itself at
    // retrieval time. Instead we let the existing claim stand.
    if (duplicates.length > 0) {
      revisions.push({
        incoming: { ...e, id: '(not stored)', status: 'active', sourceSession: session.id, sourceQuote: e.quote, observedAt, embedding } as Claim,
        killed: [],
        duplicateOf: duplicates.map((d) => byId.get(d.id)!).filter(Boolean),
      });
      continue;
    }

    const claim = store.add({
      content: e.content,
      kind: e.kind,
      subject: e.subject,
      sourceSession: session.id,
      sourceQuote: e.quote,
      observedAt,
      confidence: e.confidence,
      embedding,
    });
    added.push(claim);

    // THE LINE THIS WHOLE PROJECT EXISTS FOR.
    // The old claim is not deleted. It is marked dead, linked to its killer, and
    // stamped with the date and the reason - so the memory can always be asked
    // what it used to believe, and when it stopped.
    const kills = rulings.filter((r) => r.relation === 'supersedes');
    const killed: Revision['killed'] = [];
    for (const k of kills) {
      const victim = byId.get(k.id);
      if (!victim) continue;
      store.supersede(victim.id, claim.id, k.reason, observedAt);
      killed.push({ claim: victim, reason: k.reason });
    }

    if (killed.length > 0) {
      revisions.push({ incoming: claim, killed, duplicateOf: [] });
    }
  }

  return { sessionId: session.id, added, revisions };
}
