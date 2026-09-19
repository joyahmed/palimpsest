/**
 * Seed a household memory - the Alexa+ demo's starting state.
 *
 *   pnpm seed:household            -> writes into PALIMPSEST_DB (default ./palimpsest.db)
 *
 * These are the facts an assistant in a home is asked about and gets wrong the
 * moment they change: the wifi password, who picks the kids up, what the
 * thermostat is set to. Each is written as a claim with its kind - so the
 * thermostat setting (`state`, 7-day half-life) is already doubted by the time
 * the demo runs, while the family's names (`identity`) are not - and with its
 * embedding, so `believe` can retrieve it and `remember` can collide with it.
 *
 * No language model is needed to seed: the claims are written directly, only the
 * embedding runs, and that is local. The killing - "the wifi password is now X" -
 * is what the demo then does live, through remember().
 */

import { ClaimStore } from '../memory/store.js';
import { MODELS } from '../qwen/models.js';
import { embed } from '../qwen/client.js';
import type { ClaimKind } from '../memory/types.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

interface Seed {
  content: string;
  kind: ClaimKind;
  subject: string;
  daysAgo: number;
}

export const HOUSEHOLD: Seed[] = [
  { content: 'The home wifi network is called "Ahmed-5G" and the password is "mango2024".', kind: 'config', subject: 'wifi', daysAgo: 40 },
  { content: 'The thermostat is set to 24 degrees in the evenings.', kind: 'state', subject: 'thermostat', daysAgo: 3 },
  { content: 'Rafi has football practice on Tuesdays and Thursdays at 5 pm.', kind: 'state', subject: 'Rafi schedule', daysAgo: 12 },
  { content: 'Nadia picks the kids up from school on weekdays.', kind: 'state', subject: 'school pickup', daysAgo: 20 },
  { content: 'The family prefers the living room lights warm white in the evening.', kind: 'preference', subject: 'lighting', daysAgo: 60 },
  { content: 'Grocery delivery comes on Saturday mornings.', kind: 'state', subject: 'grocery delivery', daysAgo: 9 },
  { content: 'The car is a silver Toyota Axio with plate Dhaka Metro GA 11-2345.', kind: 'identity', subject: 'car', daysAgo: 200 },
  { content: 'The front door smart lock code is 4471.', kind: 'config', subject: 'door lock', daysAgo: 90 },
  { content: 'Dinner is usually at 8:30 pm.', kind: 'preference', subject: 'dinner time', daysAgo: 30 },
  { content: 'The electricity bill is paid through bKash on the 5th of each month.', kind: 'config', subject: 'electricity bill', daysAgo: 45 },
];

export async function seedHousehold(store: ClaimStore): Promise<number> {
  const existing = new Set(store.all().map((c) => c.content));
  const fresh = HOUSEHOLD.filter((s) => !existing.has(s.content));
  if (fresh.length === 0) return 0;
  const vectors = await embed(MODELS.embed, fresh.map((s) => s.content));
  fresh.forEach((s, i) => {
    store.add({
      content: s.content,
      kind: s.kind,
      subject: s.subject,
      sourceSession: 'household-seed',
      sourceQuote: s.content,
      observedAt: now - s.daysAgo * DAY,
      confidence: 1,
      embedding: vectors[i]!,
    });
  });
  return fresh.length;
}

if (process.argv[1] && /seed-household\.(ts|js)$/.test(process.argv[1])) {
  const store = new ClaimStore();
  const n = await seedHousehold(store);
  console.log(`household seed: ${n} claim(s) written, ${store.all().length} in the store`);
  store.close();
}
