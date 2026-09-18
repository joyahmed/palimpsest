/**
 * Which model provider this process talks to.
 *
 * Palimpsest was built on Qwen Cloud for the hackathon it was submitted to. The
 * free quota there ran out on 2026-09-19 and the live demo started answering
 * `403` to every `remember`; the port to Claude (chat) plus a local embedding
 * model (retrieval) is the fix. Both providers stay: the committed replay cache
 * holds Qwen's answers, so the benchmark reproduces with no key under `qwen`, and
 * new work runs under `anthropic`.
 *
 * Resolution, first match wins:
 *   PALIMPSEST_PROVIDER=anthropic|qwen   explicit
 *   PALIMPSEST_CACHE_ONLY=1              qwen - the cache that exists is Qwen's, and a
 *                                        replay must never reach for a key it lacks
 *   ANTHROPIC_API_KEY set                anthropic
 *   DASHSCOPE_API_KEY set                qwen
 *   otherwise                            anthropic (the SDK also reads an `ant auth
 *                                        login` profile with no env var at all)
 */

export type Provider = 'anthropic' | 'qwen';

export function provider(): Provider {
  const explicit = process.env.PALIMPSEST_PROVIDER;
  if (explicit === 'anthropic' || explicit === 'qwen') return explicit;
  if (explicit) {
    throw new Error(`PALIMPSEST_PROVIDER must be "anthropic" or "qwen", got "${explicit}"`);
  }
  if (process.env.PALIMPSEST_CACHE_ONLY === '1') return 'qwen';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.DASHSCOPE_API_KEY) return 'qwen';
  return 'anthropic';
}
