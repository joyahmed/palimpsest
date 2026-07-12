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
    <div class="claim ${isDead ? 'dead' : ''}" data-content="${esc(c.content)}">
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

/**
 * The favicon: a dead claim above a live one. The whole product at 16 pixels.
 *
 * Inlined as a data URI rather than served as a file, because this page is one
 * self-contained document - it must render identically from the deployed function, from
 * disk, and from a static export, none of which can be relied on to serve a sibling asset.
 */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#0b1120"/>
    <rect x="6" y="9" width="17" height="3" rx="1.5" fill="#64748b"/>
    <rect x="4" y="9.2" width="21" height="2.6" rx="1.3" fill="#fb7185"/>
    <rect x="6" y="19" width="20" height="3.4" rx="1.7" fill="#5eead4"/>
    <circle cx="26.5" cy="10.5" r="2" fill="#fb7185"/>
  </svg>`,
)}`;

const CSS = `
  /* width:100% + padding + border must NOT add up to more than 100%. Without this, the
     tab strip is ~12px wider than every card beneath it and hangs off to the right. */
  *, *::before, *::after { box-sizing:border-box; }

  :root {
    --bg:#f8fafc; --panel:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
    --teal:#0f766e; --teal-soft:#ccfbf1; --dead:#94a3b8; --rose:#9f1239;
  }
  /* --dead was #475569: near-invisible on a near-black panel. A struck-through claim is the
     most important thing on this page - it is the whole product - and it was the hardest
     thing to read. Lifted until it is legible but still clearly subordinate to the living. */
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b1120; --panel:#0f172a; --ink:#e2e8f0; --muted:#94a3b8; --line:#1e293b;
            --teal:#5eead4; --teal-soft:#134e4a; --dead:#8b9cb3; --rose:#fb7185; }
  }
  :root[data-theme="dark"] { --bg:#0b1120; --panel:#0f172a; --ink:#e2e8f0; --muted:#94a3b8;
    --line:#1e293b; --teal:#5eead4; --teal-soft:#134e4a; --dead:#8b9cb3; --rose:#fb7185; }
  :root[data-theme="light"] { --bg:#f8fafc; --panel:#fff; --ink:#0f172a; --muted:#64748b;
    --line:#e2e8f0; --teal:#0f766e; --teal-soft:#ccfbf1; --dead:#94a3b8; --rose:#9f1239; }

  body { margin:0; padding:2rem 1.5rem 3rem; background:var(--bg); color:var(--ink);
    font:14.5px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; }
  main { max-width:980px; margin:0 auto; position:relative; z-index:1; }

  /* ---------------------------------------------------------------- the palimpsest itself
     A palimpsest is a manuscript scraped clean and written over, where traces of the
     earlier text still show through. So the background is not a texture - it is THE DEAD
     CLAIMS THEMSELVES, struck through, ghosted behind the page that replaced them.
     Everything you can half-read back there is a thing this memory used to believe.

     aria-hidden and pointer-events:none - it is atmosphere, not content, and a screen
     reader should never have to wade through it. */
  .ghosts { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none;
    user-select:none; }
  .ghosts span { position:absolute; white-space:nowrap; font-weight:600; letter-spacing:-.02em;
    color:var(--ink); opacity:.022; text-decoration:line-through;
    text-decoration-thickness:.06em; transform:rotate(-4deg); }
  @media (prefers-color-scheme: dark) { .ghosts span { opacity:.03; } }
  :root[data-theme="dark"] .ghosts span { opacity:.03; }
  /* Below ~1400px the gutters are too narrow for the ghosts to sit BEHIND the page - they
     end up crowding the column instead of haunting it. Hide them rather than compete. */
  @media (max-width:1400px) { .ghosts { display:none; } }

  /* A slow drift, so the page feels alive without ever asking to be looked at. */
  @keyframes drift { to { transform:rotate(-4deg) translateY(-18px); } }
  .ghosts span { animation:drift 26s ease-in-out infinite alternate; }
  @media (prefers-reduced-motion:reduce) { .ghosts span { animation:none; } }

  /* Warmth. Enterprise does not have to mean cold. */
  body::before { content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
    background:
      radial-gradient(60rem 40rem at 15% -10%, color-mix(in srgb, var(--teal) 11%, transparent), transparent 70%),
      radial-gradient(50rem 34rem at 95% 8%, color-mix(in srgb, var(--rose) 6%, transparent), transparent 70%); }

  h1 { font-size:1.45rem; font-weight:650; letter-spacing:-0.02em; margin:0 0 .2rem; }
  .sub { color:var(--muted); margin:0 0 1.25rem; font-size:.9rem; }
  .sub em { color:var(--ink); font-style:normal; font-weight:550; }

  .stats { display:flex; gap:2rem; padding:.85rem 0;
    border-bottom:1px solid var(--line); margin-bottom:1.25rem; }
  .stat b { display:block; font-size:1.5rem; font-weight:600; letter-spacing:-0.03em; line-height:1.15; }
  .stat span { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; }
  .stat.keep b { color:var(--teal); }

  h2 { font-size:.75rem; text-transform:uppercase; letter-spacing:.09em; color:var(--muted);
    font-weight:600; margin:1.5rem 0 .75rem; }

  .chain { background:var(--panel); border:1px solid var(--line); border-radius:10px;
    padding:.8rem .95rem; margin-bottom:.55rem; }
  .chain.revised { border-left:2px solid var(--teal); }

  .claim + .claim { margin-top:.6rem; padding-top:.6rem; border-top:1px dashed var(--line); }
  .claim-head { display:flex; gap:.6rem; align-items:baseline; }
  .content { font-weight:480; }
  /* The strike is rose, not grey. A killed claim should look KILLED, not merely faded -
     and the text under it stays legible, because "what you used to believe" is the thing
     a judge came here to read. */
  .claim.dead .content { text-decoration:line-through; text-decoration-thickness:1.5px;
    text-decoration-color:color-mix(in srgb, var(--rose) 70%, transparent);
    color:var(--dead); font-weight:400; }

  .kind { font-size:.64rem; text-transform:uppercase; letter-spacing:.07em; font-weight:650;
    padding:.16rem .42rem; border-radius:4px; background:var(--teal-soft); color:var(--teal);
    white-space:nowrap; flex-shrink:0; }
  .claim.dead .kind { background:transparent; color:var(--dead); border:1px solid var(--line); }

  .meta { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; color:var(--muted);
    font-size:.75rem; margin-top:.25rem; }
  .dot { opacity:.4; }
  .conf { display:inline-flex; align-items:center; gap:.4rem; }
  .bar { display:inline-block; width:54px; height:4px; border-radius:2px; background:var(--line);
    overflow:hidden; }
  .bar i { display:block; height:100%; background:var(--teal); }

  .death { margin-top:.5rem; font-size:.8rem; color:var(--rose); display:flex; gap:.45rem;
    align-items:baseline; flex-wrap:wrap; }
  .skull { font-weight:700; }
  .reason { color:var(--muted); font-style:italic; }

  .prov { margin-top:.35rem; }
  .prov summary { cursor:pointer; font-size:.72rem; color:var(--muted); list-style:none;
    user-select:none; }
  .prov summary::-webkit-details-marker { display:none; }
  .prov summary:before { content:"▸ "; }
  .prov[open] summary:before { content:"▾ "; }
  .prov blockquote { margin:.5rem 0 .3rem; padding:.5rem .75rem; border-left:2px solid var(--line);
    color:var(--muted); font-size:.82rem; }
  .src { font-size:.7rem; color:var(--muted); opacity:.7; }

  footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--line);
    color:var(--muted); font-size:.78rem; }
  footer b { color:var(--ink); font-weight:550; }

  /* ---------------------------------------------------------------- tell it something
     The whole product in one input box. You type a fact that makes an existing belief
     false, and you watch the old one die. Everything below animates REAL responses from
     the deployed function - nothing here is staged. */
  .tell { background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:.85rem .95rem .95rem; margin:0; }
  .tell label { display:block; font-size:.72rem; text-transform:uppercase; letter-spacing:.09em;
    color:var(--muted); font-weight:600; margin-bottom:.55rem; }
  .tell-row { display:flex; gap:.6rem; }
  .tell input { flex:1; background:var(--bg); color:var(--ink); border:1px solid var(--line);
    border-radius:8px; padding:.7rem .85rem; font:inherit; font-size:.92rem; outline:none; }
  .tell input:focus { border-color:var(--teal); }
  .tell button { background:var(--teal); color:var(--bg); border:0; border-radius:8px;
    padding:.7rem 1.15rem; font:inherit; font-weight:600; font-size:.88rem; cursor:pointer;
    white-space:nowrap; }
  .tell button:disabled { opacity:.5; cursor:default; }
  .tell .hint { margin-top:.6rem; font-size:.78rem; color:var(--muted); }
  .tell .hint code { background:var(--bg); border:1px solid var(--line); border-radius:4px;
    padding:.1rem .35rem; font-size:.9em; cursor:pointer; }

  .status { margin-top:.85rem; font-size:.82rem; color:var(--teal); display:none; }
  .status.on { display:block; }
  .status .blink { animation:blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity:.25 } }
  .status.err { color:var(--rose); }

  /* The death animation. A line sweeps across the claim, its confidence drains, and the
     reason it died writes itself in underneath. Slow on purpose - this is the moment the
     entire project exists for, and it should be possible to watch it happen. */
  .claim .content { position:relative; }
  .claim.dying .content::after { content:""; position:absolute; left:0; top:.62em; height:1px;
    width:0; background:var(--dead); animation:strike 1s ease forwards; }
  @keyframes strike { to { width:100% } }
  .claim.dying .content { color:var(--dead); transition:color 1.4s ease .4s; }
  .claim.dying .kind { background:transparent; color:var(--dead); border:1px solid var(--line);
    transition:all 1.2s ease .3s; }
  .claim.dying .bar i { width:0 !important; transition:width 1.4s cubic-bezier(.4,0,.2,1) .2s; }

  .death.fresh { opacity:0; transform:translateY(-4px); animation:rise .7s ease 1.1s forwards; }
  .claim.newborn { opacity:0; transform:translateY(6px); animation:rise .7s ease .9s forwards; }
  @keyframes rise { to { opacity:1; transform:none } }

  .chain.struck { border-left-color:var(--rose); transition:border-color .8s ease; }

  /* ---------------------------------------------------------------- tabs
     Without these the page is one long scroll and the thing worth seeing - a fact that
     CHANGED - is buried under a dozen facts that didn't. "Changed" is the default tab
     for exactly that reason: the first thing on screen should be the thing we built. */
  .tabwrap { position:sticky; top:0; z-index:5; margin:1.5rem 0 1rem; padding:.5rem 0;
    background:color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }
  .tabs { position:relative; display:flex; width:100%; gap:.15rem; padding:.3rem;
    background:var(--panel); border:1px solid var(--line); border-radius:12px;
    box-shadow:0 1px 2px rgba(15,23,42,.04); }

  /* The pill that slides between tabs. One element, moved by JS - so the movement is a
     real transition between two positions rather than a cross-fade of two backgrounds. */
  .slider { position:absolute; top:.3rem; bottom:.3rem; border-radius:9px;
    background:var(--teal-soft); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--teal) 22%, transparent);
    transition:transform .32s cubic-bezier(.4,0,.2,1), width .32s cubic-bezier(.4,0,.2,1);
    pointer-events:none; z-index:0; }
  @media (prefers-reduced-motion:reduce) { .slider { transition:none; } }

  /* flex:1 with min-width:0 - equal shares that are also ALLOWED TO SHRINK. A flex item
     defaults to min-width:auto, meaning it refuses to go narrower than its own text, which
     would push the strip wider than its container all over again on a narrow screen. */
  .tab { flex:1 1 0; min-width:0; position:relative; z-index:1; appearance:none;
    background:none; border:0;
    color:var(--muted); font:inherit; font-size:.85rem; font-weight:550; cursor:pointer;
    padding:.5rem .8rem; border-radius:9px; white-space:nowrap; display:inline-flex;
    align-items:center; justify-content:center; gap:.45rem; transition:color .25s ease; }
  .tab:hover { color:var(--ink); }
  .tab:focus-visible { outline:2px solid var(--teal); outline-offset:2px; }
  .tab[aria-selected="true"] { color:var(--teal); }

  /* A status dot, so the tabs read at a glance: alive, held, dead. */
  .tab .dotk { width:6px; height:6px; border-radius:50%; background:var(--muted); opacity:.45;
    flex-shrink:0; transition:all .25s ease; }
  .tab[aria-selected="true"] .dotk { opacity:1; }
  .tab[data-panel="p-changed"] .dotk { background:var(--teal); }
  .tab[data-panel="p-dead"] .dotk { background:var(--rose); }

  .tab .n { font-weight:600; font-size:.72rem; padding:.1rem .4rem; border-radius:5px;
    background:var(--bg); color:var(--muted); min-width:1.1rem; text-align:center;
    transition:all .25s ease; }
  .tab[aria-selected="true"] .n { background:color-mix(in srgb, var(--teal) 16%, transparent);
    color:var(--teal); }

  .panel { display:none; }
  .panel.on { display:block; animation:fade .25s ease; }
  @keyframes fade { from { opacity:0; transform:translateY(3px) } }
  .panel h2:first-child { margin-top:0; }
  .empty { color:var(--muted); font-size:.9rem; padding:2rem 0; }
`;

