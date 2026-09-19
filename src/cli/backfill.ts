/**
 *   pnpm backfill      embed every active claim that has no vector yet (local, no key)
 *
 * For a memory file written by the private predecessor, or by any earlier build that
 * stored claims without embeddings. Idempotent.
 */

import { ClaimStore } from '../memory/store.js';
import { backfillEmbeddings } from '../memory/backfill.js';
import { DEFAULT_DB } from '../paths.js';

const store = new ClaimStore(process.env.PALIMPSEST_DB ?? DEFAULT_DB);
const before = store.unembedded().length;
const n = await backfillEmbeddings(store);
console.log(n === 0 ? `Nothing to do - every active claim is embedded.` : `Embedded ${n} of ${before} claims that had no vector. believe and remember can reach them now.`);
store.close();
