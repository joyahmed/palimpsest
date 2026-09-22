/**
 * Unit tests for the adjudicator's NON-MODEL logic.
 *
 * The model call is stubbed. That is the point: every rule below is a guard the
 * code applies to whatever the model returns, and each one exists because a model
 * can return something wrong. `temperature: 0` is not deterministic on a large
 * MoE - client.ts says so in its own words, and a live doctor cannot reliably
 * catch a non-determinism bug because a passing run proves nothing about the next
 * one. These tests can, because they fix the model's answer and vary only the code.
 *
 *   node --test --experimental-test-module-mocks --import tsx src/memory/adjudicate.test.ts
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Claim } from './types.js';

let reply = '';
let calls = 0;

mock.module('../qwen/client.js', {
  namedExports: {
    chat: async () => {
      calls++;
      return reply;
    },
  },
});

const { adjudicate } = await import('./adjudicate.js');

const DAY = 86_400_000;
const T = Date.UTC(2026, 0, 10);

function claim(id: string, over: Partial<Claim> = {}): Claim & { sim: number } {
  return {
    id,
    content: `claim ${id}`,
    kind: 'config',
    subject: 'test',
    sourceSession: 's1',
    sourceQuote: 'q',
    observedAt: T,
    status: 'active',
    confidence: 1,
    sim: 0.9,
    ...over,
  } as Claim & { sim: number };
}

const incoming = (over: Partial<{ content: string; kind: string; observedAt: number }> = {}) => ({
  content: 'the dev server runs on port 4000',
  kind: 'config',
  observedAt: T,
  ...over,
});

const rulings = (...rs: Array<{ id: string; relation: string; reason?: string }>) =>
  JSON.stringify({ rulings: rs.map((r) => ({ reason: 'because', ...r })) });

test('no candidates: returns empty and never spends a model call', async () => {
  calls = 0;
  reply = rulings({ id: '1', relation: 'supersedes' });
  assert.deepEqual(await adjudicate(incoming(), []), []);
  assert.equal(calls, 0, 'adjudicate must not call the model with nothing to rule on');
});

test('ordinals go out, real claim ids come back', async () => {
  reply = rulings({ id: '1', relation: 'supersedes' }, { id: '2', relation: 'refines' });
  const out = await adjudicate(incoming(), [claim('uuid-aaa'), claim('uuid-bbb')]);
  assert.deepEqual(
    out.map((r) => [r.id, r.relation]),
    [['uuid-aaa', 'supersedes'], ['uuid-bbb', 'refines']],
    'the ordinal is a wire format; callers must only ever see real ids',
  );
});

test('a ruling on an ordinal that was never offered is dropped as a hallucination', async () => {
  reply = rulings({ id: '1', relation: 'refines' }, { id: '7', relation: 'supersedes' });
  const out = await adjudicate(incoming(), [claim('uuid-aaa')]);
  assert.deepEqual(out.map((r) => r.id), ['uuid-aaa']);
});

test('a claim observed EARLIER may never supersede one observed LATER', async () => {
  reply = rulings({ id: '1', relation: 'supersedes' });
  const out = await adjudicate(
    incoming({ observedAt: T - DAY }),
    [claim('uuid-newer', { observedAt: T })],
  );
  assert.deepEqual(out, [], 'memory must not travel backwards in time');
});

test('the same ruling forwards in time is kept', async () => {
  reply = rulings({ id: '1', relation: 'supersedes' });
  const out = await adjudicate(
    incoming({ observedAt: T + DAY }),
    [claim('uuid-older', { observedAt: T })],
  );
  assert.deepEqual(out.map((r) => r.relation), ['supersedes']);
});

test('the time guard only blocks supersedes, not the harmless relations', async () => {
  reply = rulings({ id: '1', relation: 'refines' });
  const out = await adjudicate(
    incoming({ observedAt: T - DAY }),
    [claim('uuid-newer', { observedAt: T })],
  );
  assert.equal(out.length, 1, 'refines does not kill anything, so the guard must not fire');
});

test('malformed model output fails loudly rather than silently ruling nothing', async () => {
  reply = JSON.stringify({ rulings: [{ id: '1', relation: 'not-a-relation', reason: 'x' }] });
  await assert.rejects(
    () => adjudicate(incoming(), [claim('uuid-aaa')]),
    /malformed JSON/i,
    'a schema failure must throw - returning [] would silently keep a dead claim alive',
  );
});
