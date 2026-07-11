/**
 * Qwen Cloud client, with a durable on-disk cache in front of it.
 *
 * WHY THE CACHE IS LOAD-BEARING (not an optimisation):
 *
 *   1. The Qwen Cloud free tier is rate-limited hard enough that you cannot draw
 *      it down continuously. Without a cache, iterating on a prompt means sitting
 *      and watching 429s.
 *   2. The benchmark is the spine of this project and we re-run it constantly
 *      while tuning. Uncached, we'd pay for every identical call, every time.
 *   3. Reproducibility. The cache is committed to the repo, so anyone can replay
 *      our benchmark and get bit-identical numbers - with no API key and no spend.
 *      That is part of the submission, not a convenience.
 *
 * Every unique (model, prompt, params) triple is paid for exactly once, ever.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';

const BASE_URL =
  process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const CACHE_DIR = process.env.PALIMPSEST_CACHE_DIR ?? '.cache/llm';
const CACHE_ONLY = process.env.PALIMPSEST_CACHE_ONLY === '1';

let _client: OpenAI | undefined;
function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'DASHSCOPE_API_KEY is not set.\n' +
        'Note: exporting it in ~/.zshrc is NOT enough - zsh only sources .zshrc for\n' +
        'interactive shells, so scripts never see it. Put it in .env (gitignored).',
    );
  }
  _client = new OpenAI({ apiKey, baseURL: BASE_URL });
  return _client;
}

// ---------------------------------------------------------------- cache

interface CacheStats {
  hits: number;
  misses: number;
}
export const cacheStats: CacheStats = { hits: 0, misses: 0 };

function cachePath(key: string): string {
  // Shard by first two hex chars so we don't end up with one 10k-entry directory.
  const dir = join(CACHE_DIR, key.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  return join(dir, `${key.slice(2)}.json`);
}

function cacheKey(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function cached<T>(payload: unknown, compute: () => Promise<T>): Promise<T> {
  const key = cacheKey(payload);
  const path = cachePath(key);

  if (existsSync(path)) {
    cacheStats.hits++;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }

  if (CACHE_ONLY) {
    throw new Error(
      `Cache miss with PALIMPSEST_CACHE_ONLY=1 (key ${key.slice(0, 12)}).\n` +
        'A replay run tried to make a real API call. Either the prompt changed or ' +
        'the cache is incomplete - refusing to spend money silently.',
    );
  }

  cacheStats.misses++;
  const value = await compute();
  writeFileSync(path, JSON.stringify(value, null, 2));
  return value;
}

// ---------------------------------------------------------------- chat

export interface ChatOptions {
  model: string;
  system?: string;
  user: string;
  /**
   * Qwen ships with extended thinking ON by default. Leave it on where reasoning
   * earns its cost (adjudication); turn it off for bulk work (extraction), where
   * it just burns tokens and throughput.
   */
  thinking?: boolean;
  /** Ask the model for a JSON object. Qwen supports OpenAI-style structured output. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const messages = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    { role: 'user' as const, content: opts.user },
  ];

  const body = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
    // DashScope reads this from the request body in OpenAI-compatible mode.
    ...(opts.thinking === false ? { enable_thinking: false } : {}),
  };

  const res = await cached(['chat', body], async () => {
    const completion = await client().chat.completions.create(body as never);
    return completion as OpenAI.Chat.Completions.ChatCompletion;
  });

  const content = res.choices[0]?.message?.content;
  if (content == null) throw new Error(`Qwen returned no content (model ${opts.model})`);
  return content;
}

// ---------------------------------------------------------------- embeddings

export async function embed(model: string, input: string[]): Promise<Float32Array[]> {
  const res = await cached(['embed', { model, input }], async () => {
    const r = await client().embeddings.create({ model, input });
    // Store as plain arrays - JSON has no Float32Array.
    return r.data.map((d) => d.embedding);
  });
  return res.map((v) => Float32Array.from(v));
}

/**
 * Similarity over a few thousand claims is microseconds of brute-force cosine.
 * A vector index here would be premature infrastructure; if the corpus ever
 * outgrows this, retrieval is the easiest thing in the system to swap out.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
