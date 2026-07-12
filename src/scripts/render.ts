/**
 * Write the audit view to disk.
 *
 *   pnpm ingest && pnpm render     ->  dist/index.html
 *
 * Same renderer the deployed backend serves at `/`, so what you see locally is
 * exactly what a judge sees on the live URL.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { ClaimStore } from '../memory/store.js';
import { renderMemory } from '../render/html.js';

const NOW = Number(process.env.PALIMPSEST_NOW ?? new Date('2026-07-11').getTime());

const store = new ClaimStore(process.env.PALIMPSEST_DB ?? './palimpsest.db');
const all = store.all();

if (all.length === 0) {
  console.error('No claims in the store. Run `pnpm ingest` first.');
  process.exit(1);
}

// The exported page is interactive too - it just calls the DEPLOYED backend instead of
// its own origin, which is why CORS is open on the function. Open dist/index.html from
// disk and you can still contradict the live memory and watch a belief die.
const API = process.env.PALIMPSEST_API ?? 'https://palimpsest.zettabyteincorp.com';

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', renderMemory(all, NOW, { apiBase: API, interactive: true }));

const dead = all.filter((c) => c.status !== 'active').length;
console.log(`\n  dist/index.html\n  ${all.length - dead} believed · ${dead} superseded\n`);

store.close();
