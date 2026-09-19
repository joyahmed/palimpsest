/**
 * Give retrieval to claims that were written without it.
 *
 * A store from the private predecessor holds months of real beliefs and not one vector:
 * that design handed the agent the whole belief set and let it look. This one retrieves
 * by embedding, so until those claims are embedded `believe` cannot reach them and
 * `remember` cannot collide with them - a memory that is full and answers nothing.
 *
 * Local embedder, batches of ten, idempotent: only active claims with no vector are
 * touched, so running it twice is free. Run once after pulling this repo over an
 * existing memory file: `pnpm backfill`.
 */

import { ClaimStore } from './store.js';
import { MODELS } from '../qwen/models.js';
import { embed } from '../qwen/client.js';

export async function backfillEmbeddings(store: ClaimStore): Promise<number> {
  const todo = store.unembedded();
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const vectors = await embed(MODELS.embed, batch.map((c) => c.content));
    batch.forEach((c, n) => store.setEmbedding(c.id, vectors[n]!));
  }
  return todo.length;
}
