# Palimpsest, second dogfood pass — what landed, and the one that made things worse

Follow-up to [`dogfood-findings-2026-08-20.md`](./dogfood-findings-2026-08-20.md). Same
method: findings from **one real session**, not a review. This one was a greenfield repo
(`zetta-inventory`) — planning and documentation, no code yet — which turned out to be the
useful case, because a brand-new project is where scoped recall either works or is exposed.

Session shape: 16 VERIFIED + 10 BELIEVED + 8 DOUBTED recalled at start, **4 used**,
3 asserted, 1 supersede, 1 filtered `beliefs` query.

---

## ✅ Fix 2 landed and it works

*"Stop storing `event`; git already does it"* — adopted. The recall block now says:

> `HELD BUT NOT SHOWN: 66 of kind event, decision.`

66 claims withheld, and nothing was missed by their absence. This was called the single
largest noise reduction available and it delivered. The preamble explaining *why* they are
withheld (and that `beliefs` will return them on request) is the right touch — it removes
the worry that something is being hidden.

## ✅ World-verification landed

A claim can now carry a `probe` and an `expect`, and verified claims arrive in their own
section with the instruction not to spend a lookup re-deriving them. This directly answers
the older `f88c37ba` complaint that *"confidence measures age"* — a probed claim stops
depending on its age entirely. Sixteen claims arrived VERIFIED and none of them needed
re-checking. Good.

## ⚠️ Fix 1 shipped as a field, and the problem it targeted is NOT fixed

`assert` now takes `projects`. Both of the original note's problems survived it.

**Problem A — recall cost. Unchanged.** A `zetta-inventory` session received, among others:
Zetta HRM's API port and prefix, Zetta HRM's route-seed script and full-seed script, Banani
DOHS's `--builder swc` dev script, zetta-community's API response contract, zetta-cloud's
local-dev recipe. Every one of those names its own project **in the claim text**. Roughly
two-thirds of the injected `config` was other repos'. The recall preamble asserts *"other
projects' facts are left out because they cost tokens here and answer nothing"* — that did
not happen, because those claims carry no scope to filter on.

**The field exists; nobody fills it in.** Omission means global, so the lazy path and the
wrong path are the same keystroke. The tool description already warns against exactly this —
*"Omitted means global… that is the safe default, not a cheap one, so do not use it to avoid
deciding"* — and the warning loses, because it is read once at session start and the decision
happens hundreds of thousands of tokens later. **Same affordance failure the 2026-08-20 note
diagnosed for `supersedes`, in a new field.**

**Problem B — a second, opposite failure mode, new since the field shipped.**

`b25fa56d` — *"The Bash tool's working directory persists between calls"* — was scoped
`projects: ["zetta-hrm"]`, because that is the repo it was learned in. It is a property of
the harness and true in every repo.

It was in context, at 0.96 confidence, during this session. It did not fire — it read as *a
fact about that project's sessions*. Minutes later: `cd docs` in one call, then
`cd docs/domains && cat > file.md` in the next, which resolved against `docs/` and failed;
`&&` short-circuited only the first heredoc and the rest wrote into the wrong directory.
**The exact failure the belief predicts, with the belief on screen.**

Superseded 2026-09-06 by a globally-scoped restatement (`a7d55e03`).

## ⛔ The 2026-08-20 proposal, implemented as written, would CAUSE Problem B

That note proposed: *"infer `project` from cwd at `assert` time, overridable."*

**Do not.** Inferring scope from cwd records **where a fact was learned**, not **what it is
about**. For any fact about the harness, the shell, the machine, or Joy himself, those two
things point in opposite directions — and cwd-inference reliably picks the wrong one.
`b25fa56d` is what that looks like: correct claim, correct kind, correct confidence, wrong
scope, silently useless everywhere it mattered.

Scope is a semantic property of the claim. It cannot be read off the environment.

## ⚠️ Fix 3 still open, and it failed the same way again

