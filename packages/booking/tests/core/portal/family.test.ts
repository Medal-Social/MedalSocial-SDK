import { describe, expect, it } from 'vitest';
import type { PortalBookingDto } from '../../../src/core/portal/dto';
import {
  completedNewestFirst,
  firstBookingFor,
  upcomingSoonestFirst,
} from '../../../src/core/portal/family';

function booking(overrides: Partial<PortalBookingDto>): PortalBookingDto {
  return {
    bookingId: 'bk',
    status: 'completed',
    startTs: 0,
    endTs: 0,
    serviceId: 'svc',
    serviceName: 'Barneklipp',
    resourceId: null,
    resourceName: null,
    bookedForName: null,
    bookedForPersonId: null,
    bookedForBirthYear: null,
    bookedForBirthMonth: null,
    amountOre: null,
    notes: null,
    managePath: null,
    ...overrides,
  };
}

describe('firstBookingFor', () => {
  it('joins by person id, and never by name when the booking carries an id', () => {
    const theo = booking({ bookingId: 'theo', bookedForPersonId: 'p-theo', bookedForName: 'Emma' });
    const emmaByName = booking({ bookingId: 'emma', bookedForName: ' emma ' });
    expect(
      firstBookingFor(
        [
          { personId: 'p-theo', name: 'Theo' },
          { personId: 'p-emma', name: 'Emma' },
        ],
        [theo, emmaByName]
      )
    ).toEqual([theo, emmaByName]);
  });

  it('matches nobody by a name two children share, or by no name at all', () => {
    const shared = booking({ bookedForName: 'Kim' });
    expect(
      firstBookingFor(
        [
          { personId: null, name: 'Kim' },
          { personId: null, name: 'kim' },
          { personId: null, name: '  ' },
        ],
        [shared]
      )
    ).toEqual([null, null, null]);
  });

  it('does not join an id-carrying booking to a child with no id', () => {
    expect(
      firstBookingFor(
        [{ personId: null, name: 'Theo' }],
        [booking({ bookedForPersonId: 'p-theo' })]
      )
    ).toEqual([null]);
  });
});

describe('ordering', () => {
  const a = booking({ bookingId: 'a', status: 'completed', startTs: 1 });
  const b = booking({ bookingId: 'b', status: 'completed', startTs: 3 });
  const c = booking({ bookingId: 'c', status: 'cancelled', startTs: 2 });
  const d = booking({ bookingId: 'd', status: 'confirmed', startTs: 5 });
  const e = booking({ bookingId: 'e', status: 'pending', startTs: 4 });

  it('reads completed visits newest first', () => {
    expect(completedNewestFirst([a, b, c, d]).map((x) => x.bookingId)).toEqual(['b', 'a']);
  });

  it('reads upcoming visits soonest first', () => {
    expect(upcomingSoonestFirst([a, c, d, e]).map((x) => x.bookingId)).toEqual(['e', 'd']);
  });
});
