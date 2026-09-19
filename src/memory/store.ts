/**
 * The claim store. One SQLite file, via Node's built-in `node:sqlite` - no native
 * module to compile, no daemon, no container, no port.
 *
 * Deliberately NOT a vector database. At a few thousand claims, brute-force cosine
 * is microseconds, and the interesting problem in this project is not retrieval
 * speed - it is deciding which retrieved claims are still TRUE. Adding a vector
 * index here would be infrastructure spent on the part that was never hard.
 */

import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_DB } from '../paths.js';
import { cosine } from '../qwen/client.js';
import { PROBE_UNKNOWN, trustedConfidence, TRUST_THRESHOLD, type Claim, type ClaimKind, type ClaimStatus } from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS claims (
  id             TEXT PRIMARY KEY,
  content        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  subject        TEXT NOT NULL,
  source_session TEXT NOT NULL,
  source_quote   TEXT NOT NULL,
  observed_at    INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  confidence     REAL NOT NULL DEFAULT 1.0,
  superseded_by  TEXT,
  superseded_at  INTEGER,
  death_reason   TEXT,
  embedding      BLOB
);
CREATE INDEX IF NOT EXISTS idx_claims_status  ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject);
`;

/**
 * Columns added after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists, so it
 * will not add a column to a database somebody has been using for a month - nor should
 * that database be rebuilt; it is the only copy of what they believe. So: look at what
 * is there, add what is missing.
 */
const ADDED_COLUMNS: Record<string, string> = {
  // A store written by the private predecessor (no model inside, no retrieval by vector)
  // has no embedding column at all. Added here, then filled by `pnpm backfill` - the
  // claims are the same claims; they have simply acquired a way to be found.
  embedding: 'BLOB',
  // Space-separated project slugs. A join table would be tidier and this store holds
  // hundreds of claims - a second table for a list that is usually one item is
  // complexity bought with nothing. The split happens in toClaim.
  projects: 'TEXT',
  // Verification. Nullable throughout: most claims have no oracle and never will.
  probe: 'TEXT',
  expect: 'TEXT',
  verified_at: 'INTEGER',
  verify_result: 'TEXT',
  verify_output: 'TEXT',
};

type Row = {
  id: string;
  content: string;
  kind: string;
  subject: string;
  source_session: string;
  source_quote: string;
  observed_at: number;
  status: string;
  confidence: number;
  superseded_by: string | null;
  superseded_at: number | null;
  death_reason: string | null;
  embedding: Uint8Array | null;
  projects: string | null;
  probe: string | null;
  expect: string | null;
  verified_at: number | null;
  verify_result: string | null;
  verify_output: string | null;
};

function toClaim(r: Row): Claim {
  return {
    id: r.id,
    content: r.content,
    kind: r.kind as ClaimKind,
    subject: r.subject,
    sourceSession: r.source_session,
    sourceQuote: r.source_quote,
    observedAt: r.observed_at,
    status: r.status as ClaimStatus,
    confidence: r.confidence,
    supersededBy: r.superseded_by ?? undefined,
    supersededAt: r.superseded_at ?? undefined,
    deathReason: r.death_reason ?? undefined,
    projects: r.projects ? r.projects.trim().split(/\s+/) : undefined,
    probe: r.probe ?? undefined,
    expect: r.expect ?? undefined,
    verifiedAt: r.verified_at ?? undefined,
    verifyResult: (r.verify_result as Claim['verifyResult']) ?? undefined,
    verifyOutput: r.verify_output ?? undefined,
    embedding: r.embedding
      ? new Float32Array(
          r.embedding.buffer.slice(
            r.embedding.byteOffset,
            r.embedding.byteOffset + r.embedding.byteLength,
          ) as ArrayBuffer,
        )
      : undefined,
  };
}

/** A claim with the confidence the memory actually trusts substituted in. What callers want. */
export type Believed = Claim & { confidence: number };

export type ProbeRunner = (probe: string) => { ok: boolean; output: string };

/**
 * The default runner: a shell, with a short leash. Timeout because a probe that hangs
 * would hang the pass; stderr folded in because a probe's complaint is usually the most
 * informative thing about it.
 */
export const shellProbe: ProbeRunner = (probe) => {
  try {
    const output = execSync(probe, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number | null };
    // A grep that matches nothing exits non-zero with empty stdout, and that IS a result -
    // the fact is not there. Only a probe that never ran at all (no exit status) is unknown.
    return { ok: e.status !== null && e.status !== undefined, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

export interface Verification {
  claim: Claim;
  result: 'passed' | 'failed' | 'unknown';
  output: string;
}

export class ClaimStore {
  private db: DatabaseSync;

  constructor(rawPath = process.env.PALIMPSEST_DB ?? DEFAULT_DB) {
    // A tilde in an env var handed over without a shell (claude mcp add, settings.json)
    // stays a literal tilde; expand it here so `~/.palimpsest/memory.db` means what it says.
    const path = rawPath === '~' ? homedir() : rawPath.startsWith('~/') ? join(homedir(), rawPath.slice(2)) : rawPath;
    // A first run points at a file whose directory may not exist yet (~/.palimpsest/).
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    const present = new Set(
      (this.db.prepare(`PRAGMA table_info(claims)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    for (const [name, type] of Object.entries(ADDED_COLUMNS)) {
      if (!present.has(name)) this.db.exec(`ALTER TABLE claims ADD COLUMN ${name} ${type}`);
    }
  }

  add(claim: Omit<Claim, 'id' | 'status'> & { id?: string; status?: ClaimStatus }): Claim {
    const full: Claim = { ...claim, id: claim.id ?? randomUUID(), status: claim.status ?? 'active' };

    this.db
      .prepare(
        `INSERT INTO claims
           (id, content, kind, subject, source_session, source_quote, observed_at,
            status, confidence, embedding, projects, probe, expect)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.content,
        full.kind,
        full.subject,
        full.sourceSession,
        full.sourceQuote,
        full.observedAt,
        full.status,
        full.confidence,
        full.embedding ? Buffer.from(full.embedding.buffer) : null,
        full.projects && full.projects.length ? full.projects.join(' ') : null,
        full.probe ?? null,
        full.expect ?? null,
      );

    return full;
  }

  /**
   * Kill a claim - but keep the body.
   *
   * This is the whole point of the project. The dead claim stays in the store,
   * linked to its killer, with the date and the reason. You can always ask the
   * system "what did you used to believe, and when did you stop?"
   */
  supersede(deadId: string, killerId: string, reason: string, at: number): void {
    this.db
      .prepare(
        `UPDATE claims
            SET status = 'superseded', superseded_by = ?, superseded_at = ?, death_reason = ?
          WHERE id = ?`,
      )
      .run(killerId, at, reason, deadId);
  }

  /**
   * A belief restated is a belief re-confirmed: its age resets to `at`, so decay
   * starts over. The row is not duplicated - a store where the same fact competes
   * with itself at retrieval time is worse than one that merely forgets.
   */
  reaffirm(id: string, at: number): void {
    this.db
      .prepare(`UPDATE claims SET observed_at = MAX(observed_at, ?) WHERE id = ? AND status = 'active'`)
      .run(at, id);
  }

  refute(id: string, reason: string, at: number): void {
    this.db
      .prepare(
        `UPDATE claims SET status = 'refuted', superseded_at = ?, death_reason = ? WHERE id = ?`,
      )
      .run(at, reason, id);
  }

  /**
   * A claim by id OR by the 8-character prefix recall prints. The agent has the prefix
   * in context and nothing else; making it type the UUID would be making it guess.
   * Ambiguity is an error, not a pick - the wrong belief must never die quietly.
   */
  resolve(idOrPrefix: string): Claim {
    const exact = this.get(idOrPrefix);
    if (exact) return exact;
    const hits = this.db
      .prepare(`SELECT * FROM claims WHERE id LIKE ? || '%'`)
      .all(idOrPrefix) as Row[];
    if (hits.length === 1) return toClaim(hits[0]!);
    if (hits.length === 0) throw new Error(`no claim with id "${idOrPrefix}"`);
    throw new Error(`"${idOrPrefix}" matches ${hits.length} claims - give more of the id`);
  }

  get(id: string): Claim | undefined {
    const r = this.db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id) as Row | undefined;
    return r ? toClaim(r) : undefined;
  }

  /** Every claim, dead ones included - the audit view. */
  all(): Claim[] {
    return (this.db.prepare(`SELECT * FROM claims ORDER BY observed_at`).all() as Row[]).map(
      toClaim,
    );
  }

  active(): Claim[] {
    return (
      this.db.prepare(`SELECT * FROM claims WHERE status = 'active' ORDER BY observed_at`).all() as Row[]
    ).map(toClaim);
  }

  /**
   * Find the ACTIVE claims a new one might collide with.
   *
   * Note what this is and isn't. It is a cheap way to narrow thousands of claims
   * down to a handful worth reasoning about. It is NOT a truth test - cosine
   * cannot tell a contradiction from a paraphrase (we measured: 0.93 vs 0.91).
   * That ruling costs an LLM call, and this function exists only so we don't have
   * to make thousands of them.
   */
  collisionCandidates(embedding: Float32Array, k = 5, minSim = 0.5): Array<Claim & { sim: number }> {
    return this.active()
      .filter((c) => c.embedding)
      .map((c) => ({ ...c, sim: cosine(embedding, c.embedding!) }))
      .filter((c) => c.sim >= minSim)
      // Ties break on content, not on insertion order. Two claims with identical
      // similarity must not be able to swap places between runs - that would change
      // the adjudication prompt, and with it the cache key, and with it the numbers.
      .sort((a, b) => b.sim - a.sim || a.content.localeCompare(b.content))
      .slice(0, k);
  }

  /**
   * What the system currently believes, ranked by how much it still trusts it.
   *
   * `minConfidence` defaults to a trust threshold, but every caller in this repo
   * passes `0` on purpose: a decayed claim is still the best answer we have, and
   * withholding it would trade a weak answer for no answer. So the ranking is the
   * product here - the confidence rides along and the reader decides how far to
   * lean on it. The threshold is kept because gating is the obvious next step
   * once verification exists to re-check what falls below it.
   */
  believed(now = Date.now(), minConfidence = TRUST_THRESHOLD): Believed[] {
    return this.active()
      .map((c) => ({ ...c, confidence: trustedConfidence(c, now) }))
      .filter((c) => c.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Still active, but decayed below the trust threshold. The complement of `believed()`.
   *
   * Recall shows these in their own block: not as facts, but as questions - "is this
   * still true?" - so a stale port or branch is re-checked instead of repeated.
   */
  doubted(now = Date.now()): Believed[] {
    return this.active()
      .map((c) => ({ ...c, confidence: trustedConfidence(c, now) }))
      .filter((c) => c.confidence < TRUST_THRESHOLD)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Ask the world about one claim. Executes its probe - only ever from an explicit call.
   * A probe that could not run tells us nothing: saying "failed" there is how a laptop with
   * no network refutes a shelf of true beliefs. The sentinel is checked BEFORE `expect`, or
   * a probe whose expected text appeared alongside it would still pass.
   */
  verify(id: string, now = Date.now(), runner: ProbeRunner = shellProbe): Verification | undefined {
    const claim = this.get(id);
    if (!claim?.probe) return undefined;
    const { ok, output } = runner(claim.probe);
    const result: Verification['result'] = !ok
      ? 'unknown'
      : output.includes(PROBE_UNKNOWN)
        ? 'unknown'
        : (claim.expect ?? '') === '' || output.includes(claim.expect!)
          ? 'passed'
          : 'failed';
    this.db
      .prepare(`UPDATE claims SET verified_at = ?, verify_result = ?, verify_output = ? WHERE id = ?`)
      // Truncated: evidence for a human reading an audit line, not a log.
      .run(now, result, output.slice(0, 2000), id);
    return { claim, result, output };
  }

  /** Active claims that cannot be retrieved yet - written before embeddings existed. */
  unembedded(): Claim[] {
    return this.active().filter((c) => !c.embedding);
  }

  setEmbedding(id: string, embedding: Float32Array): void {
    this.db.prepare(`UPDATE claims SET embedding = ? WHERE id = ?`).run(Buffer.from(embedding.buffer), id);
  }

  /** Every active claim carrying a probe - the checkable column. */
  checkable(): Claim[] {
    return this.active().filter((c) => c.probe);
  }

  verifyAll(now = Date.now(), runner: ProbeRunner = shellProbe): Verification[] {
    return this.checkable().flatMap((c) => {
      const v = this.verify(c.id, now, runner);
      return v ? [v] : [];
    });
  }

  /**
   * Attach a probe to a claim asserted without one. In place: rewriting the claim would
   * mint a new id and break every reference to it. The belief is the same belief - it has
   * simply acquired a way to be checked.
   */
  addProbe(id: string, probe: string, expect: string): boolean {
    return this.db
      .prepare(`UPDATE claims SET probe = ?, expect = ?, verified_at = NULL, verify_result = NULL, verify_output = NULL WHERE id = ? AND status = 'active'`)
      .run(probe, expect, id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
