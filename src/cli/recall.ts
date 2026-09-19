/**
 * The recall hook - the half an MCP memory is missing on its own.
 *
 * Palimpsest can hold beliefs, decay them and kill them, and none of that matters
 * if nothing ever CALLS it. Four tools sit there waiting to be chosen, and an
 * agent mid-task has no reason to choose them. The private predecessor of this
 * repo learned that the hard way: the store stayed empty until this hook existed.
 *
 *   A memory that is not in context loses to a memory that is - even when the
 *   one in context is lying.
 *
 * So this prints the belief set as SessionStart `additionalContext`. Claude Code
 * runs it at the start of every session, and the memory is simply there.
 *
 * It never crashes a session - a memory that cannot be read is a bad session, but
 * a hook that throws is a session that does not START. So it always exits 0. It
 * does NOT, however, fail silently: a memory that quietly stops loading lies by
 * omission, which is the exact failure this project exists to kill. When recall
 * breaks, it says so, in the context window, where the agent will read it.
 *
 * Run:  node build/cli/recall.js          # the JSON envelope Claude Code consumes
 *       node build/cli/recall.js --plain  # just the text, for a human
 *
 * Wire it, in ~/.claude/settings.json:
 *   "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
 *     "command": "PALIMPSEST_DB=$HOME/.palimpsest/memory.db /abs/path/to/node /abs/path/to/build/cli/recall.js" } ] } ] }
 */

import { ClaimStore, type Believed } from '../memory/store.js';
import { TRUST_THRESHOLD } from '../memory/types.js';
import { DEFAULT_DB } from '../paths.js';

/** Long enough that a collision needs ~50k claims; short enough to read. */
const ID_LEN = 8;

const PROTOCOL = `PROTOCOL - this memory is writable, and keeping it true is your job.
  Learned something durable  -> \`remember\` it, in the user's words. It is split into atomic
                                 claims and anything it CONTRADICTS above is marked dead for you.
  Unsure what is current      -> \`believe\` answers from what is held NOW; the dead are absent.
  A belief above is FALSE and nothing replaces it -> \`forget\` it with the reason.
  A DOUBTED belief is still true -> \`remember\` it again; a restatement refreshes, not duplicates.
  Nothing is ever deleted. \`history\` says what died, when, and why.`;

/**
 * How much of a believed claim survives into the recall payload.
 *
 * The channel has a ceiling, found the hard way: a 29-belief store once rendered
 * 11.5 KB of additionalContext, the host clipped it to a ~2 KB preview, and two
 * thirds of the belief set never reached the model - including the one that said
 * a production database was open to the internet. Nothing reported it.
 *
 * So believed claims are trimmed and the whole set stays visible. Knowing a belief
 * EXISTS is what lets the agent ask `believe` for it. Knowing nothing forecloses that.
 */
const CLAIM_MAX = 140;
/** Never trim a claim below this: past it a row is a label, and a label cannot be evaluated. */
const CLAIM_MIN = 60;
/** Under the ~10 KB where clipping was observed, with room for the doubted block and the protocol. */
const PAYLOAD_BUDGET = 7000;

/**
 * Kinds that are NOT injected at session start.
 *
 * Measured on the private predecessor: 66% of a 12k-token payload went on `event` and
 * `decision`. An event ("X shipped as commit abc") IS the commit - git holds it, with
 * the diff. A decision does not get less true with age, it becomes history, and the
 * reasoning never fits one claim; those belong in the repo's own docs. Dropping both
 * took break-even from 55 displaced lookups per session to 17, against a real session's
 * 5-20 - the difference between a memory that pays for itself and one that cannot.
 *
 * EXCLUDED FROM RECALL, NOT DELETED. Still in the store, still answered by `believe`
 * and `history`. PALIMPSEST_RECALL_ALL=1 shows everything.
 */
const NOT_INJECTED: ReadonlySet<string> = new Set(['event', 'decision']);

/** Width per believed claim, given how many there are - the set degrades in detail, never in coverage. */
function claimWidth(count: number): number {
  if (count === 0) return CLAIM_MAX;
  const perClaim = Math.floor(PAYLOAD_BUDGET / count) - 30; // 30 ≈ id + kind + confidence
  return Math.max(CLAIM_MIN, Math.min(CLAIM_MAX, perClaim));
}

/** Trim to one line, preferring a sentence boundary, then a word, then a hard cut. */
function trim(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const head = line.slice(0, max);
  const sentence = head.lastIndexOf('. ');
  const cut = sentence > max / 2 ? sentence + 1 : head.lastIndexOf(' ');
  return `${line.slice(0, cut > 0 ? cut : max).trimEnd()} …`;
}

