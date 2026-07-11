/**
 * The unit of memory.
 *
 * Every memory system stores CHUNKS of text. A chunk is not a unit of truth - one
 * paragraph can hold five facts, three still true and two dead. You cannot delete
 * half a chunk. So when the world changes, the only move available is to append a
 * new chunk and leave the old one sitting there, still retrievable, still lying.
 *
 * That is why every memory system is append-only. Not for lack of imagination -
 * they have no unit small enough to kill.
 *
 * A CLAIM is that unit. Atomic: independently true or false. Which means it can
 * have a status. Which means it can die.
 */

/**
 * What kind of thing a claim asserts - this governs how fast it rots.
 *
 * The insight: facts do not decay at a single universal rate. "Joy's git email"
 * and "the dev server is on port 3000" are both facts, but one is basically
 * permanent and the other is stale within a month. A memory system with one decay
 * curve is wrong about both.
 */
export type ClaimKind =
  /** Who someone is. Name, email, role. Barely decays. */
  | 'identity'
  /** What someone likes or how they work. Drifts slowly. */
  | 'preference'
  /** A choice that was made. Can be reversed, but usually deliberately. */
  | 'decision'
  /** Ports, paths, versions, env. Rots fast - this is where memory lies most. */
  | 'config'
  /** What is happening right now. Current branch, current task. Rots fastest. */
  | 'state'
  /** Something that happened at a point in time. Does NOT decay - the past is fixed. */
  | 'event';

/**
 * Half-life in days: how long until confidence in an unrefreshed claim halves.
 *
 * `event` is deliberately Infinity. A thing that happened, happened - it can never
 * become false. This distinction (state decays, events don't) is one a single
 * global decay curve cannot express, and getting it wrong means either forgetting
 * history or trusting stale config.
 */
export const HALF_LIFE_DAYS: Record<ClaimKind, number> = {
  identity: 3650,
  preference: 730,
  decision: 365,
  config: 30,
  state: 7,
  event: Infinity,
};

export type ClaimStatus =
  /** Believed. Retrievable. */
  | 'active'
  /** A newer claim replaced it. Retained, linked, never served as current truth. */
  | 'superseded'
  /** Checked against the world and found false. */
  | 'refuted'
  /** Decayed past the point of trust. Not false - just no longer load-bearing. */
  | 'stale';

export interface Claim {
  id: string;
  /** One atomic assertion. Independently true or false. */
  content: string;
  kind: ClaimKind;
  /** What this claim is ABOUT. Narrows collision search before we spend a call. */
  subject: string;

  // --- provenance: without this we cannot adjudicate, only guess
  /** Which conversation it came from. */
  sourceSession: string;
  /** Verbatim span it was extracted from - so a human can always check our work. */
  sourceQuote: string;
  /** When the claim was made true, in the world (not when we wrote the row). */
  observedAt: number;

  // --- lifecycle
  status: ClaimStatus;
  /** Confidence at birth, before any decay. */
  confidence: number;
  /** The claim that killed this one. */
  supersededBy?: string;
  supersededAt?: number;
  /** Why it died - in plain language. This is what the audit UI renders. */
  deathReason?: string;

  embedding?: Float32Array;
}

/**
 * Confidence decays exponentially from `observedAt`, at a rate set by kind.
 *
 *   confidence(t) = confidence₀ · 2^(−age / halfLife)
 *
 * A `config` claim from 30 days ago is worth half what it was. An `identity`
 * claim from 30 days ago is worth essentially all of it. An `event` never fades.
 */
export function decayedConfidence(claim: Claim, now: number): number {
  const halfLife = HALF_LIFE_DAYS[claim.kind];
  if (!Number.isFinite(halfLife)) return claim.confidence;

  const ageDays = (now - claim.observedAt) / 86_400_000;
  if (ageDays <= 0) return claim.confidence;

  return claim.confidence * Math.pow(2, -ageDays / halfLife);
}
