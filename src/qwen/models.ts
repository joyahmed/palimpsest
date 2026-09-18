/**
 * Model roster, per provider.
 *
 * The roles are the stable part of the system; the names behind them are not.
 * Every call site asks for `MODELS.adjudicate` / `MODELS.extract` / `MODELS.embed`
 * and never for a model by name, so switching provider is a matter of which table
 * is exported - and the cache keys carry the name, so the two providers never
 * share an entry by accident.
 */

import { provider } from './provider.js';

interface Roster {
  /**
   * Adjudication - the heart of the system.
   *
   * When a new claim arrives we ask this model to rule on how it relates to the
   * claims it might collide with: update, contradiction, refinement, or new.
   * This is the one place reasoning genuinely earns its cost, so thinking stays ON.
   */
  adjudicate: string;
  /**
   * Bulk claim extraction - high volume, low judgement. Thinking off (Qwen) or
   * effort low (Claude): on an extraction pass, deliberation is pure waste.
   */
  extract: string;
  /** Collision retrieval - which existing claims might this new one contradict? */
  embed: string;
}

/**
 * Qwen Cloud: a developer-facing front-end over the DashScope International
 * (Singapore) endpoint, OpenAI-compatible, driven with the `openai` package and
 * an overridden base URL. This is the roster the committed replay cache holds.
 */
const QWEN: Roster = {
  adjudicate: 'qwen3.7-plus',
  extract: 'qwen3.6-flash',
  embed: 'text-embedding-v4',
};

/**
 * Claude for both language roles - the same model, with `effort` doing the work
 * that the Qwen roster did with two models - and a local embedding model for
 * retrieval, because Anthropic offers none and a second vendor key is a second
 * quota to run out of. bge-small (q8, 34 MB, 384-dim) runs in-process through
 * onnxruntime; no key, no network after the first download, deterministic.
 */
const ANTHROPIC: Roster = {
  adjudicate: 'claude-opus-5',
  extract: 'claude-opus-5',
  embed: 'local:Xenova/bge-small-en-v1.5:q8',
};

/** Claude Code headless: the same Claude, addressed by the CLI's model names. */
const CLAUDE_CODE: Roster = {
  adjudicate: 'claude-opus-5',
  extract: 'claude-opus-5',
  embed: 'local:Xenova/bge-small-en-v1.5:q8',
};

const ROSTERS: Record<ReturnType<typeof provider>, Roster> = {
  anthropic: ANTHROPIC,
  'claude-code': CLAUDE_CODE,
  qwen: QWEN,
};

export const MODELS: Roster = ROSTERS[provider()];

export type ModelRole = keyof Roster;