*"Warn at `assert` time — 3 existing beliefs share this subject."* Not implemented; the
guidance became prose in the tool description instead (*"CALL THIS BEFORE `assert`… that
check is now your job"*).

This session: **3 asserts, `beliefs` called first ZERO times.** The one supersede that did
happen came from noticing the failure by hand, not from checking the store. The outcome was
correct by luck — the contradicted claim happened to be in the injected VERIFIED block. Had
it been among the 66 withheld, a duplicate would have been stored silently.

The 2026-08-20 diagnosis holds and is now confirmed twice: **prose at session start does not
survive to write time.** The check has to live in the write path or it does not exist.

---

## The design question this opens: what the two tiers actually are

Splitting global from project-local is right, and for a sharper reason than recall cost:
**one namespace means two identically-worded claims about different things can supersede each
other.** `eec3e70c` says *"The Zetta HRM web dev server runs on port 3000"*; the next Next.js
project will also use 3000. Same sentence, different facts, and adjudication is a model
reading text. Separate tiers make that collision structurally impossible — the same reason
`kind` works, which is that it turned a judgment into a slot.

Three constraints on the design, each learned the hard way:

### 1. The global tier holds claims about a CLASS, not claims that happen to be true widely

- *"zetta-hrm uses pnpm and Turborepo"* — an instance fact. Never applies elsewhere.
- *"Joy's monorepos use pnpm and Turborepo"* — a convention. Covers the next project **by
  construction**, with no derivation, no copy, no new belief.

That distinction is the whole mechanism. A convention already applies to a new project
because that is what a convention *is*.

### 2. Do NOT auto-derive a belief for a new scope

The tempting feature — *take a belief from project A and produce the version appropriate for
project B* — is an inference engine, and the store already holds the argument against it
(`d5952792`): *"assert observations rather than inferences… the precedent is `a284a3e5`: a
teammate's commit emoji was inferred from repo history to be Joy's convention, written down
as fact, and survived weeks."*

Auto-derivation manufactures `a284a3e5` on purpose, continuously, and ships each one with a
confidence score — which is what makes a guess look like knowledge. Derive `f7771baf` into a
new NestJS project and you have asserted a port nobody chose and a prefix nobody wrote: right
often enough to be trusted, wrong often enough to cost a debugging round, and then read as a
premise by the next derivation.

**The bridge between tiers is promotion, not derivation.** When the same instance fact
appears in three repos, that is *evidence* a convention exists, and it gets **restated** as a
class claim with the instances as support — reviewed, deliberate, one direction. Joy's
`CLAUDE.md` already describes this for the markdown memory tier (*"write there during a
session if you like, then drain it: promote each file to one of the two homes"*) and
`/si:promote` implements it. Port the pattern that is already trusted; do not invent an
automatic one.

### 3. Supersede must be INTRA-TIER only

A local fact contradicting a global convention is an **exception**, not a refutation.

Live example from the session this note came from: a global convention holds that Joy's
projects are Turborepo monorepos; `zetta-inventory` is deliberately a single Next.js app with
no turborepo. If local can supersede global, one intentional exception erases a true
generalization about every other repo. If global can supersede local, a convention overwrites
something actually observed.

Neither. Store it as an exception that names the global claim it departs from — *"this
project breaks the usual rule, on purpose"* is more useful to a future session than either
overwrite.

### 4. Keep `projects: string[]`; add the tier as a REQUIRED field

Do not collapse scope to a global/local boolean. There is a middle case immediately: *"the
zetta-\* repos deploy via push-to-main GitHub Actions"* is true of four repos — not global
(not about Joy or the machine), not local (spans repos). A boolean has nowhere to put it.

Keep the list. Make the **tier** an explicit required choice so global-vs-scoped stops being
encoded by *omission*, which is the actual bug behind Problem A.

---

## Summary of what to change

| | |
|---|---|
| ⛔ Do not implement | cwd-inferred scope (causes Problem B); auto-derivation across scopes |
| ⭐ Highest leverage | make tier/scope a **required** field on `assert`, not an omittable one |
| ⭐ Second | move the duplicate-subject check into the `assert` **response** — prose at session start has now failed twice |
| ✅ Keep | `event` exclusion from recall; probes and the VERIFIED section; DOUBTED as its own block |
| Design | intra-tier supersede only; cross-tier contradiction stored as an exception; promotion, never derivation |

**Cheap lint that would have caught both of this session's scope failures** — two string
rules against the known repo list:

- claim text names a project that is not in `projects` → *should this be scoped?*
- `projects` is set but the claim text names no file, path or identifier belonging to it →
  *should this be global?*
