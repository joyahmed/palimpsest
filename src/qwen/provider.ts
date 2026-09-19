/**
 * Which model provider this process talks to.
 *
 * Palimpsest was built on Qwen Cloud for the hackathon it was submitted to. The
 * free quota there ran out on 2026-09-19 and the live demo started answering
 * `403` to every `remember`; the port to Claude (chat) plus a local embedding
 * model (retrieval) is the fix. Both providers stay: the committed replay cache
 * holds Qwen's answers, so the benchmark reproduces with no key under `qwen`, and
 * new work runs on Claude - through the API when there is a key, through Claude
 * Code when there is a subscription and no key.
 */

export type Provider = 'anthropic' | 'claude-code' | 'qwen';

const PROVIDERS: Provider[] = ['anthropic', 'claude-code', 'qwen'];

/**
 *   claude-code  Claude through the `claude` CLI in headless mode (`claude -p`) - the
 *                model a Claude Max subscription already pays for, no API key. For the
 *                machine you are logged in on: local runs, the demo, the video. Not for
 *                a server that serves other people.
 *   anthropic    Claude through the SDK, for anyone with an API key.
 *   qwen         The roster the first benchmark was recorded with (qwen-submission
 *                tag). Kept so that recording can still be read; not a live path.
 *
 * This is a Claude-based tool. There is deliberately no generic "any endpoint"
 * provider: one model family, one behaviour to reason about.
 *
 * Resolution, first match wins:
 *   PALIMPSEST_PROVIDER                  explicit
 *   PALIMPSEST_CACHE_ONLY=1              claude-code (the committed replay cache was
 *                                        re-recorded on Claude on 2026-09-19; the Qwen
 *                                        recording is at the qwen-submission tag)
 *   ANTHROPIC_API_KEY set                anthropic
 *   DASHSCOPE_API_KEY set                qwen
 *   otherwise                            claude-code (it fails loudly if `claude` is
 *                                        not installed or not logged in)
 */
export function provider(): Provider {
  const explicit = process.env.PALIMPSEST_PROVIDER as Provider | undefined;
  if (explicit && PROVIDERS.includes(explicit)) return explicit;
  if (explicit) {
    throw new Error(`PALIMPSEST_PROVIDER must be one of ${PROVIDERS.join(', ')}, got "${explicit}"`);
  }
  if (process.env.PALIMPSEST_CACHE_ONLY === '1') return 'claude-code';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.DASHSCOPE_API_KEY) return 'qwen';
  return 'claude-code';
}
