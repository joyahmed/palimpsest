/**
 * Watch a memory revise itself.
 *
 *   pnpm ingest
 *
 * Five sessions, four weeks. Facts change. Run it and watch the moment the memory
 * notices - not retrieves harder, NOTICES - that something it believes has died.
 */

import { rmSync } from 'node:fs';
import { SESSIONS } from '../data/sessions.js';
import { ClaimStore } from '../memory/store.js';
import { remember } from '../memory/remember.js';
import { cacheStats } from '../qwen/client.js';
import { decayedConfidence } from '../memory/types.js';

const DB = './palimpsest.db';
rmSync(DB, { force: true });
const store = new ClaimStore(DB);

const DIM = '\x1b[2m';
const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

console.log('');
for (const session of SESSIONS) {
  const { added, revisions } = await remember(store, session);

  console.log(`${BOLD}  ${session.date}${R} ${DIM}(${session.id})${R}`);

  for (const c of added) {
    const killedHere = revisions.find((r) => r.incoming.id === c.id);
    console.log(`    ${GREEN}+${R} ${c.content} ${DIM}· ${c.kind}${R}`);

    for (const k of killedHere?.killed ?? []) {
      console.log(`      ${RED}✗ SUPERSEDED${R} ${DIM}${strike(k.claim.content)}${R}`);
      console.log(`        ${DIM}${k.reason}${R}`);
    }
  }

  for (const r of revisions.filter((x) => x.duplicateOf.length > 0)) {
    console.log(
      `    ${YELLOW}=${R} ${DIM}"${r.incoming.content}"${R}\n` +
        `      ${DIM}already known - not stored twice${R}`,
    );
  }
  console.log('');
}

// ---------------------------------------------------------------- what survives

const now = new Date('2026-07-11').getTime();
const all = store.all();
const dead = all.filter((c) => c.status !== 'active');
const believed = store.believed(now, 0);

console.log(`${BOLD}  WHAT THE MEMORY BELIEVES NOW${R}\n`);
for (const c of believed) {
  const conf = decayedConfidence(c, now);
  const bar = '▓'.repeat(Math.round(conf * 10)).padEnd(10, '░');
  console.log(`    ${DIM}${bar}${R} ${conf.toFixed(2)}  ${c.content}`);
}

console.log(`\n${BOLD}  WHAT IT USED TO BELIEVE, AND WHY IT STOPPED${R}\n`);
if (dead.length === 0) {
  console.log(`    ${RED}Nothing died. Adjudication is not firing - investigate.${R}`);
}
for (const c of dead) {
  const died = c.supersededAt ? new Date(c.supersededAt).toISOString().slice(0, 10) : '?';
  console.log(`    ${DIM}${strike(c.content)}${R}`);
  console.log(`      ${DIM}died ${died} - ${c.deathReason}${R}`);
}

console.log(
  `\n${BOLD}  ${believed.length} believed · ${dead.length} superseded · nothing deleted${R}\n` +
    `${DIM}  The dead claims are still here. That is the point - you can always ask what\n` +
    `  the memory used to think, and exactly when it changed its mind.${R}\n`,
);
console.log(`${DIM}  cache: ${cacheStats.hits} hit / ${cacheStats.misses} miss${R}\n`);

store.close();

/** Unicode strike-through - the corpse stays legible. */
function strike(s: string): string {
  return [...s].map((ch) => ch + '̶').join('');
}
