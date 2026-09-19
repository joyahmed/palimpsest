/**
 * Palimpsest over stdio - the transport Claude Code, Codex and OpenCode speak.
 *
 *   pnpm mcp                      (tsx, from source)
 *   node build/mcp/server.js      (built)
 *
 * Register it as a user-scoped MCP server:
 *   claude mcp add --scope user palimpsest -- node /abs/path/build/mcp/server.js
 * with PALIMPSEST_DB pointing at the SQLite file the memory lives in.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClaimStore } from '../memory/store.js';
import { createPalimpsestServer } from './palimpsest.js';

const store = new ClaimStore();
await createPalimpsestServer(store).connect(new StdioServerTransport());
