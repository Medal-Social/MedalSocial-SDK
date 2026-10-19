import { readBookingPolicy } from './policy';
import type { BookingRuntime } from './runtime';
import { createSeed, type Seed } from './seed';

const seeds = new WeakMap<BookingRuntime, { days: number; maxAdvanceDays: number; seed: Seed }>();

/** Read the authoritative setting on each page load, never a stale local fallback. */
export async function policySeed(rt: BookingRuntime): Promise<Seed> {
  if (!rt.config.window.followPolicy) return rt.seed;
  const maxAdvanceDays = await readBookingPolicy(rt.medal);
  // Include the boundary date. The availability API enforces the exact instant
  // within that date, including when Oslo changes its UTC offset.
  const now = Date.now();
  const days = rt.clock.daysBetween(now, now + maxAdvanceDays * 86_400_000) + 1;
  const previous = seeds.get(rt);
  if (previous?.days === days && previous.maxAdvanceDays === maxAdvanceDays) return previous.seed;
  const seed = createSeed(
    {
      config: { ...rt.config, window: { ...rt.config.window, rangeDays: days } },
      policyMaxAdvanceDays: maxAdvanceDays,
      cache: rt.options.cache,
      logger: rt.logger,
      timing: rt.options.timing,
    },
    rt.catalogue
  );
  seeds.set(rt, { days, maxAdvanceDays: maxAdvanceDays, seed });
  return seed;
}