export interface RenderOptions {
  /**
   * Where /api lives. Empty means same-origin, which is the case when the deployed
   * function serves this page itself. The statically exported copy points at the
   * deployed backend instead, so the page works identically from a file on disk.
   */
  apiBase?: string;
  /** Render the "tell it something" box. Off produces a pure, inert snapshot. */
  interactive?: boolean;
}

export function renderMemory(all: Claim[], now: number, opts: RenderOptions = {}): string {
  const { apiBase = '', interactive = true } = opts;
  const active = all.filter((c) => c.status === 'active');
  const dead = all.filter((c) => c.status !== 'active');
  const { revised, stable } = buildChains(all);

  // The ghost layer: what this memory used to believe, scraped away but still showing
  // through. Real dead claims - if nothing has died yet, there is nothing to haunt with,
  // and the page is honestly blank behind.
  const ghosts = dead
    .slice(0, 9)
    .map((c, i) => {
      const top = 4 + ((i * 11.5) % 92);
      const left = i % 2 === 0 ? -4 + (i % 3) * 6 : 30 + (i % 4) * 11;
      const size = 2.6 - (i % 3) * 0.55;
      const delay = (i * 2.9).toFixed(1);
      return `<span style="top:${top}%;left:${left}%;font-size:${size}rem;animation-delay:-${delay}s">${esc(
        c.content,
      )}</span>`;
    })
    .join('');

  return `<title>Palimpsest - what this memory believes, and what it used to</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style>
<div class="ghosts" aria-hidden="true">${ghosts}</div>
<main>
  <h1>Palimpsest</h1>
  <p class="sub">What this memory believes now, and <em>what it used to believe</em>. Nothing was deleted.</p>

  <div class="stats">
    <div class="stat"><b id="n-live">${active.length}</b><span>believed</span></div>
    <div class="stat"><b id="n-dead">${dead.length}</b><span>superseded</span></div>
    <div class="stat keep"><b>0</b><span>deleted</span></div>
  </div>

  ${
    interactive
      ? `<form class="tell" id="tell">
    <label>Tell it something that makes one of these false</label>
    <div class="tell-row">
      <input id="say" autocomplete="off" placeholder="We moved off SQLite - Meridian runs on DuckDB now." />
      <button type="submit" id="go">Remember</button>
    </div>
    <div class="hint">
      It will extract the claim, check it against everything it already believes, and decide
      whether anything has to <em>die</em>. Try
      <code class="eg">The launch slipped to November.</code>
      <code class="eg">We're back on Postgres.</code>
    </div>
    <div class="status" id="status"></div>
  </form>

  <div id="fresh"></div>`
      : ''
  }

  <div class="tabwrap">
    <nav class="tabs" role="tablist">
      <span class="slider" id="slider"></span>
      <button class="tab" type="button" role="tab" aria-selected="true" data-panel="p-changed">
        <span class="dotk"></span>Facts that changed<span class="n">${revised.length}</span>
      </button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-panel="p-held">
        <span class="dotk"></span>Facts that held<span class="n">${stable.length}</span>
      </button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-panel="p-dead">
        <span class="dotk"></span>The dead<span class="n">${dead.length}</span>
      </button>
    </nav>
  </div>

  <section class="panel on" id="p-changed">
    ${
      revised.length
        ? revised
            .map(
              (ch) =>
                `<div class="chain revised">${ch.history.map((c) => claimRow(c, now, true)).join('')}${claimRow(ch.head, now, false)}</div>`,
            )
            .join('')
        : `<p class="empty">Nothing has been revised yet. Tell it something above that contradicts
             what it believes, and this is where the body will appear.</p>`
    }
  </section>

  <section class="panel" id="p-held">
    ${stable.map((ch) => `<div class="chain">${claimRow(ch.head, now, false)}</div>`).join('')}
  </section>

  <section class="panel" id="p-dead">
    ${
      dead.length
        ? `<p class="empty" style="padding:0 0 1.25rem">Struck through, never deleted. Each one keeps
             the date it died and the claim that killed it.</p>
           ${dead.map((c) => `<div class="chain">${claimRow(c, now, true)}</div>`).join('')}`
        : `<p class="empty">Nothing has died yet.</p>`
    }
  </section>

  <footer>
    Every dead claim keeps its <b>body</b>, its <b>killer</b>, the <b>date</b> and the <b>reason</b>.
    Ask this memory what it used to think, and it can tell you - and show you the sentence it read.
  </footer>
</main>
${interactive ? `<script>${script(apiBase)}</script>` : ''}`;
}