/** Fixed-width rows, so a wall of them can be scanned. `width` null = untrimmed (for DOUBTED). */
function rows(claims: Believed[], width: number | null = null): string[] {
  const kindWidth = Math.max(...claims.map((c) => c.kind.length));
  return claims.map((c) => {
    const body = width === null ? c.content : trim(c.content, width);
    return `  [${c.id.slice(0, ID_LEN)}] ${c.kind.padEnd(kindWidth)}  ${body}  ${c.confidence.toFixed(2)}`;
  });
}

function render(believed: Believed[], doubted: Believed[], withheld: number): string {
  const out: string[] = [
    'Palimpsest - a memory whose beliefs decay and can die. This is what it currently',
    "holds about your work. Confidence falls with age at a rate set by each claim's kind.",
    '',
  ];

  if (!believed.length && !doubted.length) {
    out.push(
      'The memory is EMPTY. Nothing has been remembered yet.',
      '',
      'This is the first session - so there is nothing to recall, only something to start.',
      'As you learn durable facts about the user and their work, `remember` them.',
      '',
      PROTOCOL,
    );
    return out.join('\n');
  }

  if (believed.length) {
    const width = claimWidth(believed.length);
    const clipped = believed.filter((c) => c.content.length > width).length;
    out.push(
      clipped
        ? `BELIEVED - ${believed.length} claims, ${clipped} shown trimmed. Ask \`believe\` for any in full.`
        : 'BELIEVED',
      ...rows(believed, width),
      '',
    );
  }

  if (doubted.length) {
    out.push(
      `DOUBTED - decayed below ${TRUST_THRESHOLD}. NOT false, just too old to be load-bearing.`,
      'Do not repeat these as fact. Check whether each is still true, then `remember` or `forget`.',
      ...rows(doubted),
      '',
    );
  }

  // Say what is missing and why. A memory that quietly serves a fraction of what it holds
  // is lying by omission, and an agent that does not know beliefs were withheld cannot ask.
  if (withheld > 0) {
    out.push(
      `HELD BUT NOT SHOWN: ${withheld} of kind \`${[...NOT_INJECTED].join('`, `')}\`.`,
      "None of it is gone - `believe` and `history` still answer from them. Events and decisions",
      "are left out because git and the repo's own docs hold them better. Ask when you need them.",
      '',
    );
  }

  out.push(PROTOCOL);
  return out.join('\n');
}

/**
 * What the agent is told when recall fails. An agent that silently loses its memory does
 * not behave like one with no memory - it behaves like one whose memory is EMPTY, and it
 * will cheerfully tell you it knows of no current focus, no ports, no branch, and be wrong.
 */
function failure(err: unknown, dbPath: string): string {
  const reason = err instanceof Error ? err.message : String(err);
  return [
    'PALIMPSEST RECALL FAILED - your long-term memory did NOT load this session.',
    '',
    `  database: ${dbPath}`,
    `  error:    ${reason}`,
    '',
    'You are NOT working from an empty memory. You are working from an UNREADABLE one, and',
    'those are not the same. Do not assume you know the current focus, the branch, the ports,',
    'or the versions - you have been told none of them. Ask rather than assert, and do not',
    'write new beliefs until this is fixed.',
    '',
    'TELL THE USER, at the top of your first reply. Reachable causes, in order:',
    '  - the database is corrupt, locked, or is not a database',
    '  - PALIMPSEST_DB points somewhere unreadable, or somewhere that cannot be created',
    '  - the source changed without a rebuild - run `pnpm build`',
  ].join('\n');
}

function forInjection(claims: Believed[]): { shown: Believed[]; withheld: number } {
  if (process.env.PALIMPSEST_RECALL_ALL === '1') return { shown: claims, withheld: 0 };
  const shown = claims.filter((c) => !NOT_INJECTED.has(c.kind));
  return { shown, withheld: claims.length - shown.length };
}

function main(): void {
  const dbPath = process.env.PALIMPSEST_DB ?? DEFAULT_DB;
  let context: string;

  try {
    const store = new ClaimStore(dbPath);
    try {
      const now = Date.now();
      const believed = forInjection(store.believed(now));
      const doubted = forInjection(store.doubted(now));
      context = render(believed.shown, doubted.shown, believed.withheld + doubted.withheld);
    } finally {
      store.close();
    }
  } catch (err) {
    context = failure(err, dbPath);
  }

  if (process.argv.includes('--plain')) {
    console.log(context);
    return;
  }
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
}

try {
  main();
} catch {
  // Last resort: main could not even produce a failure report. No belief is worth refusing
  // to start a session over - this is the ONLY silent path, and it is the one where speaking
  // is not possible.
}

process.exit(0);
