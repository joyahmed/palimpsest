/**
 * The heart of Palimpsest.
 *
 * A new claim arrives. Before it is stored, we ask: does this KILL anything I
 * already believe?
 *
 * Note carefully what cosine is doing here and what it is NOT. It shortlists -
 * turning "compare against every claim I hold" into "compare against these five".
 * That is all it can do, because it cannot tell a contradiction from a paraphrase
 * (we measured: 0.93 vs 0.91 - the contradiction scored HIGHER). The ruling itself
 * requires something that can read both claims and reason about whether they can
 * both be true. That costs a model call, and it is the one place in this system
 * where reasoning genuinely earns its price.
 *
 * The output is not a deletion. A superseded claim is retained, linked to the
 * claim that killed it, stamped with the date and the reason. You can always ask
 * the memory what it used to believe, and when it stopped.
 */

import { z } from 'zod';
import { MODELS } from '../qwen/models.js';
import { chat } from '../qwen/client.js';
import type { Claim } from './types.js';

/**
 * How a new claim relates to one we already hold.
 *
 * `supersedes` is the load-bearing one and the prompt is deliberately strict about
 * it: a claim only supersedes another if THEY CANNOT BOTH BE TRUE. Not "is newer".
 * Not "is about the same thing". A memory that kills a claim every time a related
 * one shows up doesn't forget - it amnesiacs.
 */
export type Relation =
  /** The new claim makes the old one FALSE. They cannot coexist. The old one dies. */
  | 'supersedes'
  /** Same fact, restated. Both true. Refresh the old one's confidence instead. */
  | 'duplicate'
  /** Adds detail without contradicting. Both stay alive. */
  | 'refines'
  /** Same topic, but both can be true. Leave it alone. */
  | 'unrelated';

const SYSTEM = `You are the adjudicator for a memory system.

A NEW claim has arrived. You are given claims the memory ALREADY holds that are
semantically near it. For each, rule on how the new claim relates to it.

RELATIONS:
- supersedes  The new claim makes the old one FALSE. They CANNOT both be true.
              The old claim dies.
              e.g. old "dev server on port 3000" + new "dev server on port 4000"
              e.g. old "we use Postgres"        + new "we use SQLite, not Postgres"
- duplicate   The same fact, restated. Both true. No new information.
              e.g. old "we use SQLite" + new "the project uses SQLite as its database"
- refines     Adds detail. Does NOT contradict. Both remain true.
              e.g. old "we dropped Docker" + new "we dropped Docker because of build times"
- unrelated   Same topic, but both can be true at once. Leave the old claim alone.
              e.g. old "port 3000 collided with another project" + new "dev server on port 4000"
                   (one explains WHY, the other states the new value - both true)

THE RULE THAT MATTERS MOST:
Only rule 'supersedes' if the two claims CANNOT BOTH BE TRUE. Being newer is not
enough. Being about the same subject is not enough. If both can be true at the same
time, it is NOT a supersession. A memory that kills a claim every time a related one
arrives does not forget - it destroys.

BE CAREFUL WITH EVENTS. A thing that HAPPENED cannot become false. "The migration
ran on the 3rd" is never superseded by anything. The past is fixed.

BE CAREFUL WITH TIME. You are told when each claim was observed. A claim observed
EARLIER cannot supersede one observed LATER - that would be the memory travelling
backwards. If the new claim is older than the one it contradicts, rule 'unrelated'
and let the newer belief stand.

Return JSON:
{"rulings": [{"id": string, "relation": "supersedes"|"duplicate"|"refines"|"unrelated", "reason": string}]}

'reason' is one plain sentence a human will read in an audit log. Write it for them,
not for a machine. e.g. "The port moved to 4000 on 2 Jul; 3000 was abandoned."`;

const Schema = z.object({
  rulings: z.array(
    z.object({
      id: z.string(),
      relation: z.enum(['supersedes', 'duplicate', 'refines', 'unrelated']),
      reason: z.string(),
    }),
  ),
});

export interface Ruling {
  id: string;
  relation: Relation;
  reason: string;
}

function describe(c: Claim & { sim?: number }): string {
  const date = new Date(c.observedAt).toISOString().slice(0, 10);
  return `- id: ${c.id}\n  observed: ${date}\n  kind: ${c.kind}\n  claim: "${c.content}"`;
}

/**
 * Rule on a new claim against the claims it might collide with.
 * Returns one ruling per candidate. Candidates with no ruling are treated as unrelated.
 */
export async function adjudicate(
  incoming: { content: string; kind: string; observedAt: number },
  candidates: Array<Claim & { sim: number }>,
): Promise<Ruling[]> {
  if (candidates.length === 0) return [];

  const incomingDate = new Date(incoming.observedAt).toISOString().slice(0, 10);

  const user = `NEW CLAIM
  observed: ${incomingDate}
  kind: ${incoming.kind}
  claim: "${incoming.content}"

CLAIMS ALREADY HELD (semantically nearest - they may or may not actually collide):
${candidates.map(describe).join('\n')}

Rule on each. Return one ruling per id above.`;

  const raw = await chat({
    model: MODELS.adjudicate,
    system: SYSTEM,
    user,
    json: true,
    // Thinking ON. This is the one call in the system that DECIDES something -
    // whether a belief lives or dies. It is worth the reasoning tokens.
    temperature: 0,
  });

  const parsed = Schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Adjudication returned malformed JSON: ${parsed.error.message}`);
  }

  // Guard rail, independent of the model: a claim observed EARLIER may never kill
  // one observed LATER. The prompt says so, but prompts are requests, not
  // guarantees - and a memory that can travel backwards in time is worse than one
  // that never forgets at all.
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return parsed.data.rulings.filter((r) => {
    const target = byId.get(r.id);
    if (!target) return false;
    if (r.relation === 'supersedes' && incoming.observedAt < target.observedAt) return false;
    return true;
  });
}
