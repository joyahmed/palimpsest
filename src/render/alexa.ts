/**
 * The simulated Alexa+ experience: a voice-style transcript over the same memory
 * the MCP server exposes.
 *
 * Why a simulation: the Amazon Developer Hackathon's Alexa+ track accepts "a
 * simulated Alexa+ experience in a web app" beside the MCP server itself, and a
 * household is where a memory that forgets earns its keep - the wifi password
 * changes, the pickup rota changes, and an assistant that answers from
 * similarity keeps saying the old one. Every turn here is a real call: a
 * question goes to /api/believe (retrieval over live claims only), a statement
 * goes to /api/remember (extract, collide, adjudicate, kill). What died is shown
 * struck through under the reply, with the reason, the way the audit view shows
 * it - the product is the kill, not the answer.
 *
 * Self-contained HTML, no framework, no build step: the page must render from the
 * deployed function exactly as it does locally.
 */

const CSS = `
  :root { --bg:#0b1120; --panel:#111a2e; --line:#1e293b; --ink:#e2e8f0; --muted:#94a3b8;
          --teal:#5eead4; --amber:#fbbf24; --red:#f87171; --blue:#38bdf8; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 Inter,system-ui,sans-serif }
  .wrap { max-width:760px; margin:0 auto; padding:24px 16px 120px }
  h1 { font-size:20px; margin:0 0 4px; display:flex; align-items:center; gap:10px }
  .ring { width:14px; height:14px; border-radius:50%; background:radial-gradient(circle,var(--blue),#0ea5e9 60%,transparent 62%); box-shadow:0 0 14px var(--blue) }
  .sub { color:var(--muted); font-size:14px; margin:0 0 20px }
  .turn { display:flex; gap:12px; margin:14px 0 }
  .turn.you { flex-direction:row-reverse }
  .who { flex:0 0 auto; width:32px; height:32px; border-radius:50%; display:grid; place-items:center; font-size:12px; color:#0b1120; background:var(--muted) }
  .turn.alexa .who { background:var(--blue) }
  .bubble { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:10px 14px; max-width:80% }
  .turn.you .bubble { background:#172554; border-color:#1e3a8a }
  .kill { margin-top:10px; padding:10px 12px; border-left:3px solid var(--red); background:#1a1220; border-radius:6px; font-size:14px }
  .kill s { color:var(--red) }
  .kill .why { color:var(--muted); font-size:13px; margin-top:4px }
  .learn { margin-top:8px; font-size:13px; color:var(--teal) }
  .from { margin-top:8px; font-size:13px; color:var(--muted) }
  .from li { margin:2px 0 }
  .conf { font-variant-numeric:tabular-nums; color:var(--amber) }
  form { position:fixed; left:0; right:0; bottom:0; background:linear-gradient(transparent,var(--bg) 30%); padding:24px 16px 16px }
  .row { max-width:760px; margin:0 auto; display:flex; gap:8px }
  input { flex:1; background:var(--panel); border:1px solid var(--line); color:var(--ink); border-radius:12px; padding:12px 14px; font-size:16px }
  button { background:var(--blue); color:#0b1120; border:0; border-radius:12px; padding:0 18px; font-weight:600; cursor:pointer }
  button:disabled { opacity:.5 }
  .chips { max-width:760px; margin:8px auto 0; display:flex; flex-wrap:wrap; gap:6px }
  .chip { font-size:13px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 10px; cursor:pointer; background:transparent }
  .chip:hover { color:var(--ink); border-color:var(--muted) }
  a { color:var(--blue) }
`;

const JS = `
  const log = document.getElementById('log');
  const form = document.getElementById('f');
  const input = document.getElementById('q');
  const send = document.getElementById('send');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function turn(who, html) {
    const el = document.createElement('div');
    el.className = 'turn ' + who;
    el.innerHTML = '<div class="who">' + (who === 'you' ? 'you' : 'A+') + '</div><div class="bubble">' + html + '</div>';
    log.appendChild(el); window.scrollTo(0, document.body.scrollHeight); return el;
  }
  const isQuestion = (t) => /\\?\\s*$/.test(t) || /^(what|when|who|where|which|how|is|are|does|do|did|can|remind)\\b/i.test(t);
  async function ask(text) {
    const r = await fetch('/api/believe?q=' + encodeURIComponent(text)); const d = await r.json();
    if (d.error) return turn('alexa', '<b>Something went wrong:</b> ' + esc(d.error));
    const from = (d.drawnFrom || []).slice(0, 4).map((c) => '<li>' + esc(c.claim) + ' <span class="conf">' + Math.round(c.confidence * 100) + '%</span></li>').join('');
    turn('alexa', esc(d.answer) + (from ? '<div class="from">Because I currently believe:<ul>' + from + '</ul></div>' : ''));
  }
  async function tell(text) {
    const r = await fetch('/api/remember', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: 'Alexa, ' + text }) });
    const d = await r.json();
    if (d.error) return turn('alexa', '<b>Something went wrong:</b> ' + esc(d.error));
    const learned = (d.learned || []).map((l) => esc(l.claim)).join(' · ');
    const kills = (d.killed || []).map((k) => '<div class="kill"><s>' + esc(k.wasBelieved) + '</s> <span class="why">believed since ' + esc(k.since) + ' - ' + esc(k.because) + '</span></div>').join('');
    const head = d.killed && d.killed.length ? 'Got it - I have updated what I believe.' : (d.learned && d.learned.length ? 'Got it, I will remember that.' : 'Noted - nothing there for me to keep.');
    turn('alexa', esc(head) + (learned ? '<div class="learn">Now believed: ' + learned + '</div>' : '') + kills);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return;
    turn('you', esc(text)); input.value = ''; send.disabled = true;
    try { if (isQuestion(text)) await ask(text); else await tell(text); }
    catch (err) { turn('alexa', '<b>Something went wrong:</b> ' + esc(err.message)); }
    finally { send.disabled = false; input.focus(); }
  });
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { input.value = c.textContent; form.requestSubmit(); }));
`;

const CHIPS = [
  "What's the wifi password?",
  'The wifi password changed to bluefish99.',
  "What's the wifi password?",
  'Who picks the kids up this week?',
  'Nadia is travelling this week, so Rafi’s uncle picks the kids up.',
  'Who picks the kids up this week?',
];

export function renderAlexa(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Palimpsest for Alexa+ - a memory that forgets</title><style>${CSS}</style></head>
<body><div class="wrap">
  <h1><span class="ring"></span> Alexa+ (simulated) &middot; Palimpsest memory</h1>
  <p class="sub">A household assistant whose memory is a set of claims that can die. Ask it something; tell it something that
  changed; ask again. What it stopped believing is shown struck through, with the reason. Same memory as the
  <a href="/mcp">MCP endpoint</a> and the <a href="/">audit view</a>. Every turn is a real call.</p>
  <div id="log">
    <div class="turn alexa"><div class="who">A+</div><div class="bubble">Hi. I remember what this household tells me, and I let go of what stops being true. Try the prompts below, in order.</div></div>
  </div>
</div>
<form id="f"><div class="row"><input id="q" autocomplete="off" placeholder="Ask, or tell me something that changed"><button id="send">Send</button></div>
<div class="chips">${CHIPS.map((c) => `<button type="button" class="chip">${c}</button>`).join('')}</div></form>
<script>${JS}</script></body></html>`;
}
