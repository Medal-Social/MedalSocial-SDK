import type { ChildSummary } from '@medalsocial/meda/booking';
import { ageOnDay } from '../../core/age';
import type { Clock } from '../../core/clock';
import type { PortalBookingDto, PortalFamilyMemberDto } from '../../core/portal/dto';
import {
  completedNewestFirst,
  firstBookingFor,
  upcomingSoonestFirst,
} from '../../core/portal/family';

/**
 * One child's card, derived from the two reads the portal already makes: the
 * profile's family and the bookings. The newest completed booking for a child
 * is their last visit and the soonest upcoming one their next — joined by id,
 * by name only for bookings that carry none (`firstBookingFor`).
 *
 * The age is on the BUSINESS's today (`clock.dayKey`), not the reader's and
 * not UTC's: between local and UTC midnight on New Year's Eve the UTC year
 * would take a year off every child.
 */
export function createChildSummaries(clock: Pick<Clock, 'dayKey'>) {
  return function childSummaries(
    family: PortalFamilyMemberDto[],
    past: PortalBookingDto[],
    now: number = Date.now(),
    upcoming: PortalBookingDto[] = []
  ): ChildSummary[] {
    const today = clock.dayKey(now);
    const last = firstBookingFor(family, completedNewestFirst(past));
    const next = firstBookingFor(family, upcomingSoonestFirst(upcoming));
    return family.map((member, index) => {
      const visit = last[index];
      const ageRange = ageOnDay(member.birthYear, member.birthMonth, today) ?? { min: 0, max: 0 };
      return {
        personId: member.personId,
        name: member.name,
        birthYear: member.birthYear,
        birthMonth: member.birthMonth,
        ageRange,
        age: ageRange.max,
        lastVisitTs: visit?.startTs ?? null,
        serviceId: visit?.serviceId ?? null,
        serviceName: visit?.serviceName ?? null,
        resourceId: visit?.resourceId ?? null,
        preferredResourceId: member.preferredResourceId,
        nextVisitTs: next[index]?.startTs ?? null,
      };
    });
  };
}
