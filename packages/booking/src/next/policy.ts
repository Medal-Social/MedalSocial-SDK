import type { MedalSeam } from './medal';

export class BookingPolicyError extends Error {}

/** Uncached: changing the saved limit must affect the next booking read. */
export async function readBookingPolicy(medal: Pick<MedalSeam, 'getPolicy'>): Promise<number> {
  const { max_advance_days: days } = await medal.getPolicy().catch((cause: unknown) => {
    throw new BookingPolicyError('Public booking policy unavailable', { cause });
  });
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new BookingPolicyError('Invalid public booking horizon');
  }
  return days;
}
