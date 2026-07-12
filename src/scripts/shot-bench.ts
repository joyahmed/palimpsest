/**
 * The benchmark, rendered as an image.
 *
 *   pnpm shot:bench   ->  docs/shot-bench.png  (1500x1000, 3:2)
 *
 * This is the literal stdout of `pnpm bench`, replayed from the committed cache and drawn
 * into a terminal. It is not a table retyped into a design tool: if the numbers change, this
 * image changes with them, and it cannot drift from what the benchmark actually says.
 *
 * Rendered with sharp rather than a headless browser, because Chromium needs system
 * libraries (libnss3 &co) that need root to install, and a screenshot tool should not
 * require you to change your machine.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const W = 1500;
const H = 1000;

const raw = execSync('pnpm bench', {
  env: { ...process.env, PALIMPSEST_CACHE_ONLY: '1', FORCE_COLOR: '1' },
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

// The colours the benchmark actually prints: ✓ teal, ☠ rose, ? amber, dim grey.
const PALETTE: Record<string, string> = {
  '1': '#f1f5f9', // bold
  '2': '#7c8ba1', // dim
  '31': '#fb7185', // red   - served a dead fact
  '32': '#5eead4', // green - correct
  '33': '#fbbf24', // yellow - wrong/unknown
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Turn one line of ANSI into SVG tspans, preserving exactly what the terminal showed. */
function line(src: string): string {
  const out: string[] = [];
  let fill = '#cbd5e1';
  let weight = '400';
  let buf = '';

  const flush = () => {
    if (!buf) return;
    // xml:space keeps the benchmark's alignment - it is a table, and a table that loses its
    // padding stops being one.
    out.push(`<tspan xml:space="preserve" fill="${fill}" font-weight="${weight}">${esc(buf)}</tspan>`);
    buf = '';
  };

  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\x1b' && src[i + 1] === '[') {
      const end = src.indexOf('m', i);
      if (end === -1) break;
      flush();
      const codes = src.slice(i + 2, end).split(';').filter(Boolean);
      if (codes.length === 0 || codes.includes('0')) {
        fill = '#cbd5e1';
        weight = '400';
      }
      for (const c of codes) {
        if (c === '1') weight = '700';
        else if (PALETTE[c]) fill = PALETTE[c];
      }
      i = end;
      continue;
    }
    buf += src[i];
  }
  flush();
  return out.join('');
}

const all = raw
  .replace(/^\$ .*$/gm, '') // drop pnpm's own "$ tsx ..." echo
  .split('\n')
  .filter((l, i, a) => !(l.trim() === '' && a[i - 1]?.trim() === '')); // collapse blank runs

// Show the SUMMARY, not the 19-question dump. The full run is 78 lines - it does not fit,
// and cropping it would cut off the table, which is the only thing this image exists to
// show. The per-question detail lives in RESULTS.md for anyone who wants it.
const head = all.filter((l) => /claims,.*dead/.test(l)); // the two store-size lines
const from = all.findIndex((l) => l.includes('RESULTS'));
const lines = from === -1 ? all : [...head, '', ...all.slice(from)];

const FS = 20;
const LH = 33;
// Centre the block vertically rather than pinning it to the top - otherwise the table
// floats in the upper third with 340px of dead space under it.
const top = Math.max(96, Math.round((H - lines.length * LH) / 2) + 24);

const body = lines
  .map((l, i) => `<text x="46" y="${top + i * LH}" font-family="DejaVu Sans Mono, monospace"
     font-size="${FS}">${line(l)}</text>`)
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0b1120"/>
  <rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="12" fill="#0d1526" stroke="#1e293b"/>
  <circle cx="48" cy="46" r="5" fill="#fb7185" opacity="0.55"/>
  <circle cx="66" cy="46" r="5" fill="#fbbf24" opacity="0.55"/>
  <circle cx="84" cy="46" r="5" fill="#5eead4" opacity="0.55"/>
  <text x="106" y="51" font-family="DejaVu Sans Mono, monospace" font-size="13" fill="#7c8ba1">
    PALIMPSEST_CACHE_ONLY=1 pnpm bench — replayed from cache, no API key, no spend
  </text>
  <g transform="translate(0, 34)">${body}</g>

  <text x="46" y="${H - 44}" font-family="DejaVu Sans Mono, monospace" font-size="13.5" fill="#7c8ba1">
    19 questions · 12 sessions over 3 months · same extraction, same embeddings, same answering model
  </text>
  <text x="${W - 46}" y="${H - 44}" font-family="DejaVu Sans Mono, monospace" font-size="13.5"
        fill="#5eead4" text-anchor="end">the only difference: one of them can kill a claim</text>
</svg>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/shot-bench.svg', svg);
await sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toFile('docs/shot-bench.png');

console.log(`\n  docs/shot-bench.png  ${W}x${H}  (${lines.length} lines of real stdout)\n`);
