/**
 * The YouTube thumbnail.
 *
 *   pnpm thumb   ->  docs/thumbnail.png  (2560x1440, 16:9 — laid out at 1280x720, rendered at 2x)
 *
 * A thumbnail is read at about 320px wide in a Devpost card, so it gets exactly one idea and
 * that idea has to survive being shrunk to a quarter size. The idea is the strikethrough: a
 * belief this memory used to hold, struck out, with the live one under it. That is the whole
 * product in one image, and it is the only thing here that is set large enough to read small.
 *
 * Same palette and same renderer as the other shots, so it belongs to the same family.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const W = 1280;
const H = 720;

const SLATE = '#0b1120';
const BONE = '#f1f5f9';
const DIM = '#7c8ba1';
const TEAL = '#5eead4';
const ROSE = '#fb7185';

const MONO = 'DejaVu Sans Mono, monospace';
const SANS = 'DejaVu Sans, sans-serif';

/** DejaVu Sans Mono advances 0.602em per glyph. Lets us strike a line exactly as long as the text. */
const monoWidth = (s: string, fs: number) => s.length * fs * 0.602;

const DEAD = 'The dev server is on port 3000';
const LIVE = 'The dev server is on port 4000';

const X = 84;
const CLAIM_FS = 31;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${SLATE}"/>

  <!-- a teal spine, so the card has an edge even as a 320px thumbnail -->
  <rect x="0" y="0" width="9" height="${H}" fill="${TEAL}"/>

  <text x="${X}" y="104" font-family="${SANS}" font-size="25" font-weight="700"
        fill="${TEAL}" letter-spacing="7">PALIMPSEST</text>

  <text x="${X}" y="222" font-family="${SANS}" font-size="86" font-weight="700" fill="${BONE}">Agent memory</text>
  <text x="${X}" y="316" font-family="${SANS}" font-size="86" font-weight="700" fill="${TEAL}">that forgets.</text>

  <!-- the dead belief: struck through, kept, dated -->
  <text x="${X}" y="438" font-family="${MONO}" font-size="${CLAIM_FS}" fill="${DIM}"
        xml:space="preserve">${DEAD}</text>
  <line x1="${X - 4}" y1="428" x2="${X + monoWidth(DEAD, CLAIM_FS) + 4}" y2="428"
        stroke="${ROSE}" stroke-width="2.5"/>
  <text x="${X + monoWidth(DEAD, CLAIM_FS) + 30}" y="438" font-family="${MONO}" font-size="19"
        fill="${ROSE}">† died 2026-07-02</text>

  <!-- the live one -->
  <text x="${X}" y="492" font-family="${MONO}" font-size="${CLAIM_FS}" fill="${TEAL}"
        xml:space="preserve">${LIVE}</text>

  <line x1="${X}" y1="566" x2="${W - 84}" y2="566" stroke="#1e293b" stroke-width="1.5"/>

  <!-- the number that earns the claim -->
  <text x="${X}" y="612" font-family="${MONO}" font-size="20" fill="${DIM}">naive RAG</text>
  <text x="${X}" y="672" font-family="${SANS}" font-size="54" font-weight="700" fill="${DIM}">36%</text>

  <text x="${X + 210}" y="612" font-family="${MONO}" font-size="20" fill="${TEAL}">palimpsest</text>
  <text x="${X + 210}" y="672" font-family="${SANS}" font-size="54" font-weight="700" fill="${TEAL}">73%</text>

  <text x="${W - 84}" y="640" font-family="${MONO}" font-size="21" fill="${DIM}" text-anchor="end"
        xml:space="preserve">on facts that changed</text>
  <text x="${W - 84}" y="672" font-family="${MONO}" font-size="21" fill="${DIM}" text-anchor="end"
        xml:space="preserve">it served 0 dead facts. RAG served 3.</text>
</svg>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/thumbnail.svg', svg);
await sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toFile('docs/thumbnail.png');

console.log(`\n  docs/thumbnail.png  ${W * 2}x${H * 2}\n`);
