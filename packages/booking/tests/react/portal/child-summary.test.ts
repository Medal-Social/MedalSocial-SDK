import { describe, expect, it } from 'vitest';
import { createClock } from '../../../src/core/clock';
import type { PortalBookingDto, PortalFamilyMemberDto } from '../../../src/core/portal/dto';
import { createChildSummaries } from '../../../src/react/portal/child-summary';
import { PARITY_CONFIG } from '../../support/parity-config';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * The pure rule behind the children's cards on the portal (from the source's
 * `VisitHistory.test.tsx`; its `VisitHistory` and `visitYears` suites are
 * meda's `visit-history.test.tsx` now). It reads off `getMyBookings().past`,
 * which the dashboard already fetches. What has to hold is that a cancelled
 * appointment never counts as a visit, and that a child's last visit is
 * theirs and not their sibling's.
 */

// Years and dates are the salon's, not the reader's — a visit at 00:30 on 1
// January belongs to the year the salon says it does.
pinAForeignViewerClock();

const childSummaries = createChildSummaries(createClock(PARITY_CONFIG));

/** 3 June 2026, 14:00 Oslo. */
const JUNE_2026 = Date.parse('2026-06-03T14:00:00+02:00');
const MAY_2026 = Date.parse('2026-05-12T14:00:00+02:00');
const NOVEMBER_2025 = Date.parse('2025-11-04T14:00:00+01:00');

function visit(overrides: Partial<PortalBookingDto> = {}): PortalBookingDto {
  return {
    bookingId: 'bk-1',
    status: 'completed',
    startTs: JUNE_2026,
    endTs: JUNE_2026 + 1_800_000,
    serviceId: 'svc-barn',
    serviceName: 'Barneklipp',
    resourceId: 'res-bjarne',
    resourceName: 'Bjarne',
    bookedForName: 'Ida',
    bookedForPersonId: null,
    bookedForBirthYear: null,
    bookedForBirthMonth: null,
    amountOre: 49_000,
    notes: null,
    managePath: null,
    ...overrides,
  };
}

function member(name: string, birthYear: number): PortalFamilyMemberDto {
  return {
    personId: null,
    name,
    birthYear,
    birthMonth: null,
    notes: null,
    preferredResourceId: null,
  };
}

