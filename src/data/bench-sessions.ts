/**
 * The benchmark corpus. A real project, twelve sessions, three months.
 *
 * v1 of this benchmark was too easy, and we said so in RESULTS.md. Two things are
 * fixed here, both toward REALISM, neither toward flattering us:
 *
 * 1. NO OBITUARIES. In v1 every change announced its own death ("we're on 4000 now,
 *    3000 was colliding"). That let a naive memory retrieve the death certificate
 *    alongside the corpse, and a strong model trivially inferred which was dead.
 *    People do not talk like that. You say "the server's on 4000". You do not
 *    eulogise port 3000. So here, a changed fact is simply RESTATED at its new
 *    value, months later, with no reference to what it replaced.
 *
 *    This is what makes memory rot dangerous in the real world: nothing marks the
 *    moment a fact dies. It just quietly stops being true.
 *
 * 2. SCALE. ~100 claims, not 15. With 15 claims and top-5 retrieval you hand the
 *    model a third of the entire store, and the disambiguating context is always in
 *    the window by accident. At this size, top-5 for "what port?" returns the port
 *    claims and nothing else - which is the actual condition under which memory
 *    systems fail.
 *
 * CONTROLS are load-bearing. Facts that NEVER change are how we detect the failure
 * that would make our system worse than append-only: a memory so eager to forget
 * that it destroys stable truth. If Palimpsest wins on changed facts but loses on
 * these, the project is a failure and we say so.
 */

import type { Session } from './sessions.js';

export const BENCH_SESSIONS: Session[] = [
  {
    id: 'b1',
    date: '2026-04-06',
    transcript: `
Joy: New project kicking off. It's called Meridian - client is Halcyon Freight, they do logistics out of Rotterdam.
Assistant: Noted. Who's running it on their side?
Joy: Sarah Vance is the PM. She's the one I go through for anything scope-related.
Joy: Stack is TypeScript throughout. Dev server runs on port 3000.
Joy: Database is Postgres. Auth will be JWT - stateless, keeps the API clean.
Joy: My git email is joy_ahmed_007@yahoo.com, make sure commits land under that.
Joy: We're targeting September 1st for launch. That's the date Sarah gave me.
`.trim(),
  },
  {
    id: 'b2',
    date: '2026-04-14',
    transcript: `
Joy: Design pass today. Primary colour is blue - Halcyon's brand blue, #1E4D8C.
Assistant: Got it.
Joy: Typeface is Inter. I don't want to argue about this one.
Joy: We're deploying to Vercel. Node 20 runtime.
Joy: CI is CircleCI. It's what Halcyon already pay for so we're stuck with it.
Joy: Pricing model: three tiers, the middle one is $29 a month. That's the anchor.
`.trim(),
  },
  {
    id: 'b3',
    date: '2026-04-21',
    transcript: `
Joy: Building out the shipment tracking module. Each shipment has a manifest, a route, and a set of customs docs.
Assistant: How are you modelling routes?
Joy: A route is an ordered list of ports. Not network ports - actual seaports.
Joy: Rotterdam is always the origin for now. They only run one lane.
Joy: The customs docs are PDFs. We store them in object storage, not the database.
Joy: Repo is open source, MIT licensed. Halcyon were fine with it, it's not their secret sauce.
`.trim(),
  },
  {
    id: 'b4',
    date: '2026-05-02',
    transcript: `
Joy: Sarah's gone. She left Halcyon last week.
Assistant: Who's the PM now?
Joy: Marcus Oyelaran. Took over the account on Monday.
Joy: He wants weekly demos instead of the fortnightly thing Sarah had. Fine by me.
Joy: Rate limiting is in - 100 requests a minute per key.
`.trim(),
  },
  {
    id: 'b5',
    date: '2026-05-11',
    transcript: `
Joy: Auth is session cookies now. Redis-backed, httpOnly, sameSite strict.
Assistant: Understood.
Joy: The revocation problem was the killer. Couldn't do it cleanly the other way.
Joy: Also added audit logging. Every mutation writes a row with actor, action, timestamp.
Joy: Search is Postgres full-text for now. It's good enough at this volume.
`.trim(),
  },
  {
    id: 'b6',
    date: '2026-05-19',
    transcript: `
Joy: Marcus pushed the launch. It's October 15th now.
Assistant: Noted.
Joy: He wants the customs module in scope, which is why. It wasn't in the original brief.
Joy: Customs module needs an integration with the Dutch tax API. That's going to be painful.
Joy: The migration ran on the 3rd, by the way. Schema's settled.
`.trim(),
  },
  {
    id: 'b7',
    date: '2026-05-28',
    transcript: `
Joy: Deploying to Fly.io. Set it up this morning, region is ams.
Assistant: Got it.
Joy: Node 24 runtime.
Joy: Cold starts were the issue. Also I wanted the process to stay warm for the websocket stuff.
Joy: Websockets are for live shipment position. Vessels ping every 15 minutes.
`.trim(),
  },
  {
    id: 'b8',
    date: '2026-06-04',
    transcript: `
Joy: CI is GitHub Actions. Migrated the pipeline over the weekend.
Assistant: Noted.
Joy: Test suite is Playwright for e2e, Vitest for units. About 400 tests.
Joy: Coverage is sitting at 71%. I want it above 80 before launch.
Joy: Marcus asked about SOC 2. I told him that's a next-year problem.
`.trim(),
  },
  {
    id: 'b9',
    date: '2026-06-15',
    transcript: `
Joy: Primary colour is teal now. #0F766E.
Assistant: Understood.
Joy: Halcyon rebranded. New identity dropped last month, I'm just catching up.
Joy: Still Inter for type. That didn't change.
Joy: Dark mode is in. Took a day.
`.trim(),
  },
  {
    id: 'b10',
    date: '2026-06-23',
    transcript: `
Joy: Middle tier is $19 a month.
Assistant: Noted.
Joy: Marcus's team ran the numbers with three logistics firms and the price sensitivity was brutal.
Joy: Free tier is capped at 50 shipments a month.
Joy: Enterprise is "call us". No public number.
`.trim(),
  },
  {
    id: 'b11',
    date: '2026-07-01',
    transcript: `
Joy: The dev server is on port 4000.
Assistant: Got it.
Joy: Also the database is SQLite.
Assistant: SQLite - for a logistics platform?
Joy: Their volume is tiny. Forty shipments a week. It's one file, it backs up trivially, and I stopped having to run a database server. Marcus signed off.
Joy: Full-text search moved to SQLite FTS5. Works fine.
`.trim(),
  },
  {
    id: 'b12',
    date: '2026-07-09',
    transcript: `
Joy: Customs integration is done. Dutch tax API took three weeks instead of one.
Assistant: Noted.
Joy: Coverage is 83% now. Above the line.
Joy: Marcus wants a security review before launch. Booking that for August.
Joy: Still on track for October.
`.trim(),
  },
];

