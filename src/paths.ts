/**
 * Where this checkout lives, resolved from the module's own location - never
 * from the working directory.
 *
 * Why: as an MCP server, palimpsest is started by Claude Code with cwd set to
 * whatever project the session is in. A cwd-relative default would put the
 * model cache, the embedding model and - worst - the memory file itself into
 * that project. Every default path below is anchored here instead, and works
 * identically from src/ (tsx) and build/ (compiled), which sit at the same depth.
 */

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const DEFAULT_DB = join(REPO_ROOT, 'palimpsest.db');
export const DEFAULT_CACHE_DIR = join(REPO_ROOT, '.cache', 'llm');
export const DEFAULT_MODEL_DIR = join(REPO_ROOT, '.cache', 'models');
