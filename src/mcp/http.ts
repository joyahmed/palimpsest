/**
 * Palimpsest over Streamable HTTP (MCP spec 2025-11-25) - the transport a remote
 * client speaks: an Alexa+ Agent Skill, a hosted agent, `curl`.
 *
 * Stateless by design: every request gets its own McpServer + transport pair
 * over the shared ClaimStore, and both are closed when the response ends. That
 * is the SDK's recommended shape for a server that runs behind Function Compute
 * or any load balancer, where a session id would pin a client to an instance
 * that may not exist on the next request. The memory itself is in SQLite, which
 * is the only state that matters.
 *
 * Mounted at /mcp by src/server.ts, so the demo site and the MCP endpoint are
 * one deployment; `pnpm serve` then answers both.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ClaimStore } from '../memory/store.js';
import { createPalimpsestServer } from './palimpsest.js';

export async function handleMcp(req: IncomingMessage, res: ServerResponse, store: ClaimStore): Promise<void> {
  const server = createPalimpsestServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
