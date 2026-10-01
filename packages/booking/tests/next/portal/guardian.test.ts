import { describe, expect, it, vi } from 'vitest';

import type { PortalBookingDto, PortalProfileDto } from '../../../src/core/portal/dto';
import { createGuardian, toBookingFamilyMember } from '../../../src/next/portal/guardian';
import type { PortalSeam } from '../../../src/next/portal/medal-portal';

/** The portal seam and the logger, faked where the source mocked their modules. */
const getMe = vi.fn<PortalSeam['getMe']>();
const getMyBookings = vi.fn<PortalSeam['getMyBookings']>();
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const guardianFromSession = createGuardian({ getMe, getMyBookings }, logger);

function booking(overrides: Partial<PortalBookingDto>): PortalBookingDto {
  return {
    bookingId: 'bk',
    status: 'completed',
    startTs: Date.UTC(2026, 7, 12, 8),
    endTs: Date.UTC(2026, 7, 12, 8, 30),
    serviceId: 'svc-gutt',
    serviceName: 'Gutteklipp',
    resourceId: 'res-sara',
    resourceName: 'Sara',
    bookedForName: 'Ola',
    bookedForPersonId: 'p-ola',
    bookedForBirthYear: 2018,
    bookedForBirthMonth: null,
    amountOre: 49_000,
    notes: null,
    managePath: null,
    ...overrides,
  };
}

const PROFILE: PortalProfileDto = {
  contactId: 'ct-1',
  email: 'kari@example.com',
  firstName: 'Kari',
  lastName: null,
  phone: '40000000',
  family: [
    {
      personId: 'p-ola',
      name: 'Ola',
      birthYear: 2018,
      birthMonth: null,
      notes: 'Redd for maskin',
      preferredResourceId: null,
    },
  ],
  personDetails: true,
  marketingConsent: false,
};

describe('guardianFromSession', () => {
  it('puts each child’s last completed visit on them, by id', async () => {
    vi.mocked(getMe).mockResolvedValue(PROFILE);
    vi.mocked(getMyBookings).mockResolvedValue({
      upcoming: [],
      past: [
        booking({ bookingId: 'old', startTs: Date.UTC(2026, 3, 1) }),
        booking({ bookingId: 'new' }),
        booking({ bookingId: 'cancelled', status: 'cancelled', startTs: Date.UTC(2026, 8, 1) }),
      ],
    });

    const guardian = await guardianFromSession('session');

    expect(guardian?.family).toEqual([
      {
        name: 'Ola',
        birthYear: 2018,
        personId: 'p-ola',
        lastVisit: {
          serviceId: 'svc-gutt',
          serviceName: 'Gutteklipp',
          resourceId: 'res-sara',
          startTs: Date.UTC(2026, 7, 12, 8),
        },
      },
    ]);
    // The salon's note stays on the server.
    expect(JSON.stringify(guardian)).not.toContain('Redd for maskin');
  });

  it('still recognises the parent when the bookings cannot be read', async () => {
    vi.mocked(getMe).mockResolvedValue(PROFILE);
    vi.mocked(getMyBookings).mockRejectedValue(new Error('down'));

    const guardian = await guardianFromSession('session');

    expect(guardian?.email).toBe('kari@example.com');
    expect(guardian?.family[0]).not.toHaveProperty('lastVisit');
  });
});

describe('toBookingFamilyMember', () => {
  it('keeps the id, the month and the fast stylist, and leaves the salon note behind', () => {
    expect(
      toBookingFamilyMember({
        personId: 'p-ola',
        name: 'Ola',
        birthYear: 2018,
        birthMonth: 4,
        notes: 'Redd for maskin',
        preferredResourceId: 'res-sara',
      })
    ).toEqual({
      personId: 'p-ola',
      name: 'Ola',
      birthYear: 2018,
      birthMonth: 4,
      preferredResourceId: 'res-sara',
    });
  });

  it('turns every null into an absent key, the wizard’s rule', () => {
    const member = toBookingFamilyMember({
      personId: null,
      name: 'Mia',
      birthYear: 2021,
      birthMonth: null,
      notes: null,
      preferredResourceId: null,
    });

    expect(member).toEqual({ name: 'Mia', birthYear: 2021 });
    expect(Object.keys(member)).toEqual(['name', 'birthYear']);
  });
});
