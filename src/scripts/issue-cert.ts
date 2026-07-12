/**
 * Issue a Let's Encrypt certificate for the custom domain, via DNS-01.
 *
 *   pnpm cert          -> certs/fullchain.pem + certs/privkey.pem
 *
 * WHY WE NEED A CERT AT ALL. Alibaba forcibly adds `Content-Disposition: attachment`
 * to any text/html served from a default domain (*.fcapp.run, *.aliyuncs.com, OSS
 * included). A browser DOWNLOADS the audit view instead of rendering it, and there is
 * no setting to disable this. A custom domain is the only supported escape - and a
 * custom domain without TLS means a "Not secure" badge in the address bar, which is
 * not something to put in front of a judge.
 *
 * WHY DNS-01 AND NOT HTTP-01. HTTP-01 would have Let's Encrypt fetch a token from
 * http://<domain>/.well-known/acme-challenge/... - which our function would have to
 * serve, meaning a deploy in the middle of the cert flow. DNS-01 proves control of the
 * domain instead, and needs nothing from the running service.
 *
 * The one manual step is deliberate: you add a TXT record at your DNS provider. This
 * script prints exactly what to add, waits for it to appear on the AUTHORITATIVE
 * nameserver (not a cache, which would let a stale negative answer fail the order),
 * and then finishes on its own.
 *
 * The key never enters git - certs/ is ignored. s.yaml reads both PEMs from the
 * environment at deploy time; see `pnpm deploy:tls`.
 */

import acme from 'acme-client';
import { execFileSync } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { resolve4 } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const DOMAIN = process.env.PALIMPSEST_DOMAIN ?? 'palimpsest.zettabyteincorp.com';
const EMAIL = process.env.PALIMPSEST_CERT_EMAIL ?? 'joythegreatone@gmail.com';
const OUT = 'certs';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const R = '\x1b[0m';

/** Poll the AUTHORITATIVE nameservers until the TXT record shows up. */
async function waitForTxt(name: string, expected: string): Promise<void> {
  // Find who is authoritative for the zone, and ask THEM. Public resolvers cache
  // negative answers (NXDOMAIN) for minutes - long enough to fail an ACME order that
  // would otherwise have succeeded.
  const zone = DOMAIN.split('.').slice(-2).join('.');
  const resolver = new Resolver();
  const { resolveNs } = await import('node:dns/promises');
  const ns = await resolveNs(zone);
  const ips = (await Promise.all(ns.map((n) => resolve4(n).catch(() => [])))).flat();
  if (ips.length === 0) throw new Error(`could not resolve nameservers for ${zone}`);
  resolver.setServers(ips);
  console.log(`${DIM}  polling authoritative NS (${ns[0]}) for ${name}${R}`);

  for (let i = 0; i < 60; i++) {
    try {
      const records = await resolver.resolveTxt(name);
      const flat = records.map((r) => r.join(''));
      if (flat.includes(expected)) {
        console.log(`${GREEN}  ✓ TXT record is live${R}\n`);
        return;
      }
      console.log(`${DIM}  found ${flat.length} TXT record(s), none matching yet... (${i + 1}/60)${R}`);
    } catch {
      console.log(`${DIM}  not visible yet... (${i + 1}/60)${R}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error('TXT record never appeared. Check the record, then re-run.');
}

const client = new acme.Client({
  directoryUrl: acme.directory.letsencrypt.production,
  accountKey: await acme.crypto.createPrivateKey(),
});

const [key, csr] = await acme.crypto.createCsr({ commonName: DOMAIN });

console.log(`\n${BOLD}  issuing certificate for ${DOMAIN}${R}\n`);

const cert = await client.auto({
  csr,
  email: EMAIL,
  termsOfServiceAgreed: true,
  challengePriority: ['dns-01'],

  async challengeCreateFn(_authz, challenge, keyAuthorization) {
    if (challenge.type !== 'dns-01') throw new Error('expected a dns-01 challenge');
    const recordName = `_acme-challenge.${DOMAIN}`;
    const value = await client.getChallengeKeyAuthorization(challenge);

    console.log(`\n${BOLD}  ────────────────────────────────────────────────────────${R}`);
    console.log(`${BOLD}  ADD THIS TXT RECORD AT YOUR DNS PROVIDER${R}\n`);
    console.log(`    Type   TXT`);
    console.log(`    Name   ${BOLD}_acme-challenge.palimpsest${R}   ${DIM}(host/label only - the zone is added for you)${R}`);
    console.log(`    Value  ${BOLD}${value}${R}`);
    console.log(`    TTL    ${DIM}lowest available${R}`);
    console.log(`${BOLD}  ────────────────────────────────────────────────────────${R}\n`);
    console.log(`${DIM}  (full record name: ${recordName})${R}\n`);
    console.log(`${DIM}  waiting for the record to appear - add it now, no keypress needed.${R}`);

    await waitForTxt(recordName, value);
    // Let's Encrypt queries from several vantage points; give the zone a moment to settle.
    console.log(`${DIM}  waiting 20s for the record to settle across the zone...${R}`);
    await new Promise((r) => setTimeout(r, 20_000));
    void keyAuthorization;
  },

  async challengeRemoveFn() {
    console.log(`\n${DIM}  cert issued - the TXT record can be deleted whenever you like.${R}`);
  },
});

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/fullchain.pem`, cert.toString());

// acme-client hands back a PKCS#8 key ("BEGIN PRIVATE KEY"). Function Compute rejects
// it - `InvalidArgument: 'private key' has to be in PEM format` - because it wants the
// traditional PKCS#1 encoding ("BEGIN RSA PRIVATE KEY"). Both are PEM; the error message
// is simply wrong about what it is objecting to, which is worth knowing before you spend
// an hour checking your newlines.
const pkcs8 = key.toString();
const pkcs1 = execFileSync('openssl', ['rsa', '-traditional'], { input: pkcs8 }).toString();
writeFileSync(`${OUT}/privkey.pem`, pkcs1);

console.log(`\n${GREEN}${BOLD}  ✓ certificate issued${R}`);
console.log(`    ${OUT}/fullchain.pem`);
console.log(`    ${OUT}/privkey.pem   ${DIM}(gitignored - never commit this)${R}`);
console.log(`\n  next:  ${BOLD}pnpm deploy:tls${R}\n`);
