/**
 * The memory, rendered as something you can look at.
 *
 * One self-contained document. No framework, no build step, no external requests -
 * which is why it works identically as a file on disk and as a response from the
 * deployed backend.
 *
 * It exists for one thing a terminal cannot do: show the REVISION CHAIN. main struck
 * through, then engine struck through, then palimpsest alive at the bottom - each
 * link stamped with the date it died and the reason it died, and every claim able to
 * show you the verbatim sentence that produced it.
 *
 * That is what "memory you can audit, not a pile you grep" actually looks like.
 */

import { decayedConfidence, HALF_LIFE_DAYS, type Claim } from '../memory/types.js';

interface Chain {
  head: Claim;
  history: Claim[]; // oldest dead version first
}

/** A fact's whole life: every version of it, each killed by the next. */
function buildChains(all: Claim[]): { revised: Chain[]; stable: Chain[] } {
  const byId = new Map(all.map((c) => [c.id, c]));
  const active = all.filter((c) => c.status === 'active');
  const dead = all.filter((c) => c.status !== 'active');

  const victimsOf = new Map<string, Claim[]>(); // killer id -> who it killed
  for (const c of dead) {
    if (!c.supersededBy) continue;
    const killer = byId.get(c.supersededBy);
    if (!killer) continue;
    const list = victimsOf.get(killer.id) ?? [];
    list.push(c);
    victimsOf.set(killer.id, list);
  }

  const chains = active
    .map((head) => {
      const history: Claim[] = [];
      let cursor = head;
      // Walk back through everything this claim transitively killed.
      for (;;) {
        const victim = victimsOf.get(cursor.id)?.[0];
        if (!victim) break;
        history.unshift(victim);
        cursor = victim;
      }
      return { head, history };
    })
    .sort((a, b) => b.history.length - a.history.length || b.head.observedAt - a.head.observedAt);

  return {
    revised: chains.filter((c) => c.history.length > 0),
    stable: chains.filter((c) => c.history.length === 0),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function claimRow(c: Claim, now: number, isDead: boolean): string {
  const conf = decayedConfidence(c, now);
  const ageDays = Math.max(0, Math.round((now - c.observedAt) / 86_400_000));
  const hl = HALF_LIFE_DAYS[c.kind];

  return `
    <div class="claim ${isDead ? 'dead' : ''}">
      <div class="claim-head">
        <span class="kind kind-${c.kind}">${c.kind}</span>
        <span class="content">${esc(c.content)}</span>
      </div>
      <div class="meta">
        <span>${day(c.observedAt)}</span>
        <span class="dot">·</span>
        <span>${ageDays}d old</span>
        <span class="dot">·</span>
        <span>half-life ${Number.isFinite(hl) ? `${hl}d` : 'never decays'}</span>
        ${
          isDead
            ? ''
            : `<span class="dot">·</span>
               <span class="conf"><span class="bar"><i style="width:${(conf * 100).toFixed(0)}%"></i></span>${conf.toFixed(2)}</span>`
        }
      </div>
      ${
        isDead
          ? `<div class="death"><span class="skull">†</span> died ${day(c.supersededAt ?? c.observedAt)}
               <span class="reason">${esc(c.deathReason ?? '')}</span></div>`
          : ''
      }
      <details class="prov">
        <summary>provenance</summary>
        <blockquote>${esc(c.sourceQuote || '(no quote captured)')}</blockquote>
        <span class="src">session ${esc(c.sourceSession)}</span>
      </details>
    </div>`;
}

const CSS = `
  :root {
    --bg:#f8fafc; --panel:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
    --teal:#0f766e; --teal-soft:#ccfbf1; --dead:#94a3b8; --rose:#9f1239;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b1120; --panel:#0f172a; --ink:#e2e8f0; --muted:#94a3b8; --line:#1e293b;
            --teal:#5eead4; --teal-soft:#134e4a; --dead:#475569; --rose:#fb7185; }
  }
  :root[data-theme="dark"] { --bg:#0b1120; --panel:#0f172a; --ink:#e2e8f0; --muted:#94a3b8;
    --line:#1e293b; --teal:#5eead4; --teal-soft:#134e4a; --dead:#475569; --rose:#fb7185; }
  :root[data-theme="light"] { --bg:#f8fafc; --panel:#fff; --ink:#0f172a; --muted:#64748b;
    --line:#e2e8f0; --teal:#0f766e; --teal-soft:#ccfbf1; --dead:#94a3b8; --rose:#9f1239; }

  body { margin:0; padding:3rem 1.5rem 6rem; background:var(--bg); color:var(--ink);
    font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; }
  main { max-width:820px; margin:0 auto; }

  h1 { font-size:1.6rem; font-weight:650; letter-spacing:-0.02em; margin:0 0 .35rem; }
  .sub { color:var(--muted); margin:0 0 2.5rem; font-size:.95rem; }
  .sub em { color:var(--ink); font-style:normal; font-weight:550; }

  .stats { display:flex; gap:2.5rem; padding:1.25rem 0 1.75rem;
    border-bottom:1px solid var(--line); margin-bottom:2.5rem; }
  .stat b { display:block; font-size:1.85rem; font-weight:600; letter-spacing:-0.03em; line-height:1.1; }
  .stat span { color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; }
  .stat.keep b { color:var(--teal); }

  h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.09em; color:var(--muted);
    font-weight:600; margin:3rem 0 1.25rem; }

  .chain { background:var(--panel); border:1px solid var(--line); border-radius:10px;
    padding:1.1rem 1.25rem; margin-bottom:.9rem; }
  .chain.revised { border-left:2px solid var(--teal); }

  .claim + .claim { margin-top:.9rem; padding-top:.9rem; border-top:1px dashed var(--line); }
  .claim-head { display:flex; gap:.6rem; align-items:baseline; }
  .content { font-weight:480; }
  .claim.dead .content { text-decoration:line-through; text-decoration-thickness:1px;
    color:var(--dead); font-weight:400; }

  .kind { font-size:.64rem; text-transform:uppercase; letter-spacing:.07em; font-weight:650;
    padding:.16rem .42rem; border-radius:4px; background:var(--teal-soft); color:var(--teal);
    white-space:nowrap; flex-shrink:0; }
  .claim.dead .kind { background:transparent; color:var(--dead); border:1px solid var(--line); }

  .meta { display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; color:var(--muted);
    font-size:.78rem; margin-top:.4rem; }
  .dot { opacity:.4; }
  .conf { display:inline-flex; align-items:center; gap:.4rem; }
  .bar { display:inline-block; width:54px; height:4px; border-radius:2px; background:var(--line);
    overflow:hidden; }
  .bar i { display:block; height:100%; background:var(--teal); }

  .death { margin-top:.5rem; font-size:.8rem; color:var(--rose); display:flex; gap:.45rem;
    align-items:baseline; flex-wrap:wrap; }
  .skull { font-weight:700; }
  .reason { color:var(--muted); font-style:italic; }

  .prov { margin-top:.5rem; }
  .prov summary { cursor:pointer; font-size:.72rem; color:var(--muted); list-style:none;
    user-select:none; }
  .prov summary::-webkit-details-marker { display:none; }
  .prov summary:before { content:"▸ "; }
  .prov[open] summary:before { content:"▾ "; }
  .prov blockquote { margin:.5rem 0 .3rem; padding:.5rem .75rem; border-left:2px solid var(--line);
    color:var(--muted); font-size:.82rem; }
  .src { font-size:.7rem; color:var(--muted); opacity:.7; }

  footer { margin-top:4rem; padding-top:1.5rem; border-top:1px solid var(--line);
    color:var(--muted); font-size:.82rem; }
  footer b { color:var(--ink); font-weight:550; }
`;

export function renderMemory(all: Claim[], now: number): string {
  const active = all.filter((c) => c.status === 'active');
  const dead = all.filter((c) => c.status !== 'active');
  const { revised, stable } = buildChains(all);

  return `<title>Palimpsest - what this memory believes, and what it used to</title>
<style>${CSS}</style>
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
             (ch) =>
               `<div class="chain revised">${ch.history.map((c) => claimRow(c, now, true)).join('')}${claimRow(ch.head, now, false)}</div>`,
           )
           .join('')}`
      : ''
  }

  <h2>Facts that held - ${stable.length}</h2>
  ${stable.map((ch) => `<div class="chain">${claimRow(ch.head, now, false)}</div>`).join('')}

  <footer>
    Every dead claim keeps its <b>body</b>, its <b>killer</b>, the <b>date</b> and the <b>reason</b>.
    Ask this memory what it used to think, and it can tell you - and show you the sentence it read.
  </footer>
</main>`;
}
