import type { PortalBooking, PortalPerson, PortalProfile } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import {
  createPortalDto,
  type PortalBookingDto,
  rebookSuggestions,
  toPortalProfileDto,
} from '../../../src/core/portal/dto';
import { PARITY_CONFIG } from '../../support/parity-config';

const { toPortalBookingDto } = createPortalDto(PARITY_CONFIG);

/**
 * Annotated as the wire type rather than inferred, for the reason
 * `administrer.test.ts` gives: `status` is a literal union, and an unannotated
 * fixture widens it to `string` and is then free to describe a booking Medal
 * can never send.
 */
function booking(overrides: Partial<PortalBooking> = {}): PortalBooking {
  return {
    booking_id: 'bk-1',
    status: 'completed',
    start_ts: Date.UTC(2026, 7, 10, 9),
    end_ts: Date.UTC(2026, 7, 10, 9, 30),
    start_ts_iso: new Date(Date.UTC(2026, 7, 10, 9)).toISOString(),
    end_ts_iso: new Date(Date.UTC(2026, 7, 10, 9, 30)).toISOString(),
    service_id: 'svc-barneklipp',
    service_name: 'Barneklipp',
    resource_id: 'res-anna',
    resource_name: 'Anna',
    booked_for_name: 'Ola',
    booked_for_person_id: null,
    booked_for_birth_year: null,
    booked_for_birth_month: null,
    amount_ore: 39000,
    payment_mode: 'none',
    payment_status: 'none',
    notes: null,
    manage_token: null,
    can_manage: false,
    ...overrides,
  };
}

function person(overrides: Partial<PortalPerson> & Record<string, unknown>): PortalPerson {
  return {
    person_id: 'p-x',
    name: 'X',
    birth_year: 2018,
    relation_type: 'guardian',
    relation_label: null,
    notes: null,
    active: true,
    ...overrides,
  } as PortalPerson;
}

/** A family as a Medal that predates SP10 sends it: names and years, no ids. */
const legacyFamily = (...members: { name: string; birth_year: number }[]) =>
  members as PortalProfile['family'];

const PROFILE: PortalProfile = {
  contact_id: 'ct-1',
  email: 'kari@example.com',
  first_name: 'Kari',
  last_name: 'Nordmann',
  phone: '40000000',
  family: legacyFamily({ name: 'Ola', birth_year: 2018 }, { name: 'Mia', birth_year: 2021 }),
  persons: [],
  labels: { person: 'Barn', persons: 'Barn' },
  marketing_consent: true,
  created_at: Date.UTC(2026, 0, 1),
};

