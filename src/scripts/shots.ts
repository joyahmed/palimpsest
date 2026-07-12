/**
 * The submission screenshots.
 *
 *   pnpm shots    ->  docs/shot-*.png   (1500x1000, the 3:2 Devpost wants)
 *
 * Every one of these is REAL. The audit view is photographed from the deployed function,
 * not a local render. The dying claim is produced by actually typing a contradiction into
 * the live page and waiting for the memory to kill something - if adjudication rules that
 * nothing dies, no shot is produced, and we'd rather ship one fewer image than stage one.
 * The benchmark image is the literal stdout of `pnpm bench`, replayed from the committed
 * cache, rendered in a terminal - not a table retyped by hand into a design tool.
 */

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = process.env.PALIMPSEST_SITE ?? 'https://palimpsest.zettabyteincorp.com';
const W = 1500;
const H = 1000;

mkdirSync('docs', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2, // retina - Devpost allows 5 MB and a crisp image reads as care
  colorScheme: 'dark',
});

// ---------------------------------------------------------------- 1. the audit view
console.log(`\n  photographing ${SITE} ...`);
await page.goto(SITE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200); // let the slider settle under the active tab
await page.screenshot({ path: 'docs/shot-audit.png' });
console.log('  docs/shot-audit.png');

// ---------------------------------------------------------------- 2. a belief dying
// Type a real contradiction and wait for the memory to actually kill something.
console.log('\n  telling it something that makes a belief false...');
await page.fill('#say', 'We ripped SQLite out this morning. Meridian runs on DuckDB now.');
await page.click('#go');

// The pipeline is extract -> embed -> retrieve -> adjudicate, all live model calls. It is
// not fast, and it should not be: this is the moment the whole project exists for.
let died = false;
try {
  await page.waitForSelector('.claim.dying', { timeout: 90_000 });
  died = true;
} catch {
  console.log('  ! nothing died - the model ruled no contradiction. No shot faked.');
}

if (died) {
  await page.waitForTimeout(2600); // let the strike sweep, the bar drain, the reason land
  const victim = page.locator('.claim.dying').first();
  await victim.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/shot-death.png' });
  console.log('  docs/shot-death.png');

  // A tight crop of the kill itself - the single most quotable image in the project.
  const chain = page.locator('.chain.struck').first();
  await chain.screenshot({ path: 'docs/shot-kill.png' });
  console.log('  docs/shot-kill.png');
}

// ---------------------------------------------------------------- 3. the benchmark
// Replayed from the committed cache: no API key, no spend, and the numbers cannot drift
// from what is published.
console.log('\n  replaying the benchmark from cache...');
const raw = execSync('pnpm bench', {
  env: { ...process.env, PALIMPSEST_CACHE_ONLY: '1', FORCE_COLOR: '1' },
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

// Map the ANSI the benchmark actually emits onto spans. We are RENDERING real stdout, not
// retyping it - if the numbers change, this image changes with them.
const COLORS: Record<string, string> = {
  '0': '', '1': 'b', '2': 'd', '31': 'r', '32': 'g', '33': 'y',
};
const ansi = (s: string): string =>
  s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\x1b\[([0-9;]*)m/g, (_, codes: string) => {
      const parts = codes.split(';').filter(Boolean);
      if (parts.length === 0 || parts.includes('0')) return '</span>'.repeat(8);
      return parts.map((c) => `<span class="${COLORS[c] ?? ''}">`).join('');
    });

const term = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:#0b1120; display:flex; align-items:center; justify-content:center;
         width:${W}px; height:${H}px; }
  pre { font:14px/1.55 "DejaVu Sans Mono", monospace; color:#cbd5e1; margin:0;
        padding:34px 40px; white-space:pre; }
  .b { font-weight:700; color:#f1f5f9; }
  .d { color:#7c8ba1; }
  .r { color:#fb7185; }
  .g { color:#5eead4; }
  .y { color:#fbbf24; }
</style>
<pre>${ansi(raw.replace(/^\$ .*\n/gm, ''))}</pre>`;

await page.setContent(term);
await page.screenshot({ path: 'docs/shot-bench.png' });
console.log('  docs/shot-bench.png');

await browser.close();
console.log('\n  upload order: architecture.png, shot-bench.png, shot-death.png\n');
