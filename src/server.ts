/**
 * The deployed backend. Runs on Alibaba Cloud Function Compute, calls Qwen Cloud.
 *
 *   GET  /                   the audit view (rendered from the live store)
 *   GET  /api/believe?q=...  answer a question from what the memory currently believes
 *   POST /api/remember       {transcript, date} -> run the full pipeline, report what died
 *   GET  /api/claims         the raw belief set, dead claims included
 *
 * This is the "Proof of Alibaba Cloud Deployment" artifact the rules ask for: a
 * backend, running on Alibaba Cloud infrastructure, calling Qwen Cloud APIs. It is
 * also the better demo - a judge can type a contradicting fact into it and watch
 * the memory revise itself, without cloning anything.
 *
 * HONEST LIMITATION, stated rather than hidden: Function Compute is serverless and
 * its filesystem is ephemeral. The deployment ships with a pre-seeded store; writes
 * made during a session live in /tmp and vanish when the container recycles. That
 * is fine for a demo and wrong for a database, and we say so in the README instead
 * of implying durability we do not have.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { copyFileSync, existsSync } from 'node:fs';
import { ClaimStore } from './memory/store.js';
import { remember } from './memory/remember.js';
import { answerPalimpsest } from './bench/baseline.js';
import { decayedConfidence } from './memory/types.js';

const PORT = Number(process.env.FC_SERVER_PORT ?? process.env.PORT ?? 9000);

// Function Compute mounts the code read-only. Copy the seeded store somewhere writable.
const SEED = process.env.PALIMPSEST_SEED ?? './palimpsest.db';
const LIVE = process.env.PALIMPSEST_DB ?? '/tmp/palimpsest.db';
if (SEED !== LIVE && existsSync(SEED) && !existsSync(LIVE)) copyFileSync(SEED, LIVE);

let store = new ClaimStore(LIVE);

/**
 * Put the memory back to its seeded state.
 *
 * Needed because the demo is stateful and the interesting claims are killable exactly ONCE - tell
 * it "we moved to DuckDB" twice and the second time it correctly answers "I already knew that",
 * which is right but makes for a terrible demo. Anyone showing this to someone else needs a way
 * back to a clean slate, and so does a judge who wants to try it twice.
 *
 * Deliberately unauthenticated, like the rest of the API. The worst anyone can do is return a
 * public demo to the exact state it ships in.
 */
function resetStore(): { claims: number; dead: number } {
  store.close();
  copyFileSync(SEED, LIVE);
  store = new ClaimStore(LIVE);
  const all = store.all();
  return { claims: all.length, dead: all.filter((c) => c.status !== 'active').length };
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const now = Date.now();

  try {
    // ---- the audit view
    if (req.method === 'GET' && url.pathname === '/') {
      const { renderMemory } = await import('./render/html.js');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderMemory(store.all(), now));
      return;
    }

    // ---- what does it believe, right now?
    if (req.method === 'GET' && url.pathname === '/api/believe') {
      const q = url.searchParams.get('q');
      if (!q) return json(res, 400, { error: 'missing ?q=' });

      const answer = await answerPalimpsest(store, q, now);
      return json(res, 200, {
        question: q,
        answer,
        // Show the working. The point of this system is that you can always ask WHY.
        drawnFrom: store
          .believed(now, 0)
          .slice(0, 5)
          .map((c) => ({ claim: c.content, confidence: Number(c.confidence.toFixed(2)) })),
      });
    }

    // ---- tell it something. watch it revise.
    if (req.method === 'POST' && url.pathname === '/api/remember') {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        transcript?: string;
        date?: string;
      };
      if (!body.transcript) return json(res, 400, { error: 'missing "transcript"' });

      const result = await remember(store, {
        id: `live-${now}`,
        date: body.date ?? new Date(now).toISOString().slice(0, 10),
        transcript: body.transcript,
      });

      return json(res, 200, {
        learned: result.added.map((c) => ({ claim: c.content, kind: c.kind })),
        // The whole product, in one field.
        killed: result.revisions.flatMap((r) =>
          r.killed.map((k) => ({
            wasBelieved: k.claim.content,
            since: new Date(k.claim.observedAt).toISOString().slice(0, 10),
            killedBy: r.incoming.content,
            because: k.reason,
          })),
        ),
        alreadyKnew: result.revisions.flatMap((r) => r.duplicateOf.map((d) => d.content)),
      });
    }

    // ---- back to the seeded state. The demo is stateful; you need a way to run it twice.
    if (url.pathname === '/api/reset' && (req.method === 'POST' || req.method === 'GET')) {
      const { claims, dead } = resetStore();
      // A GET is allowed so you can reset by pasting the URL in the address bar - which is what
      // you want when you are mid-demo and do not have a terminal to hand.
      if (req.method === 'GET') {
        res.writeHead(302, { location: '/' });
        res.end();
        return;
      }
      return json(res, 200, { reset: true, claims, dead });
    }

    // ---- the raw belief set, corpses included
    if (req.method === 'GET' && url.pathname === '/api/claims') {
      return json(
        res,
        200,
        store.all().map((c) => ({
          content: c.content,
          kind: c.kind,
          status: c.status,
          observedAt: new Date(c.observedAt).toISOString().slice(0, 10),
          confidence: Number(decayedConfidence(c, now).toFixed(2)),
          deathReason: c.deathReason,
          sourceQuote: c.sourceQuote,
        })),
      );
    }

    json(res, 404, { error: 'not found', routes: ['/', '/api/believe?q=', '/api/remember', '/api/claims'] });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
};

createServer((req, res) => {
  void handler(req, res);
}).listen(PORT, () => {
  console.log(`palimpsest listening on :${PORT}`);
});
