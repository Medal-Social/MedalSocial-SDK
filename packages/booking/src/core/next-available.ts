import type { BookingSlotDto } from './types';

/**
 * «Neste ledige» per stylist: the earliest start each one has in a list of
 * unfiltered openings. Pure and client-safe, because two places derive it from
 * slots they already hold — the booking page from its prefetch, and the wizard from
 * the live openings a `slotTaken` answer carries — and both have to give the
 * same answer the resources route does. A slot with no stylist fills
 * nobody's line.
 */
export function firstOpeningPerResource(slots: readonly BookingSlotDto[]): Record<string, number> {
  const earliest: Record<string, number> = {};
  for (const slot of slots) {
    if (slot.resourceId === null) continue;
    const seen = earliest[slot.resourceId];
    if (seen === undefined || slot.startTs < seen) earliest[slot.resourceId] = slot.startTs;
  }
  return earliest;
}

/**
 * The salon's next free start across every service in a seed — «neste ledige»
 * for the phone booking bar and the home hero, which do not know yet which
 * service the visitor wants. `null` when nothing in the window is free.
 * Slots that have already started are skipped.
 */
export function earliestOpening(
  slotsByService: Record<string, readonly BookingSlotDto[]>,
  now: number
): number | null {
  let earliest: number | null = null;
  for (const slots of Object.values(slotsByService)) {
    for (const slot of slots) {
      if (slot.startTs <= now) continue;
      if (earliest === null || slot.startTs < earliest) earliest = slot.startTs;
    }
  }
  return earliest;
}
