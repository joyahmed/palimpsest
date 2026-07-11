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
import { randomUUID } from 'node:crypto';
import { cosine } from '../qwen/client.js';
import { decayedConfidence, type Claim, type ClaimKind, type ClaimStatus } from './types.js';

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

export class ClaimStore {
  private db: DatabaseSync;

  constructor(path = process.env.PALIMPSEST_DB ?? './palimpsest.db') {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  add(claim: Omit<Claim, 'id' | 'status'> & { id?: string; status?: ClaimStatus }): Claim {
    const full: Claim = { ...claim, id: claim.id ?? randomUUID(), status: claim.status ?? 'active' };

    this.db
      .prepare(
        `INSERT INTO claims
           (id, content, kind, subject, source_session, source_quote, observed_at,
            status, confidence, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  refute(id: string, reason: string, at: number): void {
    this.db
      .prepare(
        `UPDATE claims SET status = 'refuted', superseded_at = ?, death_reason = ? WHERE id = ?`,
      )
      .run(at, reason, id);
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
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k);
  }

  /**
   * What the system currently believes, ranked by how much it still trusts it.
   * Claims whose confidence has decayed below `minConfidence` are not served as
   * fact - they are candidates for re-verification, not answers.
   */
  believed(now = Date.now(), minConfidence = 0.35): Array<Claim & { confidence: number }> {
    return this.active()
      .map((c) => ({ ...c, confidence: decayedConfidence(c, now) }))
      .filter((c) => c.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  close(): void {
    this.db.close();
  }
}
