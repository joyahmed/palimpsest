/**
 * Ask the world about every belief that carries a probe.
 *
 * Decay measures age, and age is a proxy for truth only for a belief that started true.
 * A probe is not a proxy: it is the fact, read out of the world. A claim just checked can be
 * used without spending a lookup; one the world contradicts is wrong at any age.
 *
 * This EXECUTES the probe strings stored in the database - which is why it is a command you
 * run on stakes (before a deploy, before trusting a port or a host), and never something the
 * session-start hook does.
 *
 *   pnpm verify             check everything, print what the world said
 *   pnpm verify --quiet     only what FAILED
 */

import { ClaimStore } from '../memory/store.js';
import { DEFAULT_DB } from '../paths.js';

const QUIET = process.argv.includes('--quiet');
const store = new ClaimStore(process.env.PALIMPSEST_DB ?? DEFAULT_DB);

if (store.checkable().length === 0) {
  console.log('No claim carries a probe yet, so there is nothing to check.\n');
  console.log('A probe is a read-only command that reads the fact out of the world, plus the');
  console.log('substring its output must contain. Attach one when you assert a checkable fact:');
  console.log('  probe:  grep -n "^PORT=" apps/api/.env');
  console.log('  expect: 3001');
  process.exit(0);
}

const results = store.verifyAll(Date.now());
const passed = results.filter((r) => r.result === 'passed');
const failed = results.filter((r) => r.result === 'failed');
const unknown = results.filter((r) => r.result === 'unknown');
const line = (mark: string, c: { id: string; content: string }) =>
  `  ${mark} [${c.id.slice(0, 8)}] ${c.content.replace(/\s+/g, ' ').slice(0, 90)}`;

console.log(`\nVerification - ${results.length} of ${store.active().length} beliefs carry a probe\n`);
if (failed.length) {
  console.log(`CONTRADICTED BY THE WORLD - ${failed.length}`);
  console.log('  These are wrong, not old. Supersede each with what the probe actually found.');
  for (const r of failed) {
    console.log(line('⛔', r.claim));
    console.log(`       expected "${r.claim.expect}" · probe said: ${r.output.replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  console.log('');
}
if (unknown.length && !QUIET) {
  console.log(`COULD NOT CHECK - ${unknown.length}`);
  console.log('  The probe did not run. This says nothing about the claim, which falls back to decay.');
  for (const r of unknown) console.log(line('？', r.claim));
  console.log('');
}
if (passed.length && !QUIET) {
  console.log(`CONFIRMED - ${passed.length}`);
  console.log('  Read out of the world just now. Usable without spending a lookup.');
  for (const r of passed) console.log(line('✅', r.claim));
  console.log('');
}
console.log(`${passed.length} confirmed · ${failed.length} contradicted · ${unknown.length} uncheckable right now`);
store.close();
// Only a contradicted belief needs someone to act, so it alone changes the exit code.
process.exit(failed.length > 0 ? 1 : 0);
