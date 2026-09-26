/**
 * Unit tests for what the recall hook SAYS about a store that shows nothing.
 *
 * "The memory is EMPTY" is a claim, and it is the one an agent acts on hardest: it
 * stops looking. A store holding only events, or only another project's facts, shows
 * nothing at session start yet holds plenty - and once said EMPTY, which is a lie by
 * omission. These pin the difference between a store that is empty and one that is
 * merely withholding.
 *
 * recall.ts runs on import and exits, so each case runs it as the hook does: a child
 * process against a throwaway database.
 *
 *   node --test --experimental-test-module-mocks --import tsx src/cli/recall.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaimStore } from '../memory/store.js';
import type { ClaimKind } from '../memory/types.js';

const RECALL = new URL('./recall.ts', import.meta.url).pathname;

/** Seed a fresh store with `claims`, run recall on it as the hook would, return the text. */
function recall(claims: Array<{ kind: ClaimKind; projects?: string[] }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-recall-'));
  try {
    const db = join(dir, 'memory.db');
    const store = new ClaimStore(db);
    for (const [i, c] of claims.entries()) {
      store.add({
        content: `claim ${i}`,
        kind: c.kind,
        subject: 'test',
        sourceSession: 's1',
        sourceQuote: `claim ${i}`,
        observedAt: Date.now(),
        confidence: 1,
        projects: c.projects,
      });
    }
    store.close();
    return execFileSync(process.execPath, ['--import', 'tsx', RECALL, '--plain'], {
      encoding: 'utf8',
      env: { ...process.env, PALIMPSEST_DB: db, PALIMPSEST_PROJECT: 'here', PALIMPSEST_RECALL_ALL: '' },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a store with nothing in it says EMPTY', () => {
  const out = recall([]);
  assert.match(out, /The memory is EMPTY/);
  assert.doesNotMatch(out, /HELD BUT NOT SHOWN/);
});

test('a store holding only events is NOT empty - it says what it withheld', () => {
  const out = recall([{ kind: 'event' }]);
  assert.doesNotMatch(out, /EMPTY/);
  assert.match(out, /HELD BUT NOT SHOWN: 1 of kind `event`, `decision`\./);
  assert.match(out, /^PROTOCOL/m);
});

test("a store holding only another project's facts is NOT empty", () => {
  const out = recall([{ kind: 'config', projects: ['elsewhere'] }]);
  assert.doesNotMatch(out, /EMPTY/);
  assert.match(out, /HELD BUT NOT SHOWN: 1 about other projects \(this session is in `here`\)\./);
  assert.doesNotMatch(out, /^(BELIEVED|VERIFIED|DOUBTED|CONTRADICTED)/m);
});
