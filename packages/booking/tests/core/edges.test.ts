/**
 * Edges of the moved modules that the old suite only reached through the
 * components (or not at all). Each one pins an existing behaviour; none of
 * them is new.
 */

import type { PortalProfile } from '@medalsocial/sdk';
import { describe, expect, it } from 'vitest';
import { createAge } from '../../src/core/age';
import { resourceMatches } from '../../src/core/deep-link';
import { createDto } from '../../src/core/dto';
import { createWizard, initialState, type WizardService } from '../../src/core/machine';
import { findPartySlots } from '../../src/core/party-slots';
import { createPortalDto, toPortalProfileDto } from '../../src/core/portal/dto';
import { vippsConfirmFrom } from '../../src/core/portal/vipps-return';
import { PARITY_CONFIG } from '../support/parity-config';

const { reduce, summaryLine } = createWizard(PARITY_CONFIG);

const GUTTEKLIPP: WizardService = {
  id: 'svc-gutteklipp',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
};

describe('wizard machine', () => {
  it('says nothing in the bar before anything is chosen', () => {
    expect(summaryLine(initialState(), () => null)).toBe('');
  });

  it('names the logged-in parent’s own seat', () => {
    const state = reduce(initialState(), {
      type: 'choosePeople',
      people: [
        { key: 'self', adult: true },
        { key: 'adult', adult: true },
      ],
    });
    expect(summaryLine(state, () => null)).toBe('Meg selv, Voksen');
  });

  it('seats a guest «Voksen» as «Meg selv» once, even beside the parent’s own seat', () => {
    const state = reduce(initialState(), {
      type: 'choosePeople',
      people: [
        { key: 'adult', adult: true },
        { key: 'self', adult: true },
      ],
      advance: true,
    });
    const seated = reduce(state, { type: 'seatFamily' });
    expect(seated.people).toEqual([{ key: 'self', adult: true }]);
    expect(seated.choices).toEqual([null]);
  });

  it('takes a service for the first seat before anybody is seated', () => {
    const next = reduce(initialState(), { type: 'pickServiceFor', index: 0, service: GUTTEKLIPP });
    expect(next.people).toEqual([{ key: 'guest:1' }]);
    expect(next.step).toBe('when');
  });

  it('seats an empty party slot on an empty basket with nobody', () => {
    const next = reduce(initialState(), {
      type: 'pickPartySlot',
      startTs: 1,
      resourceIds: [],
      mode: 'sequential',
    });
    expect(next.resolvedResourceId).toBeNull();
  });
});

describe('age', () => {
  it('is the one same-group service that fits, banded or not', () => {
    const { grownUpEquivalent } = createAge(PARITY_CONFIG);
    const last = { id: 'a', name: 'Gutteklipp', category: 'barn', ageMaxYears: 6 };
    const next = { id: 'b', name: 'Barneklipp', category: 'barn' };
    expect(grownUpEquivalent(last, [last, next], { min: 7, max: 7 })).toBe(next);
  });
});

describe('deep links', () => {
  it('matches no stylist for a blank wish', () => {
    expect(resourceMatches({ id: 'r1', name: 'Sara' }, '  ')).toBe(false);
  });
});

describe('party slots', () => {
  it('finds nothing for a service with no availability at all', () => {
    expect(findPartySlots([{ service: GUTTEKLIPP }], {}, 'sequential')).toEqual([]);
  });
});

describe('booking DTOs', () => {
  const dto = createDto(PARITY_CONFIG);

  it('gives a nameless, unordered stylist a blank name and the last place', () => {
    expect(
      dto.toBookingResourceDto({
        id: 'res-1',
        name: null,
        photo_url: null,
        bio: null,
        service_ids: [],
        sort_order: null,
      })
    ).toEqual({
      id: 'res-1',
      name: '',
      photoUrl: null,
      bio: null,
      serviceIds: [],
      sortOrder: Number.MAX_SAFE_INTEGER,
    });
  });

  it('drops a day with no closing time', () => {
    expect(
      dto.toBookingDayDto({
        date: '2026-09-02',
        opens_ts: '2026-09-02T08:00:00.000Z',
        closes_ts: null,
        last_start_ts: null,
      })
    ).toEqual([]);
  });
});

describe('portal DTOs', () => {
  it('reads a profile without a persons list as a family of names', () => {
    const profile = {
      contact_id: 'ct',
      email: 'kari@example.no',
      first_name: null,
      last_name: null,
      phone: null,
      family: [{ name: 'Theo', birth_year: 2018 }],
      marketing_consent: false,
    } as unknown as PortalProfile;
    expect(toPortalProfileDto(profile).family[0]?.personId).toBeNull();
  });

  it('keeps a missing stylist name missing, and a name that cleans to nothing too', () => {
    const { toPortalBookingDto } = createPortalDto(PARITY_CONFIG);
    const base = {
      booking_id: 'bk',
      status: 'completed' as const,
      start_ts: 0,
      end_ts: 0,
      start_ts_iso: '',
      end_ts_iso: '',
      service_id: null,
      service_name: null,
      resource_id: null,
      booked_for_name: null,
      booked_for_person_id: null,
      booked_for_birth_year: null,
      booked_for_birth_month: null,
      amount_ore: null,
      payment_mode: 'none' as const,
      payment_status: 'none' as const,
      notes: null,
      manage_token: null,
      can_manage: false,
    };
    expect(toPortalBookingDto({ ...base, resource_name: null }).resourceName).toBeNull();
    expect(toPortalBookingDto({ ...base, resource_name: '   ' }).resourceName).toBeNull();
  });
});

describe('vipps return', () => {
  it('is no confirm step without a query', () => {
    expect(vippsConfirmFrom(null)).toBeUndefined();
  });
});
