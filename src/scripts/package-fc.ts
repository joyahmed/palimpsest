/**
 * Stage the Function Compute deployment package.
 *
 *   pnpm package:fc      ->  deploy/   (then: s deploy)
 *
 * WHY THIS EXISTS AT ALL. The claim store is built on `node:sqlite`, which landed in
 * Node 22. Every runtime Function Compute offers - managed nodejs20, and the
 * custom.debian10 base image alike - stops at Node 20. On all of them,
 * `import 'node:sqlite'` throws at cold start.
 *
 * So we bring our own Node. That is not a workaround; it is the entire purpose of a
 * custom runtime, which hands you a bare Debian and asks for an executable. We hand it
 * Node 24 and the app runs unmodified. Nothing about the architecture bends to fit the
 * host - which matters, because the host is a submission requirement, not a design input.
 *
 * The package is a plain directory:
 *
 *   deploy/
 *     bootstrap            <- FC runs this
 *     runtime/bin/node     <- Node 24, checksum-verified against nodejs.org
 *     build/               <- our compiled JS
 *     node_modules/        <- prod deps, really copied (pnpm's symlink farm does not zip)
 *     palimpsest.db        <- the seeded belief set
 *
 * Singapore permits a 500 MB code package (most regions cap at 100 MB), and Singapore
 * is where we must deploy anyway - it is the region the DashScope *International*
 * endpoint lives in, and a Qwen Cloud key is only valid there. ~110 MB fits easily.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

const NODE_VERSION = 'v24.18.0';
const ARCH = 'linux-x64'; // Function Compute runs x86-64 Linux, whatever your laptop is.
const TARBALL = `node-${NODE_VERSION}-${ARCH}.tar.xz`;
const DIST = `https://nodejs.org/dist/${NODE_VERSION}`;

const CACHE = '.cache/node';
const SEED_CACHE = '.cache/llm'; // the committed replay cache, shipped read-only inside the package
const OUT = 'deploy';

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------- vendor node

/**
 * Fetch the Node tarball and verify it against the official SHASUMS256 before we
 * unpack it. We are about to ship this binary to a server and run it. Downloading an
 * executable over the network and trusting it unchecked would be a poor look for a
 * project whose entire thesis is "don't believe a claim just because you retrieved it".
 */
async function vendorNode(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const tarPath = `${CACHE}/${TARBALL}`;

  if (!existsSync(tarPath)) {
    console.log(`  downloading ${TARBALL} ...`);
    const res = await fetch(`${DIST}/${TARBALL}`);
    if (!res.ok) throw new Error(`node download failed: ${res.status} ${res.statusText}`);
    writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()));
  } else {
    console.log(`  ${TARBALL} already cached`);
  }

  const sumsRes = await fetch(`${DIST}/SHASUMS256.txt`);
  if (!sumsRes.ok) throw new Error(`SHASUMS256.txt failed: ${sumsRes.status}`);
  const sums = await sumsRes.text();

  const expected = sums
    .split('\n')
    .find((l) => l.trim().endsWith(TARBALL))
    ?.trim()
    .split(/\s+/)[0];
  if (!expected) throw new Error(`no checksum published for ${TARBALL}`);

  const actual = createHash('sha256').update(readFileSync(tarPath)).digest('hex');
  if (actual !== expected) {
    rmSync(tarPath, { force: true }); // do not leave a poisoned tarball in the cache
    throw new Error(
      `checksum MISMATCH for ${TARBALL}\n  expected ${expected}\n  actual   ${actual}`,
    );
  }
  console.log(`  checksum verified  ${expected.slice(0, 16)}...`);

  // Unpack the single file we need. The full tarball is ~110 MB of headers, npm, docs
  // and corepack; the function needs precisely one binary.
  mkdirSync(`${OUT}/runtime/bin`, { recursive: true });
  execFileSync('tar', [
    '-xJf',
    tarPath,
    '-C',
    `${OUT}/runtime/bin`,
    '--strip-components=2',
    `node-${NODE_VERSION}-${ARCH}/bin/node`,
  ]);
  chmodSync(`${OUT}/runtime/bin/node`, 0o755);
  console.log(`  runtime/bin/node   ${mb(statSync(`${OUT}/runtime/bin/node`).size)}  (Node ${NODE_VERSION})`);
}

// ---------------------------------------------------------------- stage the package

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('\n  staging Function Compute package\n');

if (!existsSync('build/server.js')) {
  throw new Error('build/ is missing or stale. Run `pnpm build` first.');
}
if (!existsSync('palimpsest.db')) {
  throw new Error('palimpsest.db is missing. Run `pnpm ingest` to seed the store first.');
}

await vendorNode();

cpSync('build', `${OUT}/build`, { recursive: true });
copyFileSync('palimpsest.db', `${OUT}/palimpsest.db`);
copyFileSync('bootstrap', `${OUT}/bootstrap`);
chmodSync(`${OUT}/bootstrap`, 0o755); // FC execs it directly; without +x the function never starts.

/**
 * The replay cache travels WITH the function. This is not an optimisation either.
 *
 * FC gives the function a writable /tmp and nothing else, and /tmp belongs to one
 * INSTANCE. Warm the cache by asking a question, let the instance idle out, and the
 * cache is gone with it - the next visitor pays the full extract -> embed -> retrieve
 * -> adjudicate pipeline, ~109s of it, into a timeout. The site answered in under a
 * second all afternoon and then started returning 502 to anyone who came back later.
 *
 * Shipping the cache in the read-only code package fixes that at the root: a cold
 * instance is born already knowing the answers it has been paid for once. Named
 * without a leading dot so nothing along the zip/upload path quietly drops it.
 */
if (!existsSync(SEED_CACHE)) {
  throw new Error(
    `${SEED_CACHE} is missing - the function would deploy with an empty cache and every\n` +
      'request would be a cold ~109s Qwen call into a timeout. That is the 502.',
  );
}
cpSync(SEED_CACHE, `${OUT}/llm-cache`, { recursive: true });
const entries = execFileSync('find', [`${OUT}/llm-cache`, '-name', '*.json']).toString().trim();
console.log(`  llm-cache/         ${entries.split('\n').length} entries  (replayed, not re-paid)`);

// Prod dependencies, installed with npm rather than pnpm ON PURPOSE. pnpm's
// node_modules is a farm of symlinks into a global store - it works locally and
// arrives at FC as a pile of broken links, because the store is not in the zip.
copyFileSync('package.json', `${OUT}/package.json`);
console.log('  installing production dependencies (npm, real directories)...');
execFileSync('npm', ['install', '--omit=dev', '--no-package-lock', '--silent'], {
  cwd: OUT,
  stdio: 'inherit',
});

// The staged package.json's scripts reference tsx and other dev-only tooling that is
// not in the package. Nothing runs them there - bootstrap execs node directly - but a
// deployment artifact should not carry instructions it cannot honour.
const pkg = JSON.parse(readFileSync(`${OUT}/package.json`, 'utf8')) as Record<string, unknown>;
delete pkg.scripts;
delete pkg.devDependencies;
writeFileSync(`${OUT}/package.json`, JSON.stringify(pkg, null, 2));

// ---------------------------------------------------------------- report

const size = execFileSync('du', ['-sb', OUT]).toString().split('\t')[0]!;
console.log(`\n  ${OUT}/  ${mb(Number(size))}  (Singapore allows 500 MB)`);
console.log(`\n  next:  s deploy\n`);
