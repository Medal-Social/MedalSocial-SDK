import type { MedalSeam } from './medal';

/** Uncached: changing the saved limit must affect the next booking read. */
export async function readBookingPolicy(medal: Pick<MedalSeam, 'getPolicy'>): Promise<number> {
  const { max_advance_days: days } = await medal.getPolicy();
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new Error('Invalid public booking horizon');
  }
  return days;
}
