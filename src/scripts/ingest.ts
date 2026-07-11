/**
 * Ingest the sessions and show what came out.
 *
 *   pnpm ingest
 *
 * This slice does extraction ONLY - no adjudication yet. That is deliberate: the
 * point is to see the store fill up with contradictory claims and NOT notice.
 * Right now, this IS an append-only memory. It will hold "port 3000" and "port
 * 4000" side by side, both marked active, both fully believed.
 *
 * That is the bug, reproduced in our own system, on purpose. Next slice kills it.
 */

import { rmSync } from 'node:fs';
import { SESSIONS } from '../data/sessions.js';
import { extractClaims } from '../memory/extract.js';
import { ClaimStore } from '../memory/store.js';
import { MODELS } from '../qwen/models.js';
import { embed, cosine, cacheStats } from '../qwen/client.js';
import { decayedConfidence, HALF_LIFE_DAYS } from '../memory/types.js';

const DB = './palimpsest.db';
rmSync(DB, { force: true }); // fresh every run - this is a demo, not a database
const store = new ClaimStore(DB);

const KIND_COLOR: Record<string, string> = {
  identity: '\x1b[35m',
  preference: '\x1b[36m',
  decision: '\x1b[33m',
  config: '\x1b[31m',
  state: '\x1b[34m',
  event: '\x1b[32m',
};

console.log('');
for (const session of SESSIONS) {
  const observedAt = new Date(session.date).getTime();
  const extracted = await extractClaims(session.transcript);

  const vectors = await embed(
    MODELS.embed,
    extracted.map((c) => c.content),
  );

  console.log(`\x1b[1m  ${session.date}\x1b[0m \x1b[2m(${session.id})\x1b[0m`);
  for (const [i, c] of extracted.entries()) {
    store.add({
      content: c.content,
      kind: c.kind,
      subject: c.subject,
      sourceSession: session.id,
      sourceQuote: c.quote,
      observedAt,
      confidence: c.confidence,
      embedding: vectors[i],
    });
    const col = KIND_COLOR[c.kind] ?? '';
    console.log(
      `    ${col}${c.kind.padEnd(10)}\x1b[0m ${c.content}` +
        `  \x1b[2m[${c.subject}]\x1b[0m`,
    );
  }
  console.log('');
}

// ---------------------------------------------------------------- the punchline

const now = new Date('2026-07-11').getTime();
const all = store.all();

console.log(`\x1b[1m  ${all.length} claims stored. All active. All believed.\x1b[0m\n`);

/**
 * Find collisions SEMANTICALLY, not by subject label.
 *
 * The first version of this grouped by exact `subject` string - and missed two of
 * the three real contradictions. The extractor had labelled the same topic
 * "git branch", "Git branch" and "current git branch" across three sessions,
 * because each session is extracted independently and it has no memory of what it
 * called things last time.
 *
 * That is worth sitting with: we asked the model, in the prompt, to be consistent.
 * It could not be. So contradictions cannot be found by matching labels either -
 * not by string equality, not by asking nicely. Cosine at least clusters them.
 * But cosine still cannot tell you WHICH ONE IS DEAD (0.93 contradiction vs 0.91
 * paraphrase, remember). Only reasoning can. That is the next slice.
 */
const COLLISION_THRESHOLD = 0.62;
const clusters: (typeof all)[] = [];
for (const claim of all) {
  if (!claim.embedding) continue;
  const hit = clusters.find((cluster) =>
    cluster.some((other) => cosine(claim.embedding!, other.embedding!) >= COLLISION_THRESHOLD),
  );
  if (hit) hit.push(claim);
  else clusters.push([claim]);
}

const collisions = clusters
  .filter((c) => c.length > 1)
  .map((cs) => [cs[0]!.subject, cs] as const);

if (collisions.length) {
  console.log('\x1b[31m\x1b[1m  UNRESOLVED COLLISIONS - the memory believes all of these:\x1b[0m\n');
  for (const [subject, cs] of collisions) {
    console.log(`  \x1b[1m~ ${subject}\x1b[0m`);
    for (const c of [...cs].sort((a, b) => a.observedAt - b.observedAt)) {
      const conf = decayedConfidence(c, now);
      const date = new Date(c.observedAt).toISOString().slice(0, 10);
      console.log(
        `    \x1b[2m${date}\x1b[0m  ${c.content}\n` +
          `              \x1b[2mconfidence ${conf.toFixed(2)} · ${c.kind} · half-life ${HALF_LIFE_DAYS[c.kind]}d · status ${c.status}\x1b[0m`,
      );
    }
    console.log('');
  }
  console.log(
    '\x1b[2m  Both are "active". Both are retrievable. Nothing here knows one is DEAD.\n' +
      '  Ask this memory what port the server runs on and it flips a coin.\n\n' +
      '  This is every agent memory shipping today - including, right now, ours.\x1b[0m\n',
  );
} else {
  console.log('\x1b[33m  No collisions detected - check the extraction, that is suspicious.\x1b[0m\n');
}

console.log(`\x1b[2m  cache: ${cacheStats.hits} hit / ${cacheStats.misses} miss\x1b[0m\n`);
store.close();
