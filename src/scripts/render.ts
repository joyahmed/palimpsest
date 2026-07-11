/**
 * Render the memory as something you can look at.
 *
 *   pnpm render          reads palimpsest.db, writes dist/index.html
 *
 * One self-contained file. No framework, no build step, no external requests -
 * which is also why it drops straight onto Alibaba Cloud as a static asset.
 *
 * The thing this exists to show is the REVISION CHAIN: main -> engine ->
 * palimpsest, each link stamped with the date it died and the reason it died. A
 * terminal can print that. It cannot make you FEEL that the memory kept its own
 * corpses, legible, in order, with the receipts attached.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { ClaimStore } from '../memory/store.js';
import { decayedConfidence, HALF_LIFE_DAYS, type Claim } from '../memory/types.js';

const NOW = Number(process.env.PALIMPSEST_NOW ?? new Date('2026-07-11').getTime());

const store = new ClaimStore(process.env.PALIMPSEST_DB ?? './palimpsest.db');
const all = store.all();
if (all.length === 0) {
  console.error('No claims in the store. Run `pnpm ingest` first.');
  process.exit(1);
}

const byId = new Map(all.map((c) => [c.id, c]));
const active = all.filter((c) => c.status === 'active');
const dead = all.filter((c) => c.status !== 'active');

/**
 * A chain is a fact's whole life: every version of it, oldest first, each one
 * killed by the next. We find the heads (claims nobody superseded) and walk back.
 */
interface Chain {
  head: Claim;
  history: Claim[]; // oldest dead version first
}
const killedBy = new Map<string, Claim>(); // victim id -> killer
for (const c of dead) if (c.supersededBy) killedBy.set(c.id, byId.get(c.supersededBy)!);

const victimsOf = new Map<string, Claim[]>(); // killer id -> victims
for (const [victimId, killer] of killedBy) {
  if (!killer) continue;
  const list = victimsOf.get(killer.id) ?? [];
  list.push(byId.get(victimId)!);
  victimsOf.set(killer.id, list);
}

const chains: Chain[] = active
  .map((head) => {
    const history: Claim[] = [];
    let cursor = head;
    // Walk backwards through everything this claim (transitively) killed.
    for (;;) {
      const victims = victimsOf.get(cursor.id);
      if (!victims?.length) break;
      const victim = victims[0]!;
      history.unshift(victim);
      cursor = victim;
    }
    return { head, history };
  })
  .sort((a, b) => b.history.length - a.history.length || b.head.observedAt - a.head.observedAt);

const revised = chains.filter((c) => c.history.length > 0);
const stable = chains.filter((c) => c.history.length === 0);

// ---------------------------------------------------------------- html

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function claimRow(c: Claim, isDead: boolean): string {
  const conf = decayedConfidence(c, NOW);
  const ageDays = Math.round((NOW - c.observedAt) / 86_400_000);
  const hl = HALF_LIFE_DAYS[c.kind];

  return `
    <div class="claim ${isDead ? 'dead' : ''}">
      <div class="claim-head">
        <span class="kind kind-${c.kind}">${c.kind}</span>
        <span class="content">${esc(c.content)}</span>
      </div>
      <div class="meta">
        <span class="date">${day(c.observedAt)}</span>
        <span class="dot">·</span>
        <span>${ageDays}d old</span>
        <span class="dot">·</span>
        <span>half-life ${Number.isFinite(hl) ? `${hl}d` : 'never decays'}</span>
        ${
          isDead
            ? ''
            : `<span class="dot">·</span>
               <span class="conf">
                 <span class="bar"><i style="width:${(conf * 100).toFixed(0)}%"></i></span>
                 ${conf.toFixed(2)}
               </span>`
        }
      </div>
      ${
        isDead
          ? `<div class="death">
               <span class="skull">†</span> died ${day(c.supersededAt ?? c.observedAt)}
               <span class="reason">${esc(c.deathReason ?? '')}</span>
             </div>`
          : ''
      }
      <details class="prov">
        <summary>provenance</summary>
        <blockquote>${esc(c.sourceQuote || '(no quote captured)')}</blockquote>
        <span class="src">session ${esc(c.sourceSession)}</span>
      </details>
    </div>`;
}

