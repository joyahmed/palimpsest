# Benchmark results

Every number here is produced by `pnpm bench`. Every model call behind them is
cached in `.cache/llm/` and committed to this repo - clone it, run it, get the same
numbers, with no API key and no spend. `PALIMPSEST_CACHE_ONLY=1` makes a cache miss
throw rather than silently hit the API.

Results are reported whether or not they flatter the project. The first one did not.

---

## v2 - 2026-07-12 - **the thesis holds**

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
