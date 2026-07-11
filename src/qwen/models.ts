/**
 * Qwen Cloud model roster.
 *
 * Qwen Cloud is a developer-facing front-end over the DashScope International
 * (Singapore) endpoint. The API is OpenAI-compatible, so we drive it with the
 * `openai` package and an overridden base URL.
 */

export const MODELS = {
  /**
   * Adjudication - the heart of the system.
   *
   * When a new claim arrives we ask this model to rule on how it relates to the
   * claims it might collide with: update, contradiction, refinement, or new.
   * This is the one place reasoning genuinely earns its cost, so thinking stays ON.
   */
  adjudicate: 'qwen3.7-plus',

  /**
   * Bulk claim extraction - high volume, low judgement.
   *
   * Thinking is disabled here. Qwen has extended thinking ON by default, and on
   * an extraction pass that is pure waste: we measured it burn reasoning tokens
   * deliberating over how to say "OK". On a rate-limited free tier that's not
   * just cost, it's throughput.
   */
  extract: 'qwen3.6-flash',

  /** Collision retrieval - which existing claims might this new one contradict? */
  embed: 'text-embedding-v4',

  /** Sharpens the collision candidate set before we spend an adjudication call. */
  rerank: 'qwen3-rerank',
} as const;

export type ModelRole = keyof typeof MODELS;
