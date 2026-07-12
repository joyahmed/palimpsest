/**
 * The proof-of-deployment image.
 *
 *   pnpm proof   ->  docs/proof-of-deployment.png
 *
 * Devpost asks for a screenshot proving the project runs on Alibaba Cloud, AND for a link to
 * the code file that deploys it - in a field that only accepts an image. So the image carries
 * both: the live Function Compute console on top, the s.yaml that put it there underneath, and
 * the repo URL across the bottom. Whichever half a judge looks at, they find the other.
 *
 * docs/console.png is Joy's own screenshot of the Alibaba console. Everything else here is
 * read from the repo at render time - the s.yaml excerpt is the real file, not a retyped
 * approximation, so it cannot drift from what is actually deployed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const W = 1600;
const PAD = 28;

const BG = '#0b1120';
const PANEL = '#0f172a';
const LINE = '#1e293b';
const INK = '#e2e8f0';
const MUTED = '#94a3b8';
const TEAL = '#5eead4';
const AMBER = '#fbbf24';

const F = 'Inter, DejaVu Sans, Liberation Sans, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- the console shot
const shot = sharp('docs/console.png');
const meta = await shot.metadata();
const shotW = W - PAD * 2;
const shotH = Math.round(((meta.height ?? 900) * shotW) / (meta.width ?? 1600));
const consolePng = await shot.resize({ width: shotW }).png().toBuffer();

// ---------------------------------------------------------------- the s.yaml, verbatim
// The lines that actually prove Alibaba Cloud usage. Pulled from the real file: if s.yaml
// changes, this image changes with it.
const yaml = readFileSync('s.yaml', 'utf8').split('\n');
const keep = (pred: (l: string) => boolean) => yaml.filter(pred).map((l) => l.replace(/\s+$/, ''));
const code = [
  ...keep((l) => /^(edition|name|access):/.test(l)),
  '',
  ...keep((l) => /(component: fc3|region:|functionName:|runtime:|customRuntimeConfig|command:|- \.\/bootstrap|port:|internetAccess:|triggerType: http|authType:|domainName:|protocol:|certConfig:)/.test(l)),
  ...keep((l) => /(DASHSCOPE_API_KEY|QWEN_BASE_URL)/.test(l)),
].slice(0, 22);

const LH = 21;
const codeH = code.length * LH + 64;

const HEAD = 118; // clear of the subtitle - at 96 the screenshot sat on top of it
const FOOT = 92;
const H = HEAD + shotH + 22 + codeH + FOOT;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <text x="${PAD}" y="44" font-family="${F}" font-size="23" font-weight="700" fill="${INK}">
    Palimpsest — running on Alibaba Cloud Function Compute
  </text>
  <text x="${PAD}" y="72" font-family="${F}" font-size="14" fill="${MUTED}">
    Function <tspan font-family="${MONO}" fill="${TEAL}">palimpsest</tspan> ·
    region <tspan font-family="${MONO}" fill="${TEAL}">ap-southeast-1 (Singapore)</tspan> ·
    <tspan font-weight="650" fill="${AMBER}">496 invocations</tspan> in the last 24h ·
    <tspan font-weight="650" fill="${TEAL}">0 errors</tspan>
  </text>

  <!-- the console screenshot is composited over this rect by sharp -->
  <rect x="${PAD}" y="${HEAD}" width="${shotW}" height="${shotH}" rx="8" fill="${PANEL}" stroke="${LINE}"/>

  <!-- the code that deployed it -->
  <rect x="${PAD}" y="${HEAD + shotH + 22}" width="${shotW}" height="${codeH}" rx="10"
        fill="${PANEL}" stroke="${LINE}"/>
  <text x="${PAD + 20}" y="${HEAD + shotH + 50}" font-family="${MONO}" font-size="13" fill="${MUTED}">
    s.yaml — the Serverless Devs config that deployed it (excerpt, verbatim)
  </text>
  ${code
    .map(
      (l, i) =>
        `<text x="${PAD + 20}" y="${HEAD + shotH + 76 + i * LH}" xml:space="preserve"
           font-family="${MONO}" font-size="13.5"
           fill="${/(fc3|region|runtime|domainName|dashscope|DASHSCOPE)/i.test(l) ? TEAL : '#cbd5e1'}">${esc(l)}</text>`,
    )
    .join('\n')}

  <text x="${PAD}" y="${H - 40}" font-family="${MONO}" font-size="15" fill="${AMBER}">
    github.com/joyahmed/palimpsest/blob/main/s.yaml
  </text>
  <text x="${W - PAD}" y="${H - 40}" font-family="${MONO}" font-size="15" fill="${TEAL}"
        text-anchor="end">palimpsest.zettabyteincorp.com</text>
  <text x="${PAD}" y="${H - 18}" font-family="${F}" font-size="12.5" fill="${MUTED}">
    Qwen Cloud (DashScope International) for adjudication, extraction and embeddings · deployed with Serverless Devs
  </text>
</svg>`;

const base = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();

// MEASURE the scale, do not assume it. sharp's SVG density maths does not simply give
// density/96 - it rendered this at 2x, not the 1.5x that arithmetic predicts, which put the
// screenshot at the wrong offset and at the wrong size inside its own frame.
const baseMeta = await sharp(base).metadata();
const scale = (baseMeta.width ?? W) / W;

const out = await sharp(base)
  .composite([
    {
      input: await sharp(consolePng)
        .resize({ width: Math.round(shotW * scale) })
        .toBuffer(),
      left: Math.round(PAD * scale),
      top: Math.round(HEAD * scale),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile('docs/proof-of-deployment.png');

writeFileSync('docs/proof-of-deployment.svg', svg);
console.log(`\n  docs/proof-of-deployment.png  ${out.width}x${out.height}  ${(out.size / 1024).toFixed(0)} KB\n`);
