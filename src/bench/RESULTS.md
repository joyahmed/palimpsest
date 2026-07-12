# Benchmark results

Every number here is produced by `pnpm bench`. Every model call behind them is
cached in `.cache/llm/` and committed to this repo - clone it, run it, get the same
numbers, with no API key and no spend. `PALIMPSEST_CACHE_ONLY=1` makes a cache miss
throw rather than silently hit the API.

Results are reported whether or not they flatter the project. The first one did not.

---

## v3 - 2026-07-12 - **the thesis holds, and the run is now reproducible**

19 questions · 84 claims · 12 sessions over 3 months · top-5 retrieval

|                          | naive RAG    | Palimpsest   |
|--------------------------|--------------|--------------|
| Facts that CHANGED       | 36% (4/11)   | **73% (8/11)** |
| Facts that NEVER changed | 88% (7/8)    | 88% (7/8)    |
| **Overall**              | 58% (11/19)  | **79% (15/19)** |
| **Served a DEAD fact**   | **3**        | **0**        |

Double the accuracy on facts that changed. **No regression on the controls** - the
result that could have killed the project, because a memory so eager to forget that
it destroys stable facts would be *worse* than append-only. And zero dead facts
served, against three.

### Two defects were fixed between v2 and v3, and both moved the numbers

**1. The grader was not deterministic.** v2 graded two systems that had returned the
*identical* answer and marked one correct and one wrong. It now grades by majority of
three independent votes, and reports how often those votes disagree.

> **On this run it disagreed with itself on 0 of 19 questions.** The instrument is
> quiet. Every number above rests on that line, and if it ever stops being 0, the
> numbers get softer and we say so.

**2. The benchmark was silently re-rolling its own dice.** Claim ids are random UUIDs,
minted per run - and they were being interpolated into the adjudication prompt. So two
runs over byte-identical inputs built *different* prompts, missed the cache, and
re-sampled the model every time. The model now sees candidates by ordinal (1, 2, 3),
so the prompt is a pure function of its inputs.

This is why v2's dead-fact count was **4** and v3's is **3**: one of those corpses
(`"What is the test coverage?"` → `"71%"`) was an artefact of the non-determinism, not
a stable failure of naive RAG. The corrected number is *less* flattering to us. It is
the one we report.

> **The replay claim is now true, and was not before.**
> `PALIMPSEST_CACHE_ONLY=1 pnpm bench` → **448 cache hits, 0 misses**, identical
> numbers. Clone the repo, replay it with no API key and no spend, get this table.
> Until v3 that promise was in the README but would have thrown on the Palimpsest arm.

### The three dead facts naive RAG served as current truth

| Question | naive answered | dead since |
|---|---|---|
| Which database does Meridian use? | "Postgres" | 1 Jul |
| When does Meridian launch? | "September 1st" | 19 May |
| What is the primary brand colour? | "#1E4D8C" | 15 Jun |

No hedging. No uncertainty. Three corpses, served with total confidence. Palimpsest
answered all three correctly and served **zero**.

### Where Palimpsest still fails - 3 of 11 changed facts

Reported because they are the honest limits of the current design:

- **"Where is Meridian deployed?"** → answered `"ams"` (the Fly.io *region*) instead of
  `"Fly.io"`. The correct claim was alive in the store and simply wasn't reached. A
  **retrieval** failure, not an adjudication failure.
- **"Who is the PM at Halcyon?"** → `UNKNOWN`. Both systems failed. The Sarah → Marcus
  handover was never retrieved by either.
- **"How does authentication work?"** → both systems answered `"Session cookies"`; the
  truth is `"Session cookies, Redis-backed"`. Both graded wrong, and *equally* wrong -
  which is the point. In v2 this same pair of identical answers got two different
  grades. That was the bug. It is gone.

Palimpsest also misses one control (`"What language is the codebase in?"` → `UNKNOWN`),
and so does naive. Neither system is credited for it.

---

## v2 - 2026-07-12 - **the thesis holds** *(superseded by v3: graded by an instrument
that disagreed with itself, and re-sampled the model on every run)*