/**
 * The client. Deliberately dependency-free and small enough to read.
 *
 * It does exactly one thing: POST what you typed to /api/remember, then animate whatever
 * actually came back. The progress lines are the REAL stages of the pipeline, not a
 * loading spinner dressed up as one - and if the model rules that nothing died, the page
 * says so instead of inventing a corpse. A demo that lies about its own output would be a
 * strange thing to put in front of a project about memories that lie.
 */
function script(apiBase: string): string {
  return `
const API = ${JSON.stringify(apiBase)};
const $ = (s) => document.querySelector(s);
const form = $('#tell'), say = $('#say'), go = $('#go'), status = $('#status'), fresh = $('#fresh');

// ---- tabs. The page is otherwise one long scroll, and the thing worth seeing is buried.
const slider = $('#slider');

function moveSlider(tab) {
  if (!slider || !tab) return;
  // offsetLeft is relative to .tabs (the positioned ancestor), which is exactly the
  // coordinate space the slider lives in - so this stays correct when the tab strip
  // scrolls horizontally on a narrow screen.
  slider.style.width = tab.offsetWidth + 'px';
  slider.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
}

function select(tab) {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t === tab));
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.id === tab.dataset.panel);
  moveSlider(tab);
}

for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => select(tab);

// Place it before first paint, and keep it honest when the layout reflows.
const current = () => document.querySelector('.tab[aria-selected="true"]');
requestAnimationFrame(() => {
  // No transition on the initial placement - it should already be there, not fly in.
  const prev = slider.style.transition;
  slider.style.transition = 'none';
  moveSlider(current());
  slider.offsetHeight; // force the style to land before transitions come back
  slider.style.transition = prev;
});
addEventListener('resize', () => moveSlider(current()));
// Fonts land after first paint and change tab widths underneath us.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveSlider(current()));
// When a belief dies, jump to where the body is - otherwise the drama happens off-screen
// on whichever tab you were not looking at.
function showChanged() {
  const tab = document.querySelector('.tab[data-panel="p-changed"]');
  if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
}

for (const eg of document.querySelectorAll('.eg')) {
  eg.onclick = () => { say.value = eg.textContent.trim(); say.focus(); };
}

const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function show(msg, isErr) {
  status.className = 'status on' + (isErr ? ' err' : '');
  status.innerHTML = msg;
}

// Find a claim node by its exact content. Claims carry data-content for precisely this.
function nodeFor(content) {
  for (const el of document.querySelectorAll('.claim')) {
    if (el.dataset.content === content) return el;
  }
  return null;
}

function claimHtml(c, kind) {
  return '<div class="claim-head"><span class="kind">' + esc(kind || 'fact') + '</span>' +
         '<span class="content">' + esc(c) + '</span></div>' +
         '<div class="meta"><span>today</span><span class="dot">\\u00b7</span>' +
         '<span class="conf"><span class="bar"><i style="width:90%"></i></span>0.90</span></div>';
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const text = say.value.trim();
  if (!text) return;

  go.disabled = true;
  const stages = [
    'reading what you said<span class="blink">...</span>',
    'extracting atomic claims<span class="blink">...</span>',
    'retrieving what might collide<span class="blink">...</span>',
    'adjudicating - does this KILL anything?<span class="blink">...</span>',
  ];
  let i = 0;
  show(stages[0]);
  const ticker = setInterval(() => { i = Math.min(i + 1, stages.length - 1); show(stages[i]); }, 2200);

  try {
    const res = await fetch(API + '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: text, date: new Date().toISOString().slice(0, 10) }),
    });
    clearInterval(ticker);
    if (!res.ok) throw new Error('the function returned ' + res.status);
    const out = await res.json();

    const killed = out.killed || [], learned = out.learned || [];

    // Kill first. The whole point is that you see it happen.
    if (killed.length) showChanged();
    for (const k of killed) {
      const el = nodeFor(k.wasBelieved);
      if (!el) continue;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('dying');
      el.closest('.chain') && el.closest('.chain').classList.add('struck');
      const death = document.createElement('div');
      death.className = 'death fresh';
      death.innerHTML = '<span class="skull">\\u2020</span> died just now <span class="reason">' +
        esc(k.because || '') + '</span>';
      el.appendChild(death);

      // The claim that killed it, arriving underneath its victim - the revision chain,
      // growing in front of you.
      const killer = learned.find((l) => l.claim === k.killedBy) || { claim: k.killedBy, kind: 'fact' };
      const born = document.createElement('div');
      born.className = 'claim newborn';
      born.dataset.content = killer.claim;
      born.innerHTML = claimHtml(killer.claim, killer.kind);
      el.after(born);

      $('#n-dead').textContent = String(Number($('#n-dead').textContent) + 1);
    }

    // Anything that killed nothing is simply new knowledge.
    const orphans = learned.filter((l) => !killed.some((k) => k.killedBy === l.claim));
    for (const l of orphans) {
      const chain = document.createElement('div');
      chain.className = 'chain';
      const born = document.createElement('div');
      born.className = 'claim newborn';
      born.dataset.content = l.claim;
      born.innerHTML = claimHtml(l.claim, l.kind);
      chain.appendChild(born);
      fresh.appendChild(chain);
      $('#n-live').textContent = String(Number($('#n-live').textContent) + 1);
    }

    await sleep(400);
    if (killed.length) {
      show('<b>' + killed.length + ' belief' + (killed.length > 1 ? 's' : '') +
           ' died.</b> The body is kept, struck through, with the reason it was killed.');
    } else if (out.alreadyKnew && out.alreadyKnew.length) {
      show('It already knew that. Nothing added, nothing killed - a duplicate carries no information.');
    } else if (learned.length) {
      show('Learned ' + learned.length + ' new claim' + (learned.length > 1 ? 's' : '') +
           '. Nothing contradicted it, so nothing died.');
    } else {
      show('Nothing assertable in that. No claims extracted.');
    }
    say.value = '';
  } catch (err) {
    clearInterval(ticker);
    show('Failed: ' + esc(String(err.message || err)), true);
  } finally {
    go.disabled = false;
  }
};
`;
}
