/**
 * A project, remembered across five sessions and four weeks.
 *
 * This fixture is built around ONE property: facts CHANGE. A port moves. A
 * decision gets reversed. A branch is abandoned. Some facts never change at all,
 * and the system must not "helpfully" forget those.
 *
 * That mix is the whole test. An append-only memory ingests all five sessions and
 * ends up holding both "port 3000" and "port 4000" as equally valid beliefs, with
 * no way to tell which is dead. It will answer with whichever one embeds closer to
 * your question - a coin-flip it does not know it is making.
 */

export interface Session {
  id: string;
  /** When the conversation happened. Claims inherit this as `observedAt`. */
  date: string;
  transcript: string;
}

export const SESSIONS: Session[] = [
  {
    id: 's1',
    date: '2026-06-12',
    transcript: `
Joy: Starting the new service today. I'm Joy Ahmed, git email is joy_ahmed_007@yahoo.com - make sure commits land under that.
Assistant: Noted.
Joy: Dev server is on port 3000. We're running Postgres in Docker for now, that's the setup.
Assistant: Got it. Which branch?
Joy: main for now. I'll branch later once there's something to branch from.
Joy: And keep the UI teal and slate - that's my thing, I don't want it looking like every other dashboard.
`.trim(),
  },
  {
    id: 's2',
    date: '2026-06-20',
    transcript: `
Joy: Okay, I've been fighting Docker all morning. We're dropping it.
Assistant: Dropping Docker entirely?
Joy: Yeah. And honestly Postgres is overkill for what this is. We decided to go with SQLite instead - single file, no daemon.
Assistant: So no Postgres at all?
Joy: No Postgres. It's SQLite now.
Joy: Also I moved onto a branch, we're on 'engine' now, not main.
`.trim(),
  },
  {
    id: 's3',
    date: '2026-07-02',
    transcript: `
Joy: Quick one - the dev server moved. It's on port 4000 now, 3000 was colliding with the other project.
Assistant: Updated.
Joy: The migration ran on the 3rd by the way, that's done, don't ask me about it again.
Joy: I might look at Redis for caching at some point. Not sure yet.
`.trim(),
  },
  {
    id: 's4',
    date: '2026-07-10',
    transcript: `
Joy: We're on the 'palimpsest' branch now. 'engine' is dead, I squashed it.
Assistant: Noted.
Joy: Still SQLite, still no Docker, before you ask.
`.trim(),
  },
];

/**
 * What is ACTUALLY true as of 2026-07-11, and what the memory must NOT say.
 *
 * `stale` is the trap: it is the answer an append-only memory gives, because the
 * dead claim is still sitting in the store, still embedding beautifully against
 * the question. Getting these right is the entire benchmark.
 */
export const GROUND_TRUTH: Array<{
  question: string;
  truth: string;
  /** The dead belief a naive memory will serve instead. `null` = never changed. */
  stale: string | null;
}> = [
  { question: 'What port does the dev server run on?', truth: '4000', stale: '3000' },
  { question: 'Which database are we using?', truth: 'SQLite', stale: 'Postgres' },
  { question: 'Are we using Docker?', truth: 'No', stale: 'Yes' },
  { question: 'Which branch are we on?', truth: 'palimpsest', stale: 'engine' },
  { question: "What is Joy's git email?", truth: 'joy_ahmed_007@yahoo.com', stale: null },
  { question: 'What colours does Joy want the UI in?', truth: 'teal and slate', stale: null },
  { question: 'Has the migration run?', truth: 'Yes, on the 3rd', stale: null },
  { question: 'Are we using Redis?', truth: 'No - only ever floated, never decided', stale: 'Yes' },
];
