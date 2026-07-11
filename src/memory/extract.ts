/**
 * Transcript → atomic claims.
 *
 * This is the step that makes forgetting POSSIBLE. A chunk of conversation cannot
 * be killed - it holds facts that are still true alongside facts that have died.
 * So before anything else, we break it into assertions that are independently
 * true or false, each of which can later be superseded on its own.
 *
 * Two things this prompt fights hard for, because both are failure modes we'd
 * otherwise inherit:
 *
 *   ATOMICITY. "Joy moved the API to 4000 and dropped Docker" is TWO claims. If we
 *   store it as one, and later only the port changes, we cannot kill half of it -
 *   and we are back to append-only.
 *
 *   KIND. The decay rate is set by what sort of fact this is. Get `identity` and
 *   `config` confused and the system either forgets who you are or trusts a port
 *   number from March. This single field is what lets one memory hold both.
 */

import { z } from 'zod';
import { MODELS } from '../qwen/models.js';
import { chat } from '../qwen/client.js';
import type { ClaimKind } from './types.js';

const KIND_GUIDE = `
- identity   Who someone/something IS. Name, email, role, employer. Half-life: 10 years.
- preference How someone likes to work, what they favour. Half-life: 2 years.
- decision   A choice that was MADE. Reversible, but deliberately. Half-life: 1 year.
- config     Ports, paths, versions, branches, env, credentials, settings. Half-life: 30 days.
             THIS IS WHERE MEMORY LIES MOST - be generous in classifying here.
- state      What is happening RIGHT NOW. Current task, current status. Half-life: 7 days.
- event      Something that HAPPENED at a point in time. Never decays: the past is fixed.
             "The migration ran on the 3rd" is an event. It can never become false.`;

const SYSTEM = `You extract atomic CLAIMS from a conversation transcript.

A claim is ONE assertion that is independently true or false. It must stand alone,
out of context, and still mean exactly what it meant in the conversation.

RULES:
1. ATOMIC. Split compound statements. "We moved to port 4000 and dropped Docker"
   is TWO claims. If two facts could change independently, they are two claims.
2. SELF-CONTAINED. Resolve pronouns. "He prefers it" is useless later - write
   "Joy prefers Postgres".
3. ONLY WHAT IS ASSERTED. Do not infer, speculate, or summarise. If the transcript
   does not state it, it is not a claim.
4. NO CONVERSATIONAL NOISE. Greetings, hedges, questions, and thinking-out-loud are
   not claims. "Maybe we should use Redis" is NOT a claim. "We are using Redis" is.
5. QUOTE YOUR SOURCE. Every claim carries the verbatim span it came from, so a
   human can always check your work.

KINDS (this sets how fast the claim rots - get it right):
${KIND_GUIDE}

SUBJECT: a short noun-phrase for what the claim is ABOUT ("dev server port",
"Joy's git email", "database choice"). Claims about the same subject are the ones
that will later collide, so be consistent: the same subject must get the same
label every time.

Return JSON: {"claims": [{"content": string, "kind": string, "subject": string, "quote": string, "confidence": number}]}

confidence is 0..1 - how firmly the transcript asserts it. "We're definitely on
4000" is 1.0. "I think it's 4000?" is 0.5. Hedged statements get low confidence.
Return {"claims": []} if the transcript asserts nothing.`;

const Schema = z.object({
  claims: z.array(
    z.object({
      content: z.string().min(1),
      kind: z.enum(['identity', 'preference', 'decision', 'config', 'state', 'event']),
      subject: z.string().min(1),
      quote: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export interface ExtractedClaim {
  content: string;
  kind: ClaimKind;
  subject: string;
  quote: string;
  confidence: number;
}

export async function extractClaims(transcript: string): Promise<ExtractedClaim[]> {
  const raw = await chat({
    model: MODELS.extract,
    system: SYSTEM,
    user: transcript,
    json: true,
    // Thinking OFF: this is bulk work, and Qwen's default extended thinking burns
    // reasoning tokens deliberating over routine extraction. On a rate-limited free
    // tier that costs throughput, not just money. Reasoning is saved for adjudication,
    // where it actually decides something.
    thinking: false,
    temperature: 0,
  });

  const parsed = Schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Extraction returned malformed JSON: ${parsed.error.message}`);
  }
  return parsed.data.claims;
}