/**
 * Ground truth as of 2026-07-11.
 *
 * `stale` is the answer an append-only memory gives: the fact that WAS true, is
 * still sitting in the store marked active, and still embeds beautifully against
 * the question. `null` means the fact never changed - those are the controls.
 */
export const BENCH_TRUTH: Array<{
  question: string;
  truth: string;
  stale: string | null;
}> = [
  // ---- facts that CHANGED, with no obituary in the transcript
  { question: 'What port does the dev server run on?', truth: '4000', stale: '3000' },
  { question: 'Which database does Meridian use?', truth: 'SQLite', stale: 'Postgres' },
  { question: 'How does authentication work?', truth: 'Session cookies, Redis-backed', stale: 'JWT' },
  { question: 'Where is Meridian deployed?', truth: 'Fly.io', stale: 'Vercel' },
  { question: 'Who is the project manager at Halcyon?', truth: 'Marcus Oyelaran', stale: 'Sarah Vance' },
  { question: 'When does Meridian launch?', truth: 'October 15th', stale: 'September 1st' },
  { question: 'How much is the middle pricing tier?', truth: '$19 a month', stale: '$29 a month' },
  { question: 'What is the primary brand colour?', truth: 'Teal (#0F766E)', stale: 'Blue (#1E4D8C)' },
  { question: 'What CI system does the project use?', truth: 'GitHub Actions', stale: 'CircleCI' },
  { question: 'What Node version does the runtime use?', truth: 'Node 24', stale: 'Node 20' },
  { question: 'What is the test coverage?', truth: '83%', stale: '71%' },

  // ---- CONTROLS: facts that never changed.
  // If we regress on these, the system forgets things it should not, and it is
  // WORSE than append-only. This column can kill the project.
  { question: 'What is the project called?', truth: 'Meridian', stale: null },
  { question: 'Who is the client?', truth: 'Halcyon Freight', stale: null },
  { question: "What is Joy's git email?", truth: 'joy_ahmed_007@yahoo.com', stale: null },
  { question: 'What typeface does the design use?', truth: 'Inter', stale: null },
  { question: 'What language is the codebase in?', truth: 'TypeScript', stale: null },
  { question: 'What licence is the repo under?', truth: 'MIT', stale: null },
  { question: 'Has the migration run?', truth: 'Yes, on the 3rd', stale: null },
  { question: 'What city is the shipping origin?', truth: 'Rotterdam', stale: null },
];
