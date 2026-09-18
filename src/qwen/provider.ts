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

export type Provider = 'anthropic' | 'claude-code' | 'openai' | 'qwen';

const PROVIDERS: Provider[] = ['anthropic', 'claude-code', 'openai', 'qwen'];

/**
 *   claude-code  Claude through the `claude` CLI in headless mode (`claude -p`) - the
 *                model a Claude Max subscription already pays for, no API key. For the
 *                machine you are logged in on: local runs, the demo, the video. Not for
 *                a server that serves other people.
 *   openai       Any OpenAI-compatible endpoint - Groq, Gemini's OpenAI surface,
 *                OpenRouter, a local Ollama - via PALIMPSEST_BASE_URL + PALIMPSEST_API_KEY
 *                and PALIMPSEST_CHAT_MODEL. This is what a deployed function runs on when
 *                the only affordable key is a free tier that renews.
 *
 * Resolution, first match wins:
 *   PALIMPSEST_PROVIDER                  explicit
 *   PALIMPSEST_CACHE_ONLY=1              qwen (the committed cache is Qwen's)
 *   ANTHROPIC_API_KEY set                anthropic
 *   PALIMPSEST_BASE_URL set              openai
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
  if (process.env.PALIMPSEST_CACHE_ONLY === '1') return 'qwen';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.PALIMPSEST_BASE_URL) return 'openai';
  if (process.env.DASHSCOPE_API_KEY) return 'qwen';
  return 'claude-code';
}