describe('toPortalProfileDto', () => {
  it('projects every field the page reads, and nothing it does not', () => {
    // `toEqual` on the WHOLE object: `created_at` must not leak through, and a
    // field renamed on the wire must fail here rather than render as undefined.
    expect(toPortalProfileDto(PROFILE)).toEqual({
      contactId: 'ct-1',
      email: 'kari@example.com',
      firstName: 'Kari',
      lastName: 'Nordmann',
      phone: '40000000',
      family: [
        {
          personId: null,
          name: 'Ola',
          birthYear: 2018,
          birthMonth: null,
          notes: null,
          preferredResourceId: null,
        },
        {
          personId: null,
          name: 'Mia',
          birthYear: 2021,
          birthMonth: null,
          notes: null,
          preferredResourceId: null,
        },
      ],
      personDetails: false,
      marketingConsent: true,
      labels: { person: 'Barn', persons: 'Barn' },
    });
  });

  it('says whether Vipps is linked only when Medal says so', () => {
    // Absent on today's Medal: the Profil row is not drawn at all.
    expect('vippsLinked' in toPortalProfileDto(PROFILE)).toBe(false);
    for (const linked of [true, false]) {
      const wire = { ...PROFILE, vipps_linked: linked } as unknown as PortalProfile;
      expect(toPortalProfileDto(wire).vippsLinked).toBe(linked);
    }
    // Not a boolean is not an answer.
    const odd = { ...PROFILE, vipps_linked: 'yes' } as unknown as PortalProfile;
    expect('vippsLinked' in toPortalProfileDto(odd)).toBe(false);
  });

  it('carries the SP10 person fields when Medal sends them on family and persons', () => {
    const sp10 = {
      ...PROFILE,
      family: [
        { name: 'Ola', birth_year: 2018, person_id: 'p-ola', birth_month: 4 },
        { name: 'Mia', birth_year: 2021, person_id: 'p-mia', birth_month: null },
      ],
      persons: [
        person({ person_id: 'p-ola', name: 'Ola', birth_year: 2018, notes: 'Redd for maskin' }),
        person({ person_id: 'p-mia', name: 'Mia', birth_year: 2021, preferred_resource_id: 'r1' }),
      ],
    } as unknown as PortalProfile;

    const dto = toPortalProfileDto(sp10);

    expect(dto.personDetails).toBe(true);
    expect(dto.family).toEqual([
      {
        personId: 'p-ola',
        name: 'Ola',
        birthYear: 2018,
        birthMonth: 4,
        notes: 'Redd for maskin',
        preferredResourceId: null,
      },
      {
        personId: 'p-mia',
        name: 'Mia',
        birthYear: 2021,
        birthMonth: null,
        notes: null,
        preferredResourceId: 'r1',
      },
    ]);
  });

  it('finds the person behind a family entry by name and year when Medal sends no id', () => {
    // Today's Medal: `family` is names only, `persons` carries the ids.
    const today = {
      ...PROFILE,
      persons: [
        person({ person_id: 'p-ola', name: 'Ola', birth_year: 2018 }),
        person({ person_id: 'p-mia', name: 'Mia', birth_year: 2021 }),
      ],
    };

    const dto = toPortalProfileDto(today);

    expect(dto.family.map((member) => member.personId)).toEqual(['p-ola', 'p-mia']);
    // No SP10 fields on the wire, so nothing to edit beyond name and year.
    expect(dto.personDetails).toBe(false);
  });

  it('leaves the id null when two persons share the name and year', () => {
    const twins = {
      ...PROFILE,
      family: legacyFamily({ name: 'Ola', birth_year: 2018 }),
      persons: [
        person({ person_id: 'p-1', name: 'Ola', birth_year: 2018 }),
        person({ person_id: 'p-2', name: 'Ola', birth_year: 2018 }),
      ],
    };

    expect(toPortalProfileDto(twins).family[0].personId).toBeNull();
  });

  it('ignores a birth month that is not 1–12', () => {
    const odd = {
      ...PROFILE,
      family: [{ name: 'Ola', birth_year: 2018, person_id: 'p-ola', birth_month: 13 }],
    } as unknown as PortalProfile;

    expect(toPortalProfileDto(odd).family[0].birthMonth).toBeNull();
  });

  it('keeps nulls as nulls rather than coalescing them to text', () => {
    const dto = toPortalProfileDto({
      ...PROFILE,
      first_name: null,
      last_name: null,
      phone: null,
      family: [],
      marketing_consent: false,
    });

    expect(dto.firstName).toBeNull();
    expect(dto.lastName).toBeNull();
    expect(dto.phone).toBeNull();
    expect(dto.family).toEqual([]);
    expect(dto.marketingConsent).toBe(false);
  });
});

describe('toPortalBookingDto', () => {
  it('names the stylist the way the booking wizard does, for every portal card', () => {
    expect(
      toPortalBookingDto(booking({ resource_name: 'bjarne (Salong Demo)' })).resourceName
    ).toBe('Bjarne');
    expect(toPortalBookingDto(booking({ resource_name: null })).resourceName).toBeNull();
  });

  it('projects every field and turns the manage token into the manage PATH', () => {
    expect(
      toPortalBookingDto(booking({ manage_token: 'manage-token-abc', can_manage: true }))
    ).toEqual({
      bookingId: 'bk-1',
      status: 'completed',
      startTs: Date.UTC(2026, 7, 10, 9),
      endTs: Date.UTC(2026, 7, 10, 9, 30),
      serviceId: 'svc-barneklipp',
      serviceName: 'Barneklipp',
      resourceId: 'res-anna',
      resourceName: 'Anna',
      bookedForName: 'Ola',
      bookedForPersonId: null,
      bookedForBirthYear: null,
      bookedForBirthMonth: null,
      amountOre: 39000,
      notes: null,
      managePath: '/bestill/administrer/manage-token-abc',
    });
  });

  it('carries who the visit was for by id, and the frozen birth year and month (SP10)', () => {
    const dto = toPortalBookingDto({
      ...booking(),
      booked_for_person_id: 'p-ola',
      booked_for_birth_year: 2018,
      booked_for_birth_month: 4,
    } as PortalBooking);

    expect(dto.bookedForPersonId).toBe('p-ola');
    expect(dto.bookedForBirthYear).toBe(2018);
    expect(dto.bookedForBirthMonth).toBe(4);
  });

  it('never carries the raw token under any key', () => {
    const dto = toPortalBookingDto(
      booking({ manage_token: 'manage-token-example', can_manage: true })
    );

    // The path is the one sanctioned place for the token to appear; nowhere
    // else on the object — a `manageToken` field would be a second copy that
    // some future serialiser forgets to treat as a credential.
    const { managePath, ...rest } = dto;
    expect(JSON.stringify(rest)).not.toContain('manage-token-example');
    expect(managePath).toBe('/bestill/administrer/manage-token-example');
  });

  it('encodes a token that is not URL-safe rather than emitting a broken path', () => {
    expect(toPortalBookingDto(booking({ manage_token: 'a/b c' })).managePath).toBe(
      '/bestill/administrer/a%2Fb%20c'
    );
  });

  it('gives a null path when there is no token', () => {
    expect(toPortalBookingDto(booking({ manage_token: null })).managePath).toBeNull();
  });

  it('keeps the nullable catalogue fields null instead of inventing names', () => {
    const dto = toPortalBookingDto(
      booking({
        service_id: null,
        service_name: null,
        resource_id: null,
        resource_name: null,
        booked_for_name: null,
        amount_ore: null,
      })
    );

    expect(dto.serviceId).toBeNull();
    expect(dto.serviceName).toBeNull();
    expect(dto.resourceId).toBeNull();
    expect(dto.resourceName).toBeNull();
    expect(dto.bookedForName).toBeNull();
    expect(dto.amountOre).toBeNull();
  });
});

