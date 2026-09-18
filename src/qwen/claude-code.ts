/**
 * Claude through Claude Code's headless mode - `claude -p`.
 *
 * Why this exists: a Claude Max subscription pays for Claude Code, not for the
 * API, and the person running this project has the former and will not buy the
 * latter. `claude -p` is the same model behind the same login, driven as a
 * subprocess: system prompt in, JSON out, no tools, no hooks, no session file.
 * Roughly four seconds a call. It is a local provider - it needs the machine to
 * be logged in - so a deployed server uses the `openai` provider instead.
 *
 * Flags, and why each one:
 *   --setting-sources ""       no user/project settings, so no SessionStart hooks
 *                              inject a memory file into a claim-extraction prompt
 *   --tools ""                 a model call, not an agent: nothing to read or run
 *   --no-session-persistence   thousands of extraction calls must not become
 *                              thousands of resumable sessions on disk
 *   --output-format json       one object: result, is_error, usage
 *   --model / --effort         the roster's model; effort low for extraction,
 *                              high for adjudication (the same mapping as the SDK
 *                              provider)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stripFences } from './anthropic.js';

const run = promisify(execFile);

export interface ClaudeCodeRequest {
  model: string;
  system?: string;
  user: string;
  thinking?: boolean;
  json?: boolean;
}

/** The request as sent - also the cache key, so it must be deterministic. */
export function claudeCodeBody(req: ClaudeCodeRequest) {
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
    effort: req.thinking === false ? 'low' : 'high',
    system,
    user: req.user,
  };
}

export interface ClaudeCodeResult {
  text: string;
  usage: unknown;
}

export async function claudeCodeChat(req: ClaudeCodeRequest): Promise<ClaudeCodeResult> {
  const body = claudeCodeBody(req);
  const args = [
    '-p',
    '--setting-sources', '',
    '--tools', '',
    '--no-session-persistence',
    '--output-format', 'json',
    '--model', body.model,
    '--effort', body.effort,
    ...(body.system ? ['--system-prompt', body.system] : []),
    body.user,
  ];
  let stdout: string;
  try {
    ({ stdout } = await run('claude', args, { maxBuffer: 16 * 1024 * 1024, timeout: 180_000 }));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new Error('provider claude-code needs the `claude` CLI on PATH (Claude Code), or set another provider');
    }
    throw new Error(`claude -p failed: ${e.stderr?.trim() || e.message}`);
  }
  let parsed: { result?: string; is_error?: boolean; usage?: unknown };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`claude -p returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (parsed.is_error) {
    throw new Error(`claude -p error: ${parsed.result ?? 'unknown'} (is the machine logged in? run \`claude\` once)`);
  }
  let text = parsed.result ?? '';
  if (req.json) text = stripFences(text);
  return { text, usage: parsed.usage };
}
