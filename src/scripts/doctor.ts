/**
 * The fast test. One command that proves the whole thing works on THIS machine,
 * right now, live - no replay cache, no key, no site.
 *
 *   pnpm test                        claude-code provider (a Max login, no key)
 *   PALIMPSEST_PROVIDER=... pnpm test   any other provider
 *
 * (`pnpm doctor` is taken: it is a built-in pnpm command and silently wins.)
 *
 * It answers one question: does palimpsest still do the thing it exists for?
 * A claim goes in, a contradicting claim goes in later, and the FIRST ONE DIES -
 * not down-ranked, gone from `believe`, present in `history` with the reason.
 * Everything else here (provider alive, embeddings, both MCP transports) is the
 * plumbing that loop stands on, checked in the order it is needed.
 *
 * Nothing it does touches a real memory file: scratch DB, scratch model cache,
 * both under the OS temp dir and removed at the end. Every model call is live,
 * on purpose - a doctor that replays yesterday's answers cannot tell you the
 * provider broke this morning.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------- environment
// provider.ts, models.ts and client.ts read these at import time, so they are
// pinned BEFORE anything from src/ is loaded (hence the dynamic imports below).

// node:sqlite prints an ExperimentalWarning on first use; not a finding, so not printed.
process.removeAllListeners('warning');

const scratch = mkdtempSync(join(tmpdir(), 'palimpsest-doctor-'));
const DB = join(scratch, 'memory.db');

if (!process.env.PALIMPSEST_PROVIDER) process.env.PALIMPSEST_PROVIDER = 'claude-code';
process.env.PALIMPSEST_DB = DB;
process.env.PALIMPSEST_CACHE_DIR = join(scratch, 'cache');
delete process.env.PALIMPSEST_CACHE_ONLY;
delete process.env.PALIMPSEST_CACHE_SEED;

const { provider } = await import('../qwen/provider.js');
const { MODELS } = await import('../qwen/models.js');
const { chat, embed, cosine, cacheStats } = await import('../qwen/client.js');
const { ClaimStore } = await import('../memory/store.js');
const { remember } = await import('../memory/remember.js');
const { answerPalimpsest } = await import('../bench/baseline.js');
const { handleMcp } = await import('../mcp/http.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = await import(
  '@modelcontextprotocol/sdk/client/stdio.js'
);
const { StreamableHTTPClientTransport } = await import(
  '@modelcontextprotocol/sdk/client/streamableHttp.js'
);

// ---------------------------------------------------------------- reporting

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let failures = 0;
const t0 = performance.now();

function since(): string {
  return `${DIM}${((performance.now() - t0) / 1000).toFixed(1)}s${RESET}`;
}

/** Run one check. A throw is a red line, not the end of the run - later checks still report. */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    console.log(`  ${GREEN}✓${RESET} ${label}  ${since()}`);
    return out;
  } catch (err) {
    failures++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${RED}✗${RESET} ${label}\n      ${RED}${msg}${RESET}`);
    return undefined;
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** What `believe` was working from - printed on a failure so the run is diagnosable after the scratch is gone. */
function believedNow(s: InstanceType<typeof ClaimStore>, at: number): string {
  return s.believed(at, 0).map((c) => `[${c.kind} ${c.confidence.toFixed(2)}] ${c.content}`).join(' | ');
}

// ---------------------------------------------------------------- the checks

console.log(`\nPalimpsest doctor  ${DIM}provider ${provider()} · scratch ${scratch}${RESET}\n`);

await step(`chat        ${MODELS.extract}`, async () => {
  const reply = await chat({ model: MODELS.extract, user: 'Reply with exactly one word: alive', thinking: false, maxTokens: 16 });
  expect(/alive/i.test(reply), `expected "alive", got "${reply.trim()}"`);
});

await step(`embed       ${MODELS.embed}`, async () => {
  const [a, b, c] = await embed(MODELS.embed, [
    'The wifi password is mango2024.',
    'The wifi password is bluefish99.',
    'Rafi has football practice on Tuesdays.',
  ]);
  expect(a && a.length > 0, 'empty vector');
  expect(cosine(a!, b!) > cosine(a!, c!), 'near pair not closer than the unrelated one');
});

// The loop the project exists for. Two sessions, a day apart, one fact that changes.
const WIFI_OLD = 'mango2024';
const WIFI_NEW = 'bluefish99';
const store = new ClaimStore(DB);
const DAY = 86_400_000;
const day1 = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
const day2 = new Date(Date.now() - 1 * DAY).toISOString().slice(0, 10);
const now = Date.now();

const first = await step('remember    a claim goes in', async () => {
  const r = await remember(store, { id: 'doctor-1', date: day1, transcript: `Joy: the home wifi password is ${WIFI_OLD}.` });
  const hit = r.added.find((c) => c.content.includes(WIFI_OLD));
  expect(hit, `no claim containing "${WIFI_OLD}" was extracted (got ${r.added.length})`);
  return hit;
});

await step('believe     answers from it', async () => {
  const a = await answerPalimpsest(store, 'What is the wifi password?', now);
  expect(a.includes(WIFI_OLD), `expected "${WIFI_OLD}" in "${a}" - believed: ${believedNow(store, now)}`);
});

const second = await step('remember    a contradicting claim kills it', async () => {
  const r = await remember(store, { id: 'doctor-2', date: day2, transcript: `Joy: the wifi password changed to ${WIFI_NEW}.` });
  const killed = r.revisions.flatMap((v) => v.killed);
  expect(killed.some((k) => k.claim.content.includes(WIFI_OLD)), `the ${WIFI_OLD} claim was not killed (revisions: ${JSON.stringify(r.revisions.map((v) => ({ in: v.incoming.content, killed: v.killed.length, dup: v.duplicateOf.length })))})`);
  expect(killed[0]!.reason.length > 0, 'a kill with no reason');
  return r.added.find((c) => c.content.includes(WIFI_NEW));
});

await step('believe     now answers the new one', async () => {
  const a = await answerPalimpsest(store, 'What is the wifi password?', now);
  expect(a.includes(WIFI_NEW), `expected "${WIFI_NEW}" in "${a}" - believed: ${believedNow(store, now)}`);
  expect(!a.includes(WIFI_OLD), `the dead password "${WIFI_OLD}" is still being served: "${a}" - believed: ${believedNow(store, now)}`);
});

await step('store       the dead claim is kept, linked, dated', async () => {
  expect(first && second, 'earlier step failed');
  const dead = store.get(first.id);
  expect(dead?.status === 'superseded', `status is ${dead?.status}, not superseded`);
  expect(dead.supersededBy === second.id, 'not linked to the claim that killed it');
  expect(dead.supersededAt && dead.deathReason, 'no death date or reason');
  expect(!store.active().some((c) => c.id === first.id), 'still in the active set');
  expect(store.believed(now, 0).some((c) => c.id === second.id), 'the new claim is not believed');
});

await step('remember    a restatement refreshes, not duplicates', async () => {
  expect(second, 'earlier step failed');
  const before = store.get(second.id)!.observedAt;
  const today = new Date().toISOString().slice(0, 10);
  const r = await remember(store, { id: 'doctor-3', date: today, transcript: `Joy: yes, the wifi password is still ${WIFI_NEW}.` });
  expect(r.added.length === 0, `stored ${r.added.length} new claim(s) for a restatement: ${r.added.map((c) => c.content).join(' | ')}`);
  expect(r.revisions.some((v) => v.duplicateOf.some((d) => d.id === second.id)), 'not recognised as a duplicate of the held claim');
  expect(store.get(second.id)!.observedAt > before, 'the held claim was not reaffirmed (observedAt unchanged)');
  expect(store.active().length === 1, `active set is ${store.active().length}, expected 1`);
});

// A claim about another project, written directly - no model call needed to test scope.
const OTHER = 'The other-app API listens on port 4321.';
store.add({ content: OTHER, kind: 'config', subject: 'other-app port', sourceSession: 'doctor', sourceQuote: OTHER, observedAt: now, confidence: 1, projects: ['other-app'] });
store.close();

function recall(project: string): string {
  const text = execFileSync(join(process.cwd(), 'node_modules/.bin/tsx'), ['src/cli/recall.ts'], {
    env: { ...process.env, PALIMPSEST_DB: DB, PALIMPSEST_PROJECT: project },
    encoding: 'utf8',
  });
  const out = JSON.parse(text) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
  expect(out.hookSpecificOutput?.hookEventName === 'SessionStart', 'not a SessionStart envelope');
  return out.hookSpecificOutput?.additionalContext ?? '';
}

await step('recall      the hook shows the live claim, not the dead one', async () => {
  const ctx = recall('this-app');
  expect(ctx.includes(WIFI_NEW), `recall does not show "${WIFI_NEW}"`);
  expect(!ctx.includes(WIFI_OLD), `recall still shows the dead "${WIFI_OLD}"`);
  expect(ctx.includes('PROTOCOL'), 'recall has no protocol block');
});

await step('scope       another project\'s claim is withheld here, shown there', async () => {
  const here = recall('this-app');
  expect(!here.includes('4321'), 'other-app\'s port was injected into this-app\'s session');
  expect(/HELD BUT NOT SHOWN: 1 about other projects/.test(here), 'the withheld claim was not counted');
  const there = recall('other-app');
  expect(there.includes('4321'), 'other-app\'s own claim was not shown in other-app');
  expect(there.includes(WIFI_NEW), 'the global claim was not shown in other-app');
});

await step('migrate     a first-release database gains the new columns, keeps its rows', async () => {
  const old = join(scratch, 'old.db');
  const raw = new DatabaseSync(old);
  raw.exec(`CREATE TABLE claims (id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
    source_session TEXT NOT NULL, source_quote TEXT NOT NULL, observed_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    confidence REAL NOT NULL DEFAULT 1.0, superseded_by TEXT, superseded_at INTEGER, death_reason TEXT, embedding BLOB)`);
  raw.prepare(`INSERT INTO claims (id, content, kind, subject, source_session, source_quote, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('old-1', 'A claim from before the column existed.', 'config', 'legacy', 'doctor', 'q', now);
  raw.close();
  const s = new ClaimStore(old);
  try {
    const c = s.get('old-1');
    expect(c && c.projects === undefined, 'the pre-existing row did not survive, or grew a scope it never had');
    s.add({ content: 'scoped', kind: 'config', subject: 's', sourceSession: 'doctor', sourceQuote: 'q', observedAt: now, confidence: 1, projects: ['x', 'y'] });
    expect(s.active().some((k) => k.projects?.join(',') === 'x,y'), 'a scoped claim did not round-trip through the migrated table');
  } finally {
    s.close();
  }
});