describe('rebookSuggestions', () => {
  function past(overrides: Partial<PortalBooking> = {}): PortalBookingDto {
    return toPortalBookingDto(booking(overrides));
  }

  it('suggests one card per distinct (service, stylist, child), newest first', () => {
    const suggestions = rebookSuggestions([
      past({ booking_id: 'old', start_ts: Date.UTC(2026, 3, 1), resource_id: 'res-old' }),
      past({ booking_id: 'newest', start_ts: Date.UTC(2026, 7, 1) }),
      past({ booking_id: 'middle', start_ts: Date.UTC(2026, 5, 1), booked_for_name: 'Mia' }),
    ]);

    expect(suggestions.map((s) => [s.resourceId, s.bookedForName])).toEqual([
      ['res-anna', 'Ola'],
      ['res-anna', 'Mia'],
      ['res-old', 'Ola'],
    ]);
  });

  it('carries the fields the «Bestill igjen» link needs and nothing else', () => {
    expect(rebookSuggestions([past()])).toEqual([
      {
        serviceId: 'svc-barneklipp',
        serviceName: 'Barneklipp',
        resourceId: 'res-anna',
        resourceName: 'Anna',
        bookedForName: 'Ola',
      },
    ]);
  });

  it('dedupes the same haircut booked many times into one suggestion', () => {
    const suggestions = rebookSuggestions([
      past({ booking_id: 'a', start_ts: Date.UTC(2026, 1, 1) }),
      past({ booking_id: 'b', start_ts: Date.UTC(2026, 3, 1) }),
      past({ booking_id: 'c', start_ts: Date.UTC(2026, 5, 1) }),
    ]);

    expect(suggestions).toHaveLength(1);
  });

  it('treats «any stylist» and a named stylist as different suggestions', () => {
    const suggestions = rebookSuggestions([
      past({ booking_id: 'a', start_ts: 1, resource_id: null, resource_name: null }),
      past({ booking_id: 'b', start_ts: 2 }),
    ]);

    expect(suggestions.map((s) => s.resourceId)).toEqual(['res-anna', null]);
  });

  it('skips cancelled, no-show, pending and confirmed rows — only a completed cut is worth repeating', () => {
    const suggestions = rebookSuggestions([
      past({ booking_id: 'a', status: 'cancelled', booked_for_name: 'A' }),
      past({ booking_id: 'b', status: 'no_show', booked_for_name: 'B' }),
      past({ booking_id: 'c', status: 'pending', booked_for_name: 'C' }),
      past({ booking_id: 'd', status: 'confirmed', booked_for_name: 'D' }),
      past({ booking_id: 'e', status: 'completed', booked_for_name: 'E' }),
    ]);

    expect(suggestions.map((s) => s.bookedForName)).toEqual(['E']);
  });

  it('skips a booking whose service is gone — there is nothing to link to', () => {
    expect(rebookSuggestions([past({ service_id: null })])).toEqual([]);
  });

  it('caps the list at four by default and honours an explicit maximum', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, index) =>
      past({ booking_id: name, booked_for_name: name, start_ts: Date.UTC(2026, index, 1) })
    );

    expect(rebookSuggestions(many)).toHaveLength(4);
    expect(rebookSuggestions(many, 2).map((s) => s.bookedForName)).toEqual(['F', 'E']);
  });

  it('does not reorder the caller’s array', () => {
    const input = [
      past({ booking_id: 'old', start_ts: 1, booked_for_name: 'Old' }),
      past({ booking_id: 'new', start_ts: 2, booked_for_name: 'New' }),
    ];
    rebookSuggestions(input);
    expect(input.map((b) => b.bookingId)).toEqual(['old', 'new']);
  });
});