describe('childSummaries', () => {
  /** 2026, so a child born in 2018 is eight. */
  const NOW = JUNE_2026;

  it('puts the newest completed visit on each child’s card', () => {
    const [theo, ida] = childSummaries(
      [member('Theo', 2022), member('Ida', 2019)],
      [
        visit({
          bookingId: 'a',
          bookedForName: 'Theo',
          startTs: MAY_2026,
          serviceId: 'svc-maskin',
        }),
        visit({
          bookingId: 'b',
          bookedForName: 'Theo',
          startTs: NOVEMBER_2025,
          serviceId: 'svc-barn',
        }),
        visit({ bookingId: 'c', bookedForName: 'Ida', startTs: JUNE_2026 }),
      ],
      NOW
    );

    expect(theo).toMatchObject({ age: 4, lastVisitTs: MAY_2026, serviceId: 'svc-maskin' });
    expect(ida).toMatchObject({ age: 7, lastVisitTs: JUNE_2026, serviceId: 'svc-barn' });
  });

  /** Both sides are free text a parent typed months apart, so the match is the
   * one a human would make — and no looser than that. */
  it('matches a name that was typed with different case or spacing', () => {
    const [theo] = childSummaries(
      [member('Theo', 2022)],
      [visit({ bookedForName: '  theo ' })],
      NOW
    );

    expect(theo.lastVisitTs).toBe(JUNE_2026);
  });

  /**
   * The safe direction. A missing date reads as «ingen klipp hos oss ennå»;
   * a loose match would put the sibling's haircut on the wrong child.
   */
  it('leaves a child with no matching booking empty rather than guessing', () => {
    const [theo] = childSummaries(
      [member('Theo', 2022)],
      [visit({ bookedForName: 'Theodor' }), visit({ bookingId: 'z', bookedForName: null })],
      NOW
    );

    expect(theo.lastVisitTs).toBeNull();
    expect(theo.serviceId).toBeNull();
  });

  it('ignores a booking that never happened', () => {
    const [theo] = childSummaries(
      [member('Theo', 2022)],
      [visit({ bookedForName: 'Theo', status: 'cancelled' })],
      NOW
    );

    expect(theo.lastVisitTs).toBeNull();
  });

  /**
   * A family can genuinely hold two children with the same name, and nothing on
   * a booking says which of them sat in the chair. Filling both cards from the
   * newest one would put a sister's haircut on her sister — and «Bestill for
   * Emma» would re-book the wrong cut at the wrong price.
   */
  it('leaves both cards empty when two children share a name', () => {
    const summaries = childSummaries(
      [member('Emma', 2018), member('Emma', 2021)],
      [visit({ bookedForName: 'Emma' })],
      NOW
    );

    expect(summaries.map((child) => child.lastVisitTs)).toEqual([null, null]);
    expect(summaries.map((child) => child.serviceId)).toEqual([null, null]);
    // The children themselves are still on the page; only the visit is withheld.
    expect(summaries.map((child) => child.age)).toEqual([8, 5]);
  });

  /**
   * Ages follow the salon's calendar like every other date on this site. Between
   * Oslo midnight and UTC midnight on New Year's Eve, `getUTCFullYear` would
   * take a year off every child on the page.
   */
  it('reads the year off the salon calendar, not UTC', () => {
    // 00:30 on 1 January 2027 in Oslo is still 23:30 on 31 December in UTC.
    const newYearInOslo = Date.parse('2027-01-01T00:30:00+01:00');
    const [theo] = childSummaries([member('Theo', 2022)], [], newYearInOslo);

    expect(theo.age).toBe(5);
  });

  describe('by person id (SP10)', () => {
    const theo = { ...member('Theo', 2022), personId: 'p-theo' };
    const emma2018 = { ...member('Emma', 2018), personId: 'p-emma-1' };
    const emma2021 = { ...member('Emma', 2021), personId: 'p-emma-2' };

    it('puts each visit on the child whose id it carries, even when two share a name', () => {
      const summaries = childSummaries(
        [emma2018, emma2021],
        [
          visit({
            bookingId: 'a',
            bookedForName: 'Emma',
            bookedForPersonId: 'p-emma-2',
            serviceId: 'svc-jente',
          }),
          visit({
            bookingId: 'b',
            bookedForName: 'Emma',
            bookedForPersonId: 'p-emma-1',
            serviceId: 'svc-dame',
            startTs: MAY_2026,
          }),
        ],
        NOW
      );

      expect(summaries.map((child) => child.serviceId)).toEqual(['svc-dame', 'svc-jente']);
    });

    it('follows a rename: the id, not the name typed on the day, decides', () => {
      const [renamed] = childSummaries(
        [{ ...theo, name: 'Theodor' }],
        [visit({ bookedForName: 'Theo', bookedForPersonId: 'p-theo' })],
        NOW
      );

      expect(renamed.lastVisitTs).toBe(JUNE_2026);
    });

    it('never matches a booking that carries an id by its name', () => {
      const [card] = childSummaries(
        [theo],
        [visit({ bookedForName: 'Theo', bookedForPersonId: 'p-somebody-else' })],
        NOW
      );

      expect(card.lastVisitTs).toBeNull();
    });

    it('still reads an old booking with no id by name', () => {
      const [card] = childSummaries([theo], [visit({ bookedForName: 'Theo' })], NOW);

      expect(card.lastVisitTs).toBe(JUNE_2026);
    });

    it('carries the next appointment, the fast stylist and the age range', () => {
      const [card] = childSummaries([{ ...theo, preferredResourceId: 'res-bjarne' }], [], NOW, [
        visit({
          bookingId: 'late',
          status: 'confirmed',
          bookedForPersonId: 'p-theo',
          startTs: JUNE_2026 + 20 * 86_400_000,
        }),
        visit({
          bookingId: 'soon',
          status: 'pending',
          bookedForPersonId: 'p-theo',
          startTs: JUNE_2026 + 86_400_000,
        }),
      ]);

      expect(card.nextVisitTs).toBe(JUNE_2026 + 86_400_000);
      expect(card.preferredResourceId).toBe('res-bjarne');
      expect(card.ageRange).toEqual({ min: 3, max: 4 });
    });
  });
});
