/**
 * The architecture diagram. A hard submission requirement: "a clear visual representation
 * of your system".
 *
 *   pnpm diagram    ->  docs/architecture.png  (1500x1000, the 3:2 Devpost asks for)
 *
 * Written as SVG and rendered with sharp, so it is TEXT IN THE REPO - diffable, editable,
 * and regenerable. A binary dropped in by a design tool would rot the moment the
 * architecture moved, and nobody would notice.
 *
 * The diagram earns its place by showing the one thing prose keeps failing to: that
 * cosine SHORTLISTS and Qwen RULES. Every other memory system stops at the first arrow.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const W = 1500;
const H = 1000;

// The palette is the product's: slate ground, teal for what lives, rose for what dies.
const BG = '#0b1120';
const PANEL = '#0f172a';
const LINE = '#1e293b';
const INK = '#e2e8f0';
const MUTED = '#94a3b8';
const TEAL = '#5eead4';
const TEAL_DIM = '#134e4a';
const ROSE = '#fb7185';
const ROSE_DIM = '#4c0519';
const AMBER = '#fbbf24';

const F = 'Inter, DejaVu Sans, Liberation Sans, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  note?: string;
  accent?: string;
  fill?: string;
}

const box = (b: Box): string => {
  const accent = b.accent ?? LINE;
  const fill = b.fill ?? PANEL;
  // The sub-label is tinted with the accent - but LINE is a near-black border colour, and
  // near-black text on a near-black panel is invisible. Fall back to muted grey.
  const subColor = accent === LINE ? MUTED : accent;
  return `
  <g>
    <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"
          fill="${fill}" stroke="${accent}" stroke-width="1.5"/>
    <rect x="${b.x}" y="${b.y}" width="3.5" height="${b.h}" rx="2" fill="${accent}"/>
    <text x="${b.x + 18}" y="${b.y + 28}" font-family="${F}" font-size="16.5" font-weight="650"
          fill="${INK}">${b.title}</text>
    ${
      b.sub
        ? `<text x="${b.x + 18}" y="${b.y + 50}" font-family="${MONO}" font-size="12.5"
             fill="${subColor}">${b.sub}</text>`
        : ''
    }
    ${
      b.note
        ? `<text x="${b.x + 18}" y="${b.y + (b.sub ? 72 : 52)}" font-family="${F}" font-size="13"
             fill="${MUTED}">${b.note}</text>`
        : ''
    }
  </g>`;
};

/** A horizontal arrow with an optional label sitting above it. */
const arrow = (x1: number, x2: number, y: number, label?: string): string => `
  <line x1="${x1}" y1="${y}" x2="${x2 - 9}" y2="${y}" stroke="${MUTED}" stroke-width="1.6"
        marker-end="url(#a)"/>
  ${
    label
      ? `<text x="${(x1 + x2) / 2}" y="${y - 10}" font-family="${F}" font-size="12.5"
           fill="${MUTED}" text-anchor="middle">${label}</text>`
      : ''
  }`;