19 questions · 80 claims · 12 sessions over 3 months · top-5 retrieval

|                          | naive RAG    | Palimpsest   |
|--------------------------|--------------|--------------|
| Facts that CHANGED       | 36% (4/11)   | **73% (8/11)** |
| Facts that NEVER changed | 88% (7/8)    | 88% (7/8)    |
| **Overall**              | 58% (11/19)  | **79% (15/19)** |
| **Served a DEAD fact**   | **4**        | **0**        |

Double the accuracy on facts that changed, and **no regression on the controls** -
which is the result that could have killed the project. A memory so eager to forget
that it destroys stable facts would be *worse* than append-only. It didn't.

### The four dead facts naive RAG served as current truth

| Question | naive answered | dead since |
|---|---|---|
| Which database does Meridian use? | "Postgres" | 1 Jul |
| When does Meridian launch? | "September 1st" | 19 May |
| What is the primary brand colour? | "#1E4D8C" | 15 Jun |
| What is the test coverage? | "71%" | 9 Jun |

No hedging. No uncertainty. Four corpses, served with total confidence. Palimpsest
answered all four correctly and served **zero**.

### Where Palimpsest still fails - 3 of 11 changed facts

Reported because they are the honest limits of the current design:

- **"Where is Meridian deployed?"** -> answered `"ams"` (the Fly.io *region*) instead
  of `"Fly.io"`. Retrieval surfaced the region claim above the platform claim. This
  is a retrieval failure, not an adjudication failure - the correct claim was alive
  in the store and simply wasn't reached.
- **"Who is the PM at Halcyon?"** -> `UNKNOWN`. Both systems failed. The Sarah ->
  Marcus handover was never retrieved by either.
- **"How does authentication work?"** -> see the grader defect below. The answer was
  right; the grade was not.

### ⚠ Known defect in this run: the grader is not deterministic

On *"How does authentication work?"* both systems returned the identical string
`"Session cookies"`. The grader marked naive **correct** and Palimpsest **wrong**.

Same input, different verdict. That is a bug in the *measuring instrument*, not a
difference between the systems, and it means every number on this page carries noise
it should not. It most likely understates Palimpsest by a point - but the direction
does not matter. **A grader that disagrees with itself cannot certify anything.**

Being fixed before any of these figures are quoted anywhere.

---

## v1 - 2026-07-12 - no measurable advantage

8 questions · 15 claims · top-5 retrieval

|                          | naive RAG | Palimpsest |
|--------------------------|-----------|------------|
| Facts that CHANGED       | 80% (4/5) | 80% (4/5)  |
| Facts that NEVER changed | 100% (3/3)| 100% (3/3) |
| **Overall**              | **88%**   | **88%**    |
| Served a DEAD fact       | 0         | 0          |

**Identical.** The append-only baseline answered every changed fact correctly and
never served a stale one. Adjudication worked mechanically (4 claims correctly
superseded) - it just didn't *matter*.

### Why the baseline won - two flaws, both ours

**1. The fixture leaked the answer.** Every change announced its own death:

> *"It's on port 4000 now, **3000 was colliding** with the other project"*
> *"We're on 'palimpsest' now. **'engine' is dead, I squashed it.**"*

The naive memory retrieves the obituary alongside the corpse, and `qwen3.7-plus`
trivially infers which is dead. Real speech doesn't work like that. You say *"we're
on 4000 now"*. You do not file a death certificate for 3000.

**2. 15 claims with top-5 retrieval hands the model a third of the store.** That is
not RAG. The failure mode we target cannot occur when the disambiguating context is
always in the window by accident.

### What v2 changed - and what was pre-registered before running it

> If the corrected benchmark **still** shows no meaningful gap, the thesis is wrong
> and we change the **design**, not the **chart**.

Two changes, both toward realism, neither toward us:
- changed facts do **not** announce their own death - the new value is simply stated,
  months later, with no reference to what it replaced
- ~100 claims instead of 15, so top-k retrieval is genuinely selective

The gap appeared. The pre-registered condition was met honestly.
