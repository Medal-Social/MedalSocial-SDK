import type { PortalBookingDto } from './dto';

/**
 * Which past (or upcoming) booking belongs to which child — BY ID (SP10).
 *
 * A booking carries `bookedForPersonId`, the id of the child it was made for,
 * and a child on the profile carries the same id; that pair is the join, and
 * it survives a rename, a nickname, and two siblings sharing a first name. It
 * replaces what `child-summary.ts` did before persons existed — comparing the
 * free text a parent typed on «Bekreft» with the free text on Min side.
 *
 * NAMES ARE THE FALLBACK, and only for a booking that carries no id: one made
 * before persons existed, one for somebody typed by hand, or any booking from
 * a Medal that does not send the id yet. For those the old rule stands —
 * trimmed, case-folded, and a name two children share names nobody, because a
 * missing «sist klipt» under-claims where a loose match would put a sister's
 * haircut on the wrong child. A booking that DOES carry an id is never matched
 * by name: its id is the answer, and a different child with the same name is a
 * different child.
 *
 * Pure and free of `server-only`: the dashboard renders it on the server and
 * the booking page does the same on the way to the wizard.
 */

export interface FamilyKey {
  personId: string | null;
  name: string;
}

/** Trimmed and case-folded — the two sides were typed on different screens. */
function nameKey(name: string | null): string | null {
  const trimmed = name?.trim().toLocaleLowerCase('nb-NO');
  return trimmed ? trimmed : null;
}

/**
 * For each child, the first booking in `bookings` that is theirs — so pass
 * them in the order «first» should mean (newest first for a last visit,
 * soonest first for the next one). `null` for a child with none.
 */
export function firstBookingFor(
  family: readonly FamilyKey[],
  bookings: readonly PortalBookingDto[]
): Array<PortalBookingDto | null> {
  // Names that appear twice in the family list name nobody in particular.
  const seen = new Map<string, number>();
  for (const member of family) {
    const key = nameKey(member.name);
    if (key !== null) seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return family.map((member) => {
    const wanted = nameKey(member.name);
    /* v8 ignore next -- every usable name was counted into `seen` above */
    const nameUsable = wanted !== null && (seen.get(wanted) ?? 0) === 1;
    const match = bookings.find((booking) => {
      if (booking.bookedForPersonId !== null) {
        return member.personId !== null && booking.bookedForPersonId === member.personId;
      }
      return nameUsable && nameKey(booking.bookedForName) === wanted;
    });
    return match ?? null;
  });
}

/** Completed bookings, newest first — the order a «last visit» is read in. */
export function completedNewestFirst(past: readonly PortalBookingDto[]): PortalBookingDto[] {
  return past
    .filter((booking) => booking.status === 'completed')
    .sort((a, b) => b.startTs - a.startTs);
}

/** Bookings still ahead, soonest first — the order a «next time» is read in. */
export function upcomingSoonestFirst(upcoming: readonly PortalBookingDto[]): PortalBookingDto[] {
  return upcoming
    .filter((booking) => booking.status === 'pending' || booking.status === 'confirmed')
    .sort((a, b) => a.startTs - b.startTs);
}
