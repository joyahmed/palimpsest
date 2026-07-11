# Benchmark results

Every number here is produced by `pnpm bench`. Every model call behind them is
cached in `.cache/llm/` and committed to this repo - clone it, run it, get the same
numbers, with no API key and no spend. `PALIMPSEST_CACHE_ONLY=1` makes a cache miss
throw rather than silently hit the API.

Results are reported whether or not they flatter the project. The first one did not.

---

## v1 - 2026-07-12 - **no measurable advantage**

8 questions · 15 claims · top-5 retrieval

|                          | naive RAG | Palimpsest |
|--------------------------|-----------|------------|
| Facts that CHANGED       | 80% (4/5) | 80% (4/5)  |
| Facts that NEVER changed | 100% (3/3)| 100% (3/3) |
| **Overall**              | **88%**   | **88%**    |
| Served a DEAD fact       | 0         | 0          |

**Identical.** The append-only baseline - which holds "port 3000" and "port 4000"
as equally live beliefs, with nothing marked dead - answered every changed fact
correctly and never once served a stale one.

Adjudication worked mechanically (4 claims correctly superseded). It just didn't
*matter*. There was nothing for it to be better than.

### Why the baseline won - two flaws, both ours

**1. The fixture leaked the answer.** Every change in the transcripts announced its
own death:

> *"It's on port 4000 now, **3000 was colliding** with the other project"*
> *"We're on 'palimpsest' now. **'engine' is dead, I squashed it.**"*

So the naive memory retrieves `port 3000`, `port 4000`, *and* `port 3000 was
colliding` - and `qwen3.7-plus` trivially infers which one is dead. It never needed
a memory that forgets. It needed a memory that hands it the obituary, and ours did.

Real speech doesn't work like that. You say *"we're on 4000 now"*. You do not file
a death certificate for 3000.

**2. The store was too small for retrieval to mean anything.** 15 claims, top-5
retrieval - we hand the model a third of the entire memory. That is not RAG; it is
showing it nearly everything and letting it sort things out. The failure mode we
target **cannot occur** at this scale, because the disambiguating context is always
in the window.

In a real memory with thousands of claims, the top-5 for *"what port?"* is the two
contradictory port claims and nothing else. No obituary. Just a coin-flip the model
does not know it is making.

### Pre-registered before running v2

> If the corrected benchmark **still** shows no meaningful gap, the thesis is wrong
> - strong models paper over stale memory well enough that adjudication does not
> earn its cost - and we change the **design**, not the **chart**.

v2 changes exactly two things, both toward realism and neither toward us:
- changes that do **not** announce their own death
- enough claims that top-k retrieval is genuinely selective

---

## v2 - *pending*
