import type { PortalBookingDto, PortalFamilyMemberDto } from '../../core/portal/dto';
import { completedNewestFirst, firstBookingFor } from '../../core/portal/family';
import type { BookingFamilyMember, BookingGuardian } from '../../core/types';
import type { BookingLogger } from '../options';
import type { PortalSeam } from './medal-portal';

/**
 * One child, narrowed for the browser: the id, the name, the year and month
 * the wizard computes an age from, and the stylist a card can preselect.
 * `notes` (the note for the stylist) stays behind — it is for the salon, and the
 * wizard renders none of it. Nulls become absent keys, the wizard's rule.
 */
export function toBookingFamilyMember(
  member: PortalFamilyMemberDto,
  lastVisit: PortalBookingDto | null = null
): BookingFamilyMember {
  return {
    name: member.name,
    birthYear: member.birthYear,
    ...(member.personId === null ? {} : { personId: member.personId }),
    ...(member.birthMonth === null ? {} : { birthMonth: member.birthMonth }),
    ...(member.preferredResourceId === null
      ? {}
      : { preferredResourceId: member.preferredResourceId }),
    ...(lastVisit?.serviceId
      ? {
          lastVisit: {
            serviceId: lastVisit.serviceId,
            serviceName: lastVisit.serviceName,
            resourceId: lastVisit.resourceId,
            startTs: lastVisit.startTs,
          },
        }
      : {}),
  };
}

/**
 * The logged-in parent, as the booking wizard is allowed to see them.
 *
 * Two callers, one answer, and the reason this is a module rather than a
 * function in the booking page: the page asks it on the way in (a parent
 * who arrived holding a Min side cookie), and `POST /api/portal/login/verify`
 * asks it the moment an e-mail code has been accepted, so the wizard can fill
 * its fields in place instead of refreshing a whole server page to find out
 * who just logged in. A second copy of the narrowing in the route would be a
 * second place for the `contactId` or the marketing flag to leak into the
 * browser from.
 *
 * Takes the SESSION rather than reading the jar, because the route has the
 * token in hand before any cookie exists to read — and a handler reading back
 * its own `Set-Cookie` in the same request is not something to lean on.
 *
 * BEST EFFORT IN EVERY DIRECTION. A session Medal no longer honours, or Medal
 * being unreachable, is `null` and a warning — never a throw and never a
 * redirect. On the booking page that is a parent the page could not identify, who
 * books like everybody else; after a login it is a parent who is logged in but
 * whose fields the wizard cannot prefill, which is the same form they would
 * have typed into anyway.
 *
 * The narrowing to `BookingGuardian` is deliberate and happens HERE, on the
 * server: `contactId`, the marketing flag and the bransjemal labels stay behind
 * because the wizard renders none of them.
 */
export function createGuardian(
  portal: Pick<PortalSeam, 'getMe' | 'getMyBookings'>,
  logger: BookingLogger
): (session: string) => Promise<BookingGuardian | null> {
  const { getMe, getMyBookings } = portal;
  return async function guardianFromSession(session: string): Promise<BookingGuardian | null> {
    try {
      // The bookings only feed each child's «Sist: …» and step 2's «Samme som
      // sist», so they are best effort within best effort: a failed read is a
      // family without last visits, not a parent the wizard cannot recognise.
      const [profile, bookings] = await Promise.all([
        getMe(session),
        getMyBookings(session).catch((error: unknown) => {
          logger.warn({ err: error }, 'Could not read past bookings for the booking wizard');
          return null;
        }),
      ]);
      const last = firstBookingFor(profile.family, completedNewestFirst(bookings?.past ?? []));
      return {
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        phone: profile.phone,
        family: profile.family.map((member, index) => toBookingFamilyMember(member, last[index])),
      };
    } catch (error) {
      // The seam has already scrubbed the session out of this.
      logger.warn({ err: error }, 'Could not read the Min side profile for the booking wizard');
      return null;
    }
  };
}
