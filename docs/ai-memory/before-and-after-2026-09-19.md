# Palimpsest - before and after 2026-09-19

The day the public repo became the daily driver. One session, supermode, ~5 hours of work,
16 commits. This is the record of what changed, so nobody has to reconstruct it from the log.

## What it was, the morning of 2026-09-19

| | |
|---|---|
| **Purpose** | A hackathon entry (Qwen Cloud MemoryAgent track), then a second entry in flight (Amazon Alexa+). A live site on Alibaba Function Compute that had died when the Qwen quota ran out. |
| **Provider** | Qwen Cloud, quota gone; a Claude port landed the night before, unproven live. |
| **Test** | `pnpm smoke` - four checks against the provider. No end-to-end test of the loop the project exists for. |
| **Tools** | 4 on the MCP server: `remember`, `believe`, `history`, `forget`. |
| **Recall** | None. Nothing put the memory into a session; the agent had to think to call `believe`. |
| **Scope** | None. Every claim served everywhere. |
| **Verification** | None. Age was the only signal. |
| **Fast path** | None. Every write cost two model calls (~20 s). |
| **Paths** | DB, model cache and embedding model resolved against cwd - as an MCP server, that is whatever repo the session is in. |
| **Daily use** | The private repo (`palimpsest-memory`, no model inside, agent-driven `assert`/`supersede`) on the office WSL box, months of real beliefs. The public repo was not used for real work at all. |
| **Benchmark** | 79% vs 58%, 0 dead served, Qwen recording, n=19. |
| **Known bugs** | Unknown - nothing was measuring. |

## What it is, the evening of 2026-09-19

| | |
|---|---|
| **Purpose** | A local MCP memory for Claude Code, for everyday use, public for anyone. No site. The hackathons are history; the Alexa+ page still runs locally under `pnpm serve`. |
| **Provider** | Claude through the Claude Code login (`claude -p`), no key; local bge-small embedder. Qwen kept only to read the old recording at the `qwen-submission` tag. |
| **Test** | `pnpm test` - 15 checks, live, ~85 s, scratch DB removed after. Remember → believe → contradiction kills → believe flips → store keeps the body → restatement refreshes → recall shows the live one → scope withholds → probes pass/fail/unknown → old schemas migrate → a private-predecessor file is inherited → both MCP transports serve seven tools. |
| **Tools** | 7: `remember`, `believe`, `history`, `forget`, `assert`, `reaffirm`, `verify`. |
| **Recall** | SessionStart hook (`build/cli/recall.js`): VERIFIED / BELIEVED / CONTRADICTED / DOUBTED blocks with 8-char ids, event/decision withheld and counted, other projects' claims withheld and counted, loud failure text, budgeted payload, always exit 0. |
| **Scope** | `projects: string[]` on claims; identity/preference always global; unscoped = global (fail-open); recall filters by the git toplevel's name. Never inferred from cwd. |
| **Verification** | `probe` + `expect` on a claim; `verify` runs them on demand only; passed = 1 for a day, failed = 0, unknown = decay; `PALIMPSEST_UNKNOWN` sentinel. |
| **Fast path** | `assert` (instant, local embedding, `supersedes` by id prefix) and `reaffirm`. |
| **Paths** | Anchored to the checkout via `src/paths.ts`; `~` expanded; the DB's directory created on first run. Daily driver: `~/.palimpsest/memory.db`, cache `~/.palimpsest/cache`. |
| **Daily use** | Registered user-scoped on JOYR5 and proven through headless Claude Code (remember → believe; assert-with-probe → verify → recall VERIFIED). Ready to take over the office memory file: `pnpm backfill` embeds the inherited claims in place. |
| **Benchmark** | 95% vs 63%, 11/11 changed facts, 0 dead served, Claude recording, n=19; replay = 500 hits / 0 miss, no key. |
| **Bugs found and fixed by the new test** | (1) 4 of 10 runs answered UNKNOWN: extraction emitted a "was changed" event beside the value. (2) First Claude bench served one dead fact: an event ("Sarah gave the September 1st date") answered over the live config ("October 15th"). Both are history read as state; both fixed in prompts, both now covered. |

## What was NOT done, on purpose

- No `pnpm measure` (the private repo's token-cost meter). Joy: *"i won't miss it."*
- No second benchmark fixture; n=19 written by us remains the only one.
- No test on macOS or plain Linux - only WSL2 has run it.
- No claim of "100% working". `pnpm test` answers *does it work*; only use answers *does it help*.

## Where it stops - 2026-09-19

Joy: *"we'd be stopping with palimpsest. and obvio we can test it time to time when we work on
other repos."* So: installed, in the loop of every session through the recall hook, and judged
passively. The next palimpsest commit is one that a real session earns - a bug it shows, a claim
it caught, a payload that got too long - not a feature.