const vArrow = (x: number, y1: number, y2: number, label?: string, color = MUTED): string => `
  <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 9}" stroke="${color}" stroke-width="1.6"
        marker-end="url(#${color === ROSE ? 'ar' : 'a'})"/>
  ${
    label
      ? `<text x="${x + 12}" y="${(y1 + y2) / 2 + 4}" font-family="${F}" font-size="12.5"
           fill="${color}">${label}</text>`
      : ''
  }`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,1 L9,5 L0,9 z" fill="${MUTED}"/>
    </marker>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,1 L9,5 L0,9 z" fill="${ROSE}"/>
    </marker>
    <radialGradient id="glow" cx="18%" cy="0%" r="70%">
      <stop offset="0%" stop-color="${TEAL}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${TEAL}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- ghosted dead claims, because that is what a palimpsest is -->
  <g opacity="0.05" font-family="${F}" font-weight="600" fill="${INK}">
    <text x="70" y="250" font-size="40" text-decoration="line-through">The project uses Postgres.</text>
    <text x="720" y="905" font-size="34" text-decoration="line-through">Launch is September 1st.</text>
    <text x="240" y="660" font-size="30" text-decoration="line-through">The brand colour is #1E4D8C.</text>
  </g>

  <!-- One <text> per line. Chaining fragments at hand-computed x offsets is how you get
       a title overlapping its own tagline - which is exactly what the first render did. -->
  <text x="60" y="60" font-family="${F}" font-size="29" font-weight="700" fill="${INK}">
    Palimpsest<tspan font-size="18" font-weight="400" fill="${MUTED}" dx="14">— agent memory that forgets</tspan>
  </text>
  <text x="60" y="90" font-family="${F}" font-size="14.5" fill="${MUTED}">
    A memory is a <tspan font-weight="650" fill="${TEAL}">claim with a lifecycle</tspan>, not a chunk of text — so it can be contradicted, superseded, and killed.
  </text>

  <!-- ============================== WRITE PATH ============================== -->
  <text x="60" y="142" font-family="${F}" font-size="12" font-weight="700" fill="${MUTED}"
        letter-spacing="1.6">WRITE PATH — HOW A BELIEF DIES</text>

  ${box({ x: 60, y: 160, w: 200, h: 84, title: 'Transcript', sub: 'a conversation', note: 'not yet a memory', accent: LINE })}
  ${arrow(268, 316, 202)}
  ${box({
    x: 316,
    y: 160,
    w: 226,
    h: 84,
    title: 'Extract',
    sub: 'qwen3.6-flash',
    note: 'atomic claims',
    accent: AMBER,
  })}
  ${arrow(550, 598, 202)}
  ${box({
    x: 598,
    y: 160,
    w: 236,
    h: 84,
    title: 'Embed',
    sub: 'text-embedding-v4',
    note: 'one vector per claim',
    accent: AMBER,
  })}
  ${arrow(842, 890, 202)}
  ${box({
    x: 890,
    y: 160,
    w: 236,
    h: 84,
    title: 'Shortlist',
    sub: 'cosine · top-5',
    note: 'what might collide?',
    accent: LINE,
  })}
  ${arrow(1134, 1182, 202)}
  ${box({
    x: 1182,
    y: 160,
    w: 258,
    h: 84,
    title: 'Adjudicate',
    sub: 'qwen3.7-plus',
    note: 'does this KILL that?',
    accent: TEAL,
    fill: '#0d1b2a',
  })}

  <!-- the thesis, said once, in the one place it cannot be missed -->
  <rect x="700" y="266" width="740" height="42" rx="8" fill="${TEAL_DIM}" fill-opacity="0.35" stroke="${TEAL}" stroke-opacity="0.35"/>
  <text x="722" y="293" font-family="${F}" font-size="14" fill="${TEAL}">
    Cosine can only <tspan font-weight="700">shortlist</tspan>. Only reasoning can <tspan font-weight="700">rule</tspan>. Every other memory system stops one arrow earlier.
  </text>

  <!-- rulings -->
  ${vArrow(1311, 304, 358)}
  <text x="1130" y="340" font-family="${F}" font-size="12.5" fill="${MUTED}">one ruling per candidate</text>

  ${box({ x: 1182, y: 358, w: 258, h: 66, title: 'supersedes', sub: 'the old claim dies', accent: ROSE, fill: '#1a0b12' })}
  ${box({ x: 1182, y: 436, w: 258, h: 66, title: 'refines / new', sub: 'inserted alongside', accent: TEAL })}
  ${box({ x: 1182, y: 514, w: 258, h: 66, title: 'duplicate', sub: 'dropped, no new info', accent: LINE })}

  <!-- ============================== THE STORE ============================== -->
  <text x="60" y="400" font-family="${F}" font-size="12" font-weight="700" fill="${MUTED}"
        letter-spacing="1.6">THE STORE — NOTHING IS EVER DELETED</text>

  <rect x="60" y="418" width="1080" height="222" rx="12" fill="${PANEL}" stroke="${LINE}" stroke-width="1.5"/>
  <text x="82" y="450" font-family="${F}" font-size="17" font-weight="650" fill="${INK}">Claim store</text>
  <text x="196" y="450" font-family="${MONO}" font-size="13" fill="${MUTED}">SQLite · node:sqlite · no vector DB</text>

  <!-- a revision chain, drawn as it actually renders -->
  <rect x="82" y="468" width="1036" height="52" rx="8" fill="${ROSE_DIM}" fill-opacity="0.25" stroke="${ROSE}" stroke-opacity="0.4"/>
  <text x="102" y="492" font-family="${MONO}" font-size="12" fill="${ROSE}">DEAD</text>
  <text x="164" y="492" font-family="${F}" font-size="15" fill="${MUTED}" text-decoration="line-through">The project uses Postgres.</text>
  <text x="164" y="511" font-family="${F}" font-size="12.5" fill="${ROSE}">† died 1 Jul · "switched to SQLite on 1 Jul; Postgres is no longer in use" · killer + date + reason, all kept</text>

  <rect x="82" y="530" width="1036" height="46" rx="8" fill="${TEAL_DIM}" fill-opacity="0.25" stroke="${TEAL}" stroke-opacity="0.4"/>
  <text x="102" y="552" font-family="${MONO}" font-size="12" fill="${TEAL}">LIVE</text>
  <text x="164" y="552" font-family="${F}" font-size="15" fill="${INK}">Meridian runs on SQLite.</text>
  <text x="164" y="569" font-family="${F}" font-size="12.5" fill="${MUTED}">confidence 0.91 · kind: config · half-life 30d · provenance: session 9, verbatim quote retained</text>

  <text x="82" y="606" font-family="${F}" font-size="13" fill="${MUTED}">
    Decay: <tspan font-family="${MONO}" fill="${TEAL}">confidence(t) = c₀ · 2^(−age / halfLife[kind])</tspan>
    <tspan dx="16">identity 10y · config 30d · event never — a thing that happened cannot become false</tspan>
  </text>
  <text x="82" y="626" font-family="${F}" font-size="13" fill="${MUTED}">Every claim keeps: content · kind · subject · provenance · observedAt · status · confidence · supersededBy · deathReason</text>

  <!-- ============================== READ PATH ============================== -->
  <text x="60" y="682" font-family="${F}" font-size="12" font-weight="700" fill="${MUTED}"
        letter-spacing="1.6">READ PATH — WHY A CORPSE IS NEVER SERVED</text>

  ${box({ x: 60, y: 700, w: 216, h: 92, title: 'Question', sub: '"which database?"', accent: LINE })}
  ${arrow(284, 332, 746)}
  ${box({
    x: 332,
    y: 700,
    w: 262,
    h: 92,
    title: 'believed(now)',
    sub: 'active claims only',
    note: 'a corpse is unreachable',
    accent: TEAL,
  })}
  ${arrow(602, 650, 746)}
  ${box({ x: 650, y: 700, w: 230, h: 92, title: 'Answer', sub: 'qwen3.7-plus', note: 'grounded in live beliefs', accent: AMBER })}

  <rect x="904" y="700" width="236" height="92" rx="10" fill="${PANEL}" stroke="${LINE}" stroke-width="1.5"/>
  <text x="922" y="728" font-family="${F}" font-size="16.5" font-weight="650" fill="${INK}">MCP server</text>
  <text x="922" y="750" font-family="${MONO}" font-size="12.5" fill="${MUTED}">remember · recall · why</text>
  <text x="922" y="772" font-family="${F}" font-size="13" fill="${MUTED}">any agent can plug in</text>

  <!-- ============================== BENCHMARK ============================== -->
  <rect x="1182" y="596" width="258" height="182" rx="10" fill="${PANEL}" stroke="${TEAL}" stroke-opacity="0.45" stroke-width="1.5"/>
  <text x="1200" y="626" font-family="${F}" font-size="12" font-weight="700" fill="${MUTED}" letter-spacing="1.4">BENCHMARK</text>
  <text x="1200" y="650" font-family="${F}" font-size="12.5" fill="${MUTED}">on facts that CHANGED</text>

  <text x="1200" y="682" font-family="${F}" font-size="13" fill="${MUTED}">naive RAG</text>
  <rect x="1200" y="690" width="66" height="7" rx="3.5" fill="${ROSE}" fill-opacity="0.65"/>
  <text x="1276" y="697" font-family="${F}" font-size="14" font-weight="700" fill="${ROSE}">36%</text>

  <text x="1200" y="722" font-family="${F}" font-size="13" fill="${TEAL}">Palimpsest</text>
  <rect x="1200" y="730" width="134" height="7" rx="3.5" fill="${TEAL}"/>
  <text x="1344" y="737" font-family="${F}" font-size="14" font-weight="700" fill="${TEAL}">73%</text>

  <line x1="1200" y1="752" x2="1422" y2="752" stroke="${LINE}"/>
  <text x="1200" y="770" font-family="${F}" font-size="12.5" fill="${MUTED}">dead facts served:</text>
  <text x="1330" y="770" font-family="${F}" font-size="12.5" font-weight="700" fill="${ROSE}">3</text>
  <text x="1346" y="770" font-family="${F}" font-size="12.5" fill="${MUTED}">vs</text>
  <text x="1372" y="770" font-family="${F}" font-size="12.5" font-weight="700" fill="${TEAL}">0</text>

  <!-- ============================== DEPLOYMENT ============================== -->
  <rect x="60" y="812" width="1380" height="128" rx="12" fill="${PANEL}" stroke="${LINE}" stroke-width="1.5"/>
  <text x="82" y="844" font-family="${F}" font-size="12" font-weight="700" fill="${MUTED}" letter-spacing="1.6">DEPLOYED ON ALIBABA CLOUD</text>

  <circle cx="90" cy="878" r="4" fill="${TEAL}"/>
  <text x="104" y="883" font-family="${F}" font-size="14" font-weight="650" fill="${INK}">Function Compute 3.0</text>
  <text x="104" y="903" font-family="${F}" font-size="12.5" fill="${MUTED}">ap-southeast-1 (Singapore) · custom runtime</text>
  <text x="104" y="921" font-family="${F}" font-size="12.5" fill="${MUTED}">HTTP trigger · scale to zero · 525ms cold start</text>

  <circle cx="470" cy="878" r="4" fill="${AMBER}"/>
  <text x="484" y="883" font-family="${F}" font-size="14" font-weight="650" fill="${INK}">Qwen Cloud</text>
  <text x="484" y="903" font-family="${F}" font-size="12.5" fill="${MUTED}">DashScope International (Singapore)</text>
  <text x="484" y="921" font-family="${F}" font-size="12.5" fill="${MUTED}">qwen3.7-plus · qwen3.6-flash · text-embedding-v4</text>

  <circle cx="880" cy="878" r="4" fill="${TEAL}"/>
  <text x="894" y="883" font-family="${F}" font-size="14" font-weight="650" fill="${INK}">Vendored Node 24</text>
  <text x="894" y="903" font-family="${F}" font-size="12.5" fill="${MUTED}">node:sqlite needs Node 22+; every FC</text>
  <text x="894" y="921" font-family="${F}" font-size="12.5" fill="${MUTED}">runtime stops at 20 — so we bring our own</text>

  <circle cx="1176" cy="878" r="4" fill="${TEAL}"/>
  <text x="1190" y="883" font-family="${F}" font-size="14" font-weight="650" fill="${INK}">Custom domain + TLS</text>
  <text x="1190" y="903" font-family="${F}" font-size="12.5" fill="${MUTED}">Alibaba force-downloads any HTML</text>
  <text x="1190" y="921" font-family="${F}" font-size="12.5" fill="${MUTED}">from its own domains — so we need one</text>

  <text x="60" y="972" font-family="${MONO}" font-size="13" fill="${MUTED}">palimpsest.zettabyteincorp.com</text>
  <text x="1440" y="972" font-family="${MONO}" font-size="13" fill="${MUTED}" text-anchor="end">github.com/joyahmed/palimpsest · MIT</text>
</svg>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/architecture.svg', svg);

await sharp(Buffer.from(svg), { density: 144 })
  .png({ compressionLevel: 9 })
  .toFile('docs/architecture.png');

const { size } = await sharp('docs/architecture.png').metadata();
console.log(`\n  docs/architecture.png  ${W}x${H} (3:2)  ${((size ?? 0) / 1024).toFixed(0)} KB`);
console.log(`  docs/architecture.svg  (source - edit this, not the PNG)\n`);
