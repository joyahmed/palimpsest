/**
 * Palimpsest as an MCP server.
 *
 * This is the point of the whole thing. On its own, Palimpsest is a clever library.
 * Behind MCP it becomes a MEMORY LAYER ANY AGENT CAN PLUG INTO - Claude, Qwen's own
 * agents, anything that speaks the protocol - and it brings one property none of
 * them currently have: it can notice that something it believes has stopped being
 * true, and revise itself.
 *
 * Four tools:
 *
 *   remember   Feed it a conversation. It extracts atomic claims, finds what they
 *              collide with, and RULES on what died. Returns the revisions.
 *   believe    Ask what is currently true. Dead claims are not retrievable - not
 *              down-ranked, not out-weighted. Gone from the belief set.
 *   history    Ask what it USED to believe, and when it changed its mind. No other
 *              memory system can answer this, because no other one keeps the body.
 *   forget     Refute a claim directly. Human override, with a reason recorded.
 *
 * Run:  pnpm mcp
 * Wire into Claude Code:  claude mcp add palimpsest -- pnpm --dir <repo> mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { ClaimStore } from '../memory/store.js';
import { remember } from '../memory/remember.js';
import { answerPalimpsest } from '../bench/baseline.js';
import { decayedConfidence } from '../memory/types.js';

const store = new ClaimStore(process.env.PALIMPSEST_DB ?? './palimpsest.db');

const server = new McpServer({
  name: 'palimpsest',
  version: '0.1.0',
});

// ---------------------------------------------------------------- remember

server.registerTool(
  'remember',
  {
    title: 'Remember a conversation',
    description:
      'Feed a conversation or note into memory. It is broken into atomic claims, ' +
      'each checked against what is already believed, and anything it CONTRADICTS is ' +
      'marked dead - retained, but no longer served as true. Returns what was learned ' +
      'and, more importantly, what it killed.',
    inputSchema: {
      transcript: z.string().describe('The conversation or note to remember.'),
      date: z
        .string()
        .optional()
        .describe('ISO date the conversation happened (YYYY-MM-DD). Defaults to today. ' +
          'This matters: a claim cannot supersede one observed AFTER it.'),
    },
  },
  async ({ transcript, date }) => {
    const result = await remember(store, {
      id: `mcp-${Date.now()}`,
      date: date ?? new Date().toISOString().slice(0, 10),
      transcript,
    });

    const killed = result.revisions.flatMap((r) =>
      r.killed.map((k) => ({
        wasBelieved: k.claim.content,
        heldSince: new Date(k.claim.observedAt).toISOString().slice(0, 10),
        nowBelieve: r.incoming.content,
        because: k.reason,
      })),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              learned: result.added.map((c) => ({ claim: c.content, kind: c.kind })),
              revised: killed,
              alreadyKnew: result.revisions.flatMap((r) => r.duplicateOf.map((d) => d.content)),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------- believe

server.registerTool(
  'believe',
  {
    title: 'Ask what is currently true',
    description:
      'Answer a question from what the memory believes RIGHT NOW. Superseded claims ' +
      'are not retrieved - not down-ranked, not out-weighted, absent. Returns the ' +
      'answer plus the claims it was drawn from, with their decayed confidence, so ' +
      'you can always check the working.',
    inputSchema: {
      question: z.string().describe('What you want to know.'),
    },
  },
  async ({ question }) => {
    const now = Date.now();
    const answer = await answerPalimpsest(store, question, now);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              answer,
              drawnFrom: store
                .believed(now, 0)
                .slice(0, 5)
                .map((c) => ({
                  claim: c.content,
                  confidence: Number(c.confidence.toFixed(2)),
                  learned: new Date(c.observedAt).toISOString().slice(0, 10),
                })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------- history

server.registerTool(
  'history',
  {
    title: 'Ask what it used to believe',
    description:
      'What did this memory believe before, and when did it change its mind? Returns ' +
      'dead claims with the claim that killed them, the date, and the reason. No other ' +
      'memory system can answer this, because no other one keeps the body.',
    inputSchema: {
      about: z
        .string()
        .optional()
        .describe('Filter to claims mentioning this (case-insensitive). Omit for everything.'),
    },
  },
  async ({ about }) => {
    const needle = about?.toLowerCase();
    const dead = store
      .all()
      .filter((c) => c.status !== 'active')
      .filter((c) => !needle || c.content.toLowerCase().includes(needle))
      .map((c) => ({
        usedToBelieve: c.content,
        heldFrom: new Date(c.observedAt).toISOString().slice(0, 10),
        died: c.supersededAt ? new Date(c.supersededAt).toISOString().slice(0, 10) : null,
        because: c.deathReason,
        nowBelieve: c.supersededBy ? store.get(c.supersededBy)?.content : undefined,
        fromWhatYouSaid: c.sourceQuote,
      }));

    return {
      content: [
        {
          type: 'text',
          text: dead.length
            ? JSON.stringify(dead, null, 2)
            : 'Nothing has been superseded yet - the memory has not had to change its mind.',
        },
      ],
    };
  },
);

// ---------------------------------------------------------------- forget

server.registerTool(
  'forget',
  {
    title: 'Refute a claim directly',
    description:
      'Human override: mark a belief false. It is retained with the reason, not ' +
      'deleted - the memory should be able to show that you corrected it, and when.',
    inputSchema: {
      claim: z.string().describe('Text of the claim to refute (substring match).'),
      reason: z.string().describe('Why it is false. This goes in the audit log.'),
    },
  },
  async ({ claim, reason }) => {
    const needle = claim.toLowerCase();
    const hits = store.active().filter((c) => c.content.toLowerCase().includes(needle));

    if (hits.length === 0) {
      return { content: [{ type: 'text', text: `No active claim matches "${claim}".` }] };
    }

    const now = Date.now();
    for (const c of hits) store.refute(c.id, reason, now);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { refuted: hits.map((c) => c.content), because: reason },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------- resource

server.registerResource(
  'beliefs',
  'palimpsest://beliefs',
  {
    title: 'Current belief set',
    description: 'Everything the memory currently holds true, with decayed confidence.',
    mimeType: 'application/json',
  },
  async (uri) => {
    const now = Date.now();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            store.believed(now, 0).map((c) => ({
              claim: c.content,
              kind: c.kind,
              confidence: Number(decayedConfidence(c, now).toFixed(2)),
              learned: new Date(c.observedAt).toISOString().slice(0, 10),
            })),
            null,
            2,
          ),
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