// The two transports the memory is served over. Same DB: the stdio server must
// see the kill that happened above.
const childEnv = { ...getDefaultEnvironment(), PALIMPSEST_DB: DB, PALIMPSEST_PROVIDER: provider(), PALIMPSEST_CACHE_DIR: process.env.PALIMPSEST_CACHE_DIR! };
const TOOLS = ['remember', 'believe', 'history', 'forget', 'assert', 'reaffirm'];

await step('mcp/stdio   6 tools; assert supersedes by id prefix, reaffirm resets the clock', async () => {
  const client = new Client({ name: 'doctor', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: join(process.cwd(), 'node_modules/.bin/tsx'),
    args: ['src/mcp/server.ts'],
    env: childEnv,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(TOOLS.every((t) => names.includes(t)), `tools: ${names.join(', ')}`);
    const res = await client.callTool({ name: 'history', arguments: { about: WIFI_OLD } });
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text.includes(WIFI_OLD) && text.includes(WIFI_NEW), `history did not show the kill: ${text.slice(0, 120)}`);

    // The fast path, over the wire: kill the wifi claim by its 8-char prefix, no model call.
    expect(second, 'earlier step failed');
    const a = await client.callTool({ name: 'assert', arguments: { content: 'The wifi password is coral77.', kind: 'config', subject: 'wifi password', supersedes: [second.id.slice(0, 8)], reason: 'changed again' } });
    const aText = (a.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(aText.includes('coral77') && aText.includes(WIFI_NEW), `assert did not report the kill: ${aText.slice(0, 160)}`);
    const s = new ClaimStore(DB);
    try {
      const dead = s.get(second.id)!;
      expect(dead.status === 'superseded' && dead.deathReason === 'changed again', `victim is ${dead.status}, reason "${dead.deathReason}"`);
      const live = s.active().find((c) => c.content.includes('coral77'))!;
      expect(live && live.embedding && live.embedding.length > 0, 'asserted claim has no embedding');
      const before = live.observedAt;
      const r = await client.callTool({ name: 'reaffirm', arguments: { ids: [live.id.slice(0, 8)] } });
      expect(((r.content as Array<{ text?: string }>)[0]?.text ?? '').includes('coral77'), 'reaffirm did not confirm');
      expect(s.get(live.id)!.observedAt >= before, 'reaffirm moved the clock backwards');
      const bad = await client.callTool({ name: 'reaffirm', arguments: { ids: [second.id.slice(0, 8)] } });
      expect(((bad.content as Array<{ text?: string }>)[0]?.text ?? '').startsWith('Refusing'), 'a dead belief was reaffirmed');
    } finally {
      s.close();
    }
  } finally {
    await client.close();
  }
});

await step('mcp/http    Streamable HTTP handshake, 6 tools', async () => {
  const http = createServer((req, res) => {
    const s = new ClaimStore(DB);
    handleMcp(req, res, s).catch((e) => { res.statusCode = 500; res.end(String(e)); }).finally(() => s.close());
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address() as { port: number };
  const client = new Client({ name: 'doctor', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(TOOLS.every((t) => names.includes(t)), `tools: ${names.join(', ')}`);
  } finally {
    await client.close();
    http.close();
  }
});

// ---------------------------------------------------------------- verdict

rmSync(scratch, { recursive: true, force: true });

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
const calls = cacheStats.misses; // chat + embed, none from cache
if (failures === 0) {
  console.log(`\n  ${GREEN}palimpsest is working${RESET}  ${DIM}${calls} uncached calls · ${elapsed}s · scratch removed${RESET}\n`);
} else {
  console.log(`\n  ${RED}${failures} check${failures === 1 ? '' : 's'} failed${RESET}  ${DIM}${elapsed}s${RESET}\n`);
  process.exit(1);
}
