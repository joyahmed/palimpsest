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

/**
 * A read-only cache we can READ but never WRITE.
 *
 * On Function Compute the writable cache has to live in /tmp, because /code is
 * mounted read-only. But /tmp is per-INSTANCE and evaporates when FC recycles the
 * instance - so a cache warmed by one request is gone by the next cold start, and
 * the request after that pays the full ~109s pipeline against a 120s timeout. That
 * is not a slow demo; it is a 502, and it is what took the live site down.
 *
 * So we ship the committed replay cache inside the code package and read it from
 * there. Writes still go to CACHE_DIR (/tmp); this directory is only ever read.
 * Same entries, same keys, same replay as the benchmark - it just survives a cold
 * start now, because it is part of the artifact rather than a side effect of having
 * been asked once already.
 */
const SEED_DIR = process.env.PALIMPSEST_CACHE_SEED;

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
  /** Identical requests that were already in flight and got awaited instead of re-issued. */
  coalesced: number;
}
export const cacheStats: CacheStats = { hits: 0, misses: 0, coalesced: 0 };

function cachePath(key: string): string {
  // Shard by first two hex chars so we don't end up with one 10k-entry directory.
  const dir = join(CACHE_DIR, key.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  return join(dir, `${key.slice(2)}.json`);
}

/** Same layout as cachePath, but never creates anything: SEED_DIR is read-only. */
function seedPath(key: string): string | undefined {
  if (!SEED_DIR) return undefined;
  return join(SEED_DIR, key.slice(0, 2), `${key.slice(2)}.json`);
}

function cacheKey(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * In-flight requests, keyed the same way as the disk cache.
 *
 * This exists because of a real bug we shipped and had to hunt down. The benchmark
 * asked two systems the same question, got the same answer from both, and graded
 * them DIFFERENTLY. Same input, different verdict.
 *
 * The cause was a race, not the model. Both grade() calls ran concurrently, both
 * missed the cold cache, both hit the API - and `temperature: 0` does NOT guarantee
 * a deterministic response from a large MoE model. Two identical prompts came back
 * with two different rulings, and the second write clobbered the first.
 *
 * Coalescing in-flight calls means an identical request in flight is AWAITED, not
 * re-issued. One call, one answer, one cache entry. It also halves the API traffic
 * on a rate-limited tier, which is not nothing.
 */
const inFlight = new Map<string, Promise<unknown>>();

async function cached<T>(payload: unknown, compute: () => Promise<T>): Promise<T> {
  const key = cacheKey(payload);
  const path = cachePath(key);

  if (existsSync(path)) {
    cacheStats.hits++;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }

  const seed = seedPath(key);
  if (seed && existsSync(seed)) {
    cacheStats.hits++;
    return JSON.parse(readFileSync(seed, 'utf8')) as T;
  }

  const pending = inFlight.get(key);
  if (pending) {
    cacheStats.coalesced++;
    return pending as Promise<T>;
  }

  if (CACHE_ONLY) {
    throw new Error(
      `Cache miss with PALIMPSEST_CACHE_ONLY=1 (key ${key.slice(0, 12)}).\n` +
        'A replay run tried to make a real API call. Either the prompt changed or ' +
        'the cache is incomplete - refusing to spend money silently.',
    );
  }

  cacheStats.misses++;
  const task = (async () => {
    const value = await compute();
    writeFileSync(path, JSON.stringify(value, null, 2));
    return value;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
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
  /**
   * Participates in the cache key but NOT in the request.
   *
   * Used to draw several independent samples of the SAME prompt - which we need
   * because `temperature: 0` does not make a large MoE model deterministic, so a
   * single LLM verdict is a noisy measurement. Without this, identical prompts
   * would collapse onto one cache entry and we could never take a second sample.
   */
  cacheSalt?: string;
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

  const res = await cached(['chat', body, opts.cacheSalt ?? null], async () => {
    const completion = await client().chat.completions.create(body as never);
    return completion as OpenAI.Chat.Completions.ChatCompletion;
  });

  const content = res.choices[0]?.message?.content;
  if (content == null) throw new Error(`Qwen returned no content (model ${opts.model})`);
  return content;
}

// ---------------------------------------------------------------- embeddings

/**
 * Qwen's embedding endpoint caps a batch at 10 inputs. We chunk to respect that.
 *
 * Caching is per-TEXT, not per-batch. That matters: the same claim shows up across
 * sessions and across benchmark runs, and a per-batch key would miss every time the
 * surrounding batch changed. Per-text, we pay for each distinct string exactly once
 * in the life of the project.
 */
const EMBED_BATCH_MAX = 10;

export async function embed(model: string, input: string[]): Promise<Float32Array[]> {
  const out = new Array<number[] | undefined>(input.length);
  const missing: number[] = [];

  // Serve what we already hold.
  for (const [i, text] of input.entries()) {
    const key = cacheKey(['embed1', model, text]);
    const path = cachePath(key);
    if (existsSync(path)) {
      cacheStats.hits++;
      out[i] = JSON.parse(readFileSync(path, 'utf8')) as number[];
    } else {
      missing.push(i);
    }
  }

  if (missing.length > 0 && CACHE_ONLY) {
    throw new Error(
      `Cache miss with PALIMPSEST_CACHE_ONLY=1 (${missing.length} embedding(s)).\n` +
        'A replay run tried to make a real API call - refusing to spend money silently.',
    );
  }

  for (let i = 0; i < missing.length; i += EMBED_BATCH_MAX) {
    const idx = missing.slice(i, i + EMBED_BATCH_MAX);
    const batch = idx.map((j) => input[j]!);

    const r = await client().embeddings.create({ model, input: batch });

    for (const [n, j] of idx.entries()) {
      const vec = r.data[n]?.embedding;
      if (!vec) throw new Error(`Qwen returned no embedding for input ${j}`);
      cacheStats.misses++;
      writeFileSync(cachePath(cacheKey(['embed1', model, input[j]!])), JSON.stringify(vec));
      out[j] = vec;
    }
  }

  return out.map((v, i) => {
    if (!v) throw new Error(`Missing embedding for input ${i}`);
    return Float32Array.from(v);
  });
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