const html = `<title>Palimpsest - what this memory believes, and what it used to</title>
<style>
  :root {
    --bg: #f8fafc; --panel: #fff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0;
    --teal: #0f766e; --teal-soft: #ccfbf1; --dead: #94a3b8; --rose: #9f1239;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b1120; --panel: #0f172a; --ink: #e2e8f0; --muted: #94a3b8; --line: #1e293b;
      --teal: #5eead4; --teal-soft: #134e4a; --dead: #475569; --rose: #fb7185;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0b1120; --panel: #0f172a; --ink: #e2e8f0; --muted: #94a3b8; --line: #1e293b;
    --teal: #5eead4; --teal-soft: #134e4a; --dead: #475569; --rose: #fb7185;
  }
  :root[data-theme="light"] {
    --bg: #f8fafc; --panel: #fff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0;
    --teal: #0f766e; --teal-soft: #ccfbf1; --dead: #94a3b8; --rose: #9f1239;
  }

  body {
    margin: 0; padding: 3rem 1.5rem 6rem; background: var(--bg); color: var(--ink);
    font: 15px/1.6 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 820px; margin: 0 auto; }

  h1 { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; margin: 0 0 .35rem; }
  .sub { color: var(--muted); margin: 0 0 2.5rem; font-size: .95rem; }
  .sub em { color: var(--ink); font-style: normal; font-weight: 550; }

  .stats { display: flex; gap: 2.5rem; padding: 1.25rem 0 1.75rem; border-bottom: 1px solid var(--line); margin-bottom: 2.5rem; }
  .stat b { display: block; font-size: 1.85rem; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .stat span { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; }
  .stat.keep b { color: var(--teal); }

  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; color: var(--muted);
       font-weight: 600; margin: 3rem 0 1.25rem; }

  .chain { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
           padding: 1.1rem 1.25rem; margin-bottom: .9rem; }
  .chain.revised { border-left: 2px solid var(--teal); }

  .claim + .claim { margin-top: .9rem; padding-top: .9rem; border-top: 1px dashed var(--line); }
  .claim-head { display: flex; gap: .6rem; align-items: baseline; }
  .content { font-weight: 480; }
  .claim.dead .content { text-decoration: line-through; text-decoration-thickness: 1px;
                         color: var(--dead); font-weight: 400; }

  .kind { font-size: .64rem; text-transform: uppercase; letter-spacing: .07em; font-weight: 650;
          padding: .16rem .42rem; border-radius: 4px; background: var(--teal-soft); color: var(--teal);
          white-space: nowrap; flex-shrink: 0; }
  .claim.dead .kind { background: transparent; color: var(--dead); border: 1px solid var(--line); }

  .meta { display: flex; align-items: center; gap: .45rem; flex-wrap: wrap;
          color: var(--muted); font-size: .78rem; margin-top: .4rem; padding-left: .1rem; }
  .dot { opacity: .4; }
  .conf { display: inline-flex; align-items: center; gap: .4rem; }
  .bar { display: inline-block; width: 54px; height: 4px; border-radius: 2px;
         background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--teal); }

  .death { margin-top: .5rem; font-size: .8rem; color: var(--rose); display: flex; gap: .45rem;
           align-items: baseline; flex-wrap: wrap; }
  .skull { font-weight: 700; }
  .reason { color: var(--muted); font-style: italic; }

  .prov { margin-top: .5rem; }
  .prov summary { cursor: pointer; font-size: .72rem; color: var(--muted); letter-spacing: .03em;
                  list-style: none; user-select: none; }
  .prov summary::-webkit-details-marker { display: none; }
  .prov summary:before { content: "▸ "; }
  .prov[open] summary:before { content: "▾ "; }
  .prov blockquote { margin: .5rem 0 .3rem; padding: .5rem .75rem; border-left: 2px solid var(--line);
                     color: var(--muted); font-size: .82rem; }
  .src { font-size: .7rem; color: var(--muted); opacity: .7; }

  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
           color: var(--muted); font-size: .82rem; }
  footer b { color: var(--ink); font-weight: 550; }
</style>

<main>
  <h1>Palimpsest</h1>
  <p class="sub">What this memory believes now, and <em>what it used to believe</em>. Nothing was deleted.</p>

  <div class="stats">
    <div class="stat"><b>${active.length}</b><span>believed</span></div>
    <div class="stat"><b>${dead.length}</b><span>superseded</span></div>
    <div class="stat keep"><b>0</b><span>deleted</span></div>
  </div>

  ${
    revised.length
      ? `<h2>Facts that changed - ${revised.length}</h2>
         ${revised
           .map(
             (ch) => `<div class="chain revised">
               ${ch.history.map((c) => claimRow(c, true)).join('')}
               ${claimRow(ch.head, false)}
             </div>`,
           )
           .join('')}`
      : ''
  }

  <h2>Facts that held - ${stable.length}</h2>
  ${stable.map((ch) => `<div class="chain">${claimRow(ch.head, false)}</div>`).join('')}

  <footer>
    Every dead claim keeps its <b>body</b>, its <b>killer</b>, the <b>date</b> and the <b>reason</b>.
    Ask this memory what it used to think, and it can tell you - and show you the sentence it read.
  </footer>
</main>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
store.close();

console.log(
  `\n  dist/index.html\n` +
    `  ${active.length} believed · ${dead.length} superseded · ${revised.length} revision chains\n`,
);
