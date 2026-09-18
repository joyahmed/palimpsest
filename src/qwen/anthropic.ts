/**
 * Claude, through the official SDK.
 *
 * Only the request shape lives here; the cache, the in-flight coalescing and the
 * `chat()` contract are in client.ts and are provider-agnostic. Notes on the
 * mapping from the Qwen-era options:
 *
 *   thinking: false  ->  output_config.effort "low". Opus 5 thinks by default and
 *                        disabling it outright has two known failure modes (tool
 *                        calls written into visible text, leaked thinking tags), so
 *                        the cheap path is low effort, not no thinking.
 *   thinking: true   ->  adaptive thinking (the default), effort "high".
 *   json: true       ->  an instruction in the system prompt plus a defensive strip
 *                        of code fences on the way out. The three call sites parse
 *                        three different shapes, so one JSON schema does not fit.
 *   temperature      ->  dropped: sampling parameters are rejected by Opus 5.
 *
 * Server-side refusal fallback is on: a safety-classifier decline re-runs the same
 * request on Opus 4.8 inside the call instead of returning an empty answer.
 */

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | undefined;

function client(): Anthropic {
  if (_client) return _client;
  // No apiKey argument on purpose: the SDK resolves ANTHROPIC_API_KEY, then
  // ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile.
  _client = new Anthropic();
  return _client;
}

export interface AnthropicChatRequest {
  model: string;
  system?: string;
  user: string;
  thinking?: boolean;
  json?: boolean;
  maxTokens?: number;
}

/** The request body as sent - also the cache key, so it must be deterministic. */
export function anthropicBody(req: AnthropicChatRequest) {
  const system = [
    req.system ?? '',
    req.json
      ? 'Respond with a single JSON object and nothing else: no prose before or after it, no code fences.'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    model: req.model,
    max_tokens: req.maxTokens ?? 16000,
    ...(system ? { system } : {}),
    messages: [{ role: 'user' as const, content: req.user }],
    thinking: { type: 'adaptive' as const },
    output_config: { effort: req.thinking === false ? ('low' as const) : ('high' as const) },
  };
}

export interface AnthropicChatResult {
  text: string;
  stop_reason: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function anthropicChat(req: AnthropicChatRequest): Promise<AnthropicChatResult> {
  const body = anthropicBody(req);
  const res = await client().beta.messages.create({
    ...body,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
  });
  if (res.stop_reason === 'refusal') {
    throw new Error(`Claude refused the request (model ${req.model})`);
  }
  let text = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (req.json) text = stripFences(text);
  return {
    text,
    stop_reason: res.stop_reason,
    model: res.model,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}

/** "```json\n{...}\n```" -> "{...}". A no-op on text that has no fence. */
export function stripFences(text: string): string {
  const m = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  return m ? m[1]! : text.trim();
}
