# Palimpsest after a full working day — findings and proposed fixes

> **Held back from 2026-08-20 to 2026-09-06, and committed now.** Joy's original
> instruction was *"don't push palimpsest to git"*: while judging was live this repo was
> a submission, and a critique of its own design did not belong in that history unless he
> chose to put it there. The hackathon is over, so that reason has lapsed and he chose to.
> Nothing below has been softened for publication — it is the working file as written.

Written from **one real session**, not a review: ~9 hours in `banani-dohs`,
finishing an admin-pattern conversion, shipping SSLCommerz compliance to a live
site, and porting five API modules. Palimpsest was in the loop the whole time —
61 beliefs recalled at start, ~6 asserted, 1 reaffirmed, 1 `beliefs` query.

---

## ✅ What worked, specifically

- **Recall prevented a real detour.** *"Postgres on 213.190.4.162 is no longer
  reachable from the internet"* meant a failed connection read as expected
  rather than as something to debug. It saved maybe twenty minutes.
- **The stored preference about the tool worked on the tool's own user.**
  *"Palimpsest is a prompt to check, not a source of truth: never act on a
  config without verifying"* — so the firewalled-Postgres belief was TESTED
  before being relied on. A memory system that teaches distrust of itself at the
  right moments is doing something unusual and right.
- **DOUBTED separated from BELIEVED changes behaviour without arithmetic.**
  Three stale claims arrived in their own section and were treated differently
  without any reasoning about confidence numbers. Good interface decision — the
  model does not have to think, it just has to read.
- **Forcing `kind` at write time forces a judgement about volatility.** Deciding
  whether something is `state` (7 days) or `decision` (1 year) is a real
  distinction most memory systems never ask for.
- **Beliefs that die rather than accumulate** is the core idea and it is correct.

---

## ⛔ The stated test, and it failed

A DOUBTED belief in the store says the real test is *"whether Claude reliably
notices a belief has died and writes it down, unprompted."*

**In this session: ~6 asserts, `supersedes` used ZERO times** — while genuinely
reversing two positions:

1. The registration-number decision reversed a prior "do not show it" position.
2. An add-on-gating recommendation was corrected within the hour by Joy.

Both were **appended beside** the beliefs they contradicted rather than
superseding them. `beliefs` was called once, filtered, out of six writes.

⚠️ **This is an affordance problem, not only a discipline problem.** The
instruction to call `beliefs` first lives in a tool description read once at
session start, hundreds of thousands of tokens before the sixth `assert`.
Nothing at write time asks the question.

---

## ⭐ Fix 1 — give a belief a PROJECT dimension (highest leverage)

One change, two problems solved.

**Problem A — recall cost and signal.** 61 beliefs arrived at session start;
the session was spent entirely in `banani-dohs`; most beliefs were Zetta HRM's.
Perhaps 15 of 61 were read closely. Scoped recall would surface ~20 and all of
them would be read.

**Problem B — cross-project conflation, observed live.** During this very
session, the belief *"The **Zetta HRM** API dev server runs on port 3001"* was
reaffirmed using evidence from **banani-dohs** — a different project that
happens to share the port. The `sourceQuote` recorded the mismatch honestly, so
a human would catch it, but the store now holds an HRM claim confirmed by
non-HRM evidence.

**Proposal:** infer `project` from cwd at `assert` time, overridable. Recall
returns `project-scoped ∪ global` (identity, preferences, how-Joy-works).
`reaffirm` warns when the confirming context differs from the belief's project.

## ⭐ Fix 2 — stop storing `event`; git already does it

Well over half of the 61 recalled beliefs were events of the form
*"PLAN item 6.7 shipped 2026-08-20 as commit 2b05eb09"*.

**That is the commit.** Git holds it permanently, with the diff attached and
`git log -S` to search it. And `event` never decays by design — so the store
grows monotonically with facts another system holds better.

**Proposal:** guidance, not code — *let git be the event log*. If events stay,
give them a retention policy or exclude them from default recall. This is the
single largest noise reduction available and it costs nothing to adopt.

## Fix 3 — warn at `assert` time

`subject` is already a field, so this is a lookup: return
*"3 existing beliefs share this subject — supersede one?"* in the assert
response. Optionally require an explicit `supersedes: []` to acknowledge none
apply. Would have caught both of today's misses.

## Fix 4 — `reaffirm` should extend the half-life, not just reset it

`timesReaffirmed` is already tracked but unused in the decay maths. A fact
confirmed three times is **more stable** than one confirmed once.

Concretely: the port-number beliefs sat at **0.41 — doubted** while being true
and unchanged for months, because `config` halves every 30 days regardless.
Meanwhile `decision` entries sit at 1.00 and some are more fragile than a port
number.

⚠️ **Confidence in a value and confidence in its stability are different
quantities.** Decay-by-kind is a good default and a poor universal. Suggest:
`halfLife *= (1 + timesReaffirmed)`, plus a `halfLifeDays` override at assert.

---

## The boundary question this exposed

Joy's `CLAUDE.md` documents a memory topology and `joy-memory-topology.md`
lists five stores — but neither says what palimpsest is **for** relative to
files. In this session the same facts were written to three places and the split
was decided by feel each time.

**The rule that resolves it — does this fact have a shelf life?**

| | store |
|---|---|
| Reasoning, rules, why-the-code-is-like-this | **files in git.** A decision does not become less true with age; it becomes *history*. Must never decay. |
| What is running, what is next, what is currently true of the environment, which client is dead | **palimpsest.** Should decay and be re-checked. |
| Who Joy is, how he works | **ai-super-use**, synced and injected. |

By that rule this session misused it in both directions: **decisions** were
asserted (they should not decay) and **events** were asserted (git owns them).
Palimpsest is strongest at *volatile operational state* — precisely the category
files are worst at, because a file saying "the tunnel is open" is a lie the
moment it closes and nothing makes it stop lying.
