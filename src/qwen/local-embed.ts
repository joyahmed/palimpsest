/**
 * Local embeddings: bge-small-en-v1.5 (q8) through transformers.js + onnxruntime.
 *
 * Why local and not a second vendor: the whole reason for this port is a vendor
 * quota that ran out. An embedding model that runs in-process has no quota, no
 * key, no network after the first 34 MB download, and gives the same vector for
 * the same text on every machine - which the committed replay cache depends on.
 *
 * The model name in MODELS.embed is `local:<hf-id>:<dtype>`; this module parses it,
 * so a different model is a one-line change in models.ts and a fresh cache prefix.
 * Files land in PALIMPSEST_MODEL_DIR (default .cache/models, gitignored).
 */

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_DIR = process.env.PALIMPSEST_MODEL_DIR ?? '.cache/models';

let _pipe: Promise<FeatureExtractionPipeline> | undefined;
let _loadedFor: string | undefined;

export function isLocalModel(model: string): boolean {
  return model.startsWith('local:');
}

function parse(model: string): { id: string; dtype: 'q8' | 'fp32' | 'fp16' | 'q4' } {
  const [, id, dtype] = model.split(':');
  if (!id) throw new Error(`local embedding model must be "local:<hf-id>[:<dtype>]", got "${model}"`);
  const d = (dtype ?? 'q8') as 'q8' | 'fp32' | 'fp16' | 'q4';
  return { id, dtype: d };
}

function load(model: string): Promise<FeatureExtractionPipeline> {
  if (_pipe && _loadedFor === model) return _pipe;
  const { id, dtype } = parse(model);
  env.cacheDir = MODEL_DIR;
  _loadedFor = model;
  _pipe = pipeline('feature-extraction', id, { dtype }) as Promise<FeatureExtractionPipeline>;
  return _pipe;
}

/** Mean-pooled, L2-normalised vectors - the same recipe the model card recommends. */
export async function localEmbed(model: string, input: string[]): Promise<number[][]> {
  if (input.length === 0) return [];
  const pipe = await load(model);
  const out = await pipe(input, { pooling: 'mean', normalize: true });
  return out.tolist() as number[][];
}
