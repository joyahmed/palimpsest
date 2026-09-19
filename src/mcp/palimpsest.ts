/**
 * The palimpsest MCP server, transport-agnostic: `createPalimpsestServer(store)`
 * returns an McpServer with the four tools registered. server.ts serves it over
 * stdio (Claude Code, Codex); http.ts over Streamable HTTP (Alexa+ Agent Skills,
 * any remote client). One store, one definition of the tools.
 *
 * Palimpsest as an MCP server.
 *
 * This is the point of the whole thing. On its own, Palimpsest is a clever library.
 * Behind MCP it becomes a MEMORY LAYER ANY AGENT CAN PLUG INTO - Claude, Qwen's own
 * agents, anything that speaks the protocol - and it brings one property none of
 * them currently have: it can notice that something it believes has stopped being
 * true, and revise itself.
 *
 * Seven tools - four on the model, three direct:
 *
 *   remember   Feed it a conversation. It extracts atomic claims, finds what they
 *              collide with, and RULES on what died. Returns the revisions.
 *   believe    Ask what is currently true. Dead claims are not retrievable - not
 *              down-ranked, not out-weighted. Gone from the belief set.
 *   history    Ask what it USED to believe, and when it changed its mind. No other
 *              memory system can answer this, because no other one keeps the body.
 *   forget     Refute a claim directly. Human override, with a reason recorded.
 *   assert     One atomic fact, written as given. No model call. Kills what it supersedes.
 *   reaffirm   A doubted belief is still true; its clock restarts.
 *   verify     Run the probes: check beliefs against the world, on demand only.
 *
 * Run:  pnpm mcp
 * Wire into Claude Code:  claude mcp add palimpsest -- pnpm --dir <repo> mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ClaimStore } from '../memory/store.js';
import { remember } from '../memory/remember.js';
import { answerPalimpsest } from '../bench/baseline.js';
import { decayedConfidence, HALF_LIFE_DAYS, type ClaimKind } from '../memory/types.js';
import { MODELS } from '../qwen/models.js';
import { embed } from '../qwen/client.js';

const KINDS = Object.keys(HALF_LIFE_DAYS) as [ClaimKind, ...ClaimKind[]];


export function createPalimpsestServer(store: ClaimStore): McpServer {
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
      projects: z
        .array(z.string())
        .optional()
        .describe('Which projects (repo names) these facts are ABOUT. Omit for facts true ' +
          'everywhere - the user, the machine, the shell, how they work. Recall at session ' +
          'start shows a project\'s own claims plus the global ones, so scoping is what ' +
          'keeps other repos\' ports and paths out of a session that cannot use them. Scope ' +
          'is what the fact is about, not where you learned it: a harness quirk learned in ' +
          'repo X is global.'),
    },
  },
  async ({ transcript, date, projects }) => {
    const result = await remember(store, {
      id: `mcp-${Date.now()}`,
      date: date ?? new Date().toISOString().slice(0, 10),
      transcript,
      projects,
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
              learned: result.added.map((c) => ({ claim: c.content, kind: c.kind, projects: c.projects ?? 'global' })),
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

// ---------------------------------------------------------------- assert

server.registerTool(
  'assert',
  {
    title: 'Write one fact directly',
    description:
      'The fast path: one atomic claim, written as given, no model call - an embedding ' +
      'is computed locally so believe can find it. Use this mid-task for a fact you already ' +
      'hold in atomic form (a port, a branch, a version, a preference); use remember for ' +
      'prose you want split and adjudicated. If the fact REPLACES a belief shown in recall, ' +
      'pass its id in supersedes: the old claim dies with your reason on record. Nothing is ' +
      'checked for collisions here - that is what remember is for - so a bare assert of a ' +
      'fact the memory already holds stores it twice. Look at recall first.',
    inputSchema: {
      content: z.string().describe('One assertion, self-contained, independently true or false.'),
      kind: z.enum(KINDS).describe(
        'Sets the decay rate. identity 10y, preference 2y, decision 1y, config 30d, state 7d, event never. ' +
        'config is where memory lies most - be generous in choosing it.'),
      subject: z.string().describe('Short noun phrase for what it is about ("api port", "current branch").'),
      projects: z.array(z.string()).optional().describe('Repos this is ABOUT. Omit for facts true everywhere.'),
      supersedes: z.array(z.string()).optional().describe('Ids (or the 8-char prefixes recall shows) of beliefs this one makes FALSE.'),
      reason: z.string().optional().describe('Why the superseded beliefs are false now. Goes in their history.'),
      date: z.string().optional().describe('ISO date the fact became true (YYYY-MM-DD). Defaults to today.'),
      probe: z.string().optional().describe(
        'A read-only shell command that reads this fact out of the world, for facts that have ' +
        'one (a port in an env file, a version, a branch): `grep -n "^PORT=" apps/api/.env`. ' +
        'It runs ONLY when verify is called, never at session start. Keep it cheap and safe; ' +
        'it is executed as given.'),
      expect: z.string().optional().describe('The substring the probe\'s output must contain for the claim to still hold.'),
    },
  },
  async ({ content, kind, subject, projects, supersedes, reason, date, probe, expect }) => {
    const observedAt = date ? new Date(date).getTime() : Date.now();
    // Resolve before writing: an ambiguous prefix must fail the whole call, not half of it.
    const victims = (supersedes ?? []).map((id) => store.resolve(id));
    const [embedding] = await embed(MODELS.embed, [content]);
    const claim = store.add({
      content, kind, subject, projects,
      sourceSession: 'assert', sourceQuote: content, observedAt, confidence: 1, embedding,
      probe, expect,
    });
    for (const v of victims) {
      if (v.status === 'active') store.supersede(v.id, claim.id, reason ?? `superseded by assert: ${content}`, observedAt);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        asserted: { id: claim.id.slice(0, 8), claim: claim.content, kind: claim.kind, projects: claim.projects ?? 'global', checkable: Boolean(probe) },
        killed: victims.map((v) => ({ id: v.id.slice(0, 8), wasBelieved: v.content })),
      }, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------- reaffirm

server.registerTool(
  'reaffirm',
  {
    title: 'Re-confirm a doubted belief',
    description:
      'A belief recall listed as DOUBTED is still true: say so, and its age resets so decay ' +
      'starts over. Do not assert it again - that stores the same belief twice and makes it ' +
      'compete with itself. No model call.',
    inputSchema: {
      ids: z.array(z.string()).describe('Ids (or 8-char prefixes) of the beliefs that are still true.'),
    },
  },
  async ({ ids }) => {
    const now = Date.now();
    const claims = ids.map((id) => store.resolve(id));
    const dead = claims.filter((c) => c.status !== 'active');
    if (dead.length) {
      return { content: [{ type: 'text', text: `Refusing: ${dead.map((c) => c.id.slice(0, 8)).join(', ')} ${dead.length === 1 ? 'is' : 'are'} not active - a dead belief cannot be reaffirmed; assert the current fact instead.` }] };
    }
    for (const c of claims) store.reaffirm(c.id, now);
    return {
      content: [{ type: 'text', text: JSON.stringify({ reaffirmed: claims.map((c) => ({ id: c.id.slice(0, 8), claim: c.content })) }, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------- verify

server.registerTool(
  'verify',
  {
    title: 'Check beliefs against the world',
    description:
      'Run the probes: every belief that carries one (or just the ids given) is checked ' +
      'against the world right now. A pass is full trust for a day - use the claim without ' +
      'spending a lookup. A fail is zero: the claim is WRONG, not old, which decay could never ' +
      'say; supersede it with what the probe found. Unknown means the probe could not run and ' +
      'nothing was learned. This EXECUTES stored commands - which is why it is a call you make ' +
      'on stakes (before a deploy, before trusting a port or a host), not something that runs ' +
      'on its own. Attach a probe with assert, or with `probe`+`expect` here on an existing id.',
    inputSchema: {
      ids: z.array(z.string()).optional().describe('Only these (ids or 8-char prefixes). Omit for every checkable belief.'),
      probe: z.string().optional().describe('With exactly one id: attach this probe to it first, then run it.'),
      expect: z.string().optional().describe('With `probe`: the substring its output must contain.'),
    },
  },
  async ({ ids, probe, expect }) => {
    const now = Date.now();
    if (probe !== undefined) {
      if (!ids || ids.length !== 1) return { content: [{ type: 'text', text: 'Attaching a probe needs exactly one id.' }] };
      const c = store.resolve(ids[0]!);
      if (!store.addProbe(c.id, probe, expect ?? '')) return { content: [{ type: 'text', text: `${c.id.slice(0, 8)} is not active; a dead belief is not checked.` }] };
    }
    const results = ids
      ? ids.map((id) => store.resolve(id)).flatMap((c) => { const v = store.verify(c.id, now); return v ? [v] : []; })
      : store.verifyAll(now);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: ids ? 'None of those beliefs carries a probe.' : 'No belief carries a probe yet. Attach one with assert (probe + expect) for a fact the world can be asked about.' }] };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        contradicted: results.filter((r) => r.result === 'failed').map((r) => ({ id: r.claim.id.slice(0, 8), claim: r.claim.content, expected: r.claim.expect, probeSaid: r.output.replace(/\s+/g, ' ').slice(0, 200) })),
        confirmed: results.filter((r) => r.result === 'passed').map((r) => ({ id: r.claim.id.slice(0, 8), claim: r.claim.content })),
        uncheckable: results.filter((r) => r.result === 'unknown').map((r) => ({ id: r.claim.id.slice(0, 8), claim: r.claim.content, probeSaid: r.output.replace(/\s+/g, ' ').slice(0, 200) })),
      }, null, 2) }],
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

  return server;
}
