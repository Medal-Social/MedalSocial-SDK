import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * A second grown-up under a family. A parent's step 1 counts its grown-ups
 * with the same stepper a guest's does — «Meg selv» on seat 1, `adult:2`
 * after it — so a login over a two-grown-up party, a switch to another
 * account and a resumed draft all keep both.
 */

const location = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { resolveBookingConfig } from '../../../src/core/config';
import { createDraftStore } from '../../../src/core/draft-store';
import type { BookingGuardian, BookingServiceDto } from '../../../src/core/types';
import { useBooking } from '../../../src/react/useBooking';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

pinAForeignViewerClock();

const NOW = Date.parse('2026-09-02T08:00:00+02:00');

const HERREKLIPP: BookingServiceDto = {
  id: 'svc-herre',
  name: 'Herreklipp',
  category: 'herre',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 57_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
  bookableOnline: true,
};
const GUTTEKLIPP: BookingServiceDto = {
  ...HERREKLIPP,
  id: 'svc-gutt',
  name: 'Gutteklipp',
  category: 'barn',
};

// Synthetic people only: this repository is public.
const GUARDIAN: BookingGuardian = {
  firstName: 'Parent A',
  lastName: null,
  email: 'parent-a@example.test',
  phone: '00000000',
  family: [{ name: 'Child A', birthYear: 2019, personId: 'p-child-a' }],
};
const OTHER: BookingGuardian = { ...GUARDIAN, email: 'parent-b@example.test', family: [] };

const SELF = { key: 'self', adult: true };
const SECOND = { key: 'adult:2', adult: true };

/** The site these grown-ups were seated on: «Voksen» is a number. */
const STEPPER_CONFIG = resolveBookingConfig({
  ...PARITY_CONFIG,
  screens: { ...PARITY_CONFIG.screens, guestParty: true, adultStepper: true },
});

const options = (extra: Partial<Parameters<typeof useBooking>[0]> = {}) => ({
  config: STEPPER_CONFIG,
  labels: TEST_LABELS,
  seed: { services: [HERREKLIPP, GUTTEKLIPP], resources: [], fromTs: NOW },
  ...extra,
});

const keys = (people: readonly { key: string }[]) => people.map((person) => person.key);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ slots: [], days: [] }) }))
  );
  window.sessionStorage.clear();
  window.localStorage.clear();
  location.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useBooking — a second grown-up under a family', () => {
  it('keeps both grown-ups when a guest logs in on step 1', async () => {
    const { result } = renderHook(() => useBooking(options()));
    act(() => {
      result.current.people.choosePeople([{ key: 'adult', adult: true }, SECOND], false);
    });
    act(() => {
      result.current.login.signIn(GUARDIAN);
    });
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['self', 'adult:2']));
  });

  it('keeps the second grown-up when another account logs in over the party', async () => {
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    act(() => {
      result.current.people.choosePeople([SELF, SECOND], false);
    });
    act(() => {
      result.current.login.signIn(OTHER);
    });
    await waitFor(() => expect(result.current.login.guardian?.email).toBe(OTHER.email));
    expect(keys(result.current.state.people)).toEqual(['self', 'adult:2']);
  });

  it('resumes a two-grown-up draft as «Meg selv» and a second grown-up, beside a child', async () => {
    const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
    const line = { bookedForName: null, bookedForBirthYear: null };
    stashDraft({
      items: [
        { ...line, serviceId: HERREKLIPP.id, adult: true },
        { ...line, serviceId: HERREKLIPP.id, adult: true },
        { ...line, serviceId: GUTTEKLIPP.id, adult: false, personId: 'p-child-a' },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() =>
      expect(keys(result.current.state.people)).toEqual(['self', 'adult:2', 'p:p-child-a'])
    );
    expect(result.current.state.choices.map((service) => service?.id)).toEqual([
      HERREKLIPP.id,
      HERREKLIPP.id,
      GUTTEKLIPP.id,
    ]);
    expect(result.current.state.step).toBe('when');
  });

  it('rebuilds a draft from before the adult flag as it always did: children, the child by id', async () => {
    const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
    const line = { bookedForName: null, bookedForBirthYear: null };
    stashDraft({
      items: [
        { ...line, serviceId: GUTTEKLIPP.id, personId: 'p-child-a' },
        { ...line, serviceId: GUTTEKLIPP.id },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() =>
      expect(keys(result.current.state.people)).toEqual(['p:p-child-a', 'guest:2'])
    );
  });

  it('never claims a grown-up’s line for a saved child, whatever id it carries', async () => {
    const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
    stashDraft({
      items: [
        {
          serviceId: HERREKLIPP.id,
          bookedForName: null,
          bookedForBirthYear: null,
          adult: true,
          personId: 'p-child-a',
        },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['self']));
  });
});

describe('useBooking — a draft the site has changed under', () => {
  const HOUR = Date.parse('2026-09-02T13:00:00+02:00');
  const line = { bookedForName: null, bookedForBirthYear: null };
  const stash = (
    items: Parameters<ReturnType<typeof createDraftStore>['stashDraft']>[0]['items']
  ) => {
    createDraftStore(PARITY_CONFIG.storageNamespace).stashDraft({
      items,
      resourceId: null,
      partyMode: 'sequential',
      startTs: HOUR,
      resolvedResourceId: null,
      partyResourceIds: null,
      seatResourceIds: items.map((_, index) => `res-${index}`),
    });
    location.search = '?resume=1';
  };
  const TWO_GROWN_UPS_AND_A_CHILD = [
    { ...line, serviceId: HERREKLIPP.id, adult: true },
    { ...line, serviceId: HERREKLIPP.id, adult: true },
    { ...line, serviceId: GUTTEKLIPP.id, adult: false },
  ];

  it('comes back whole, hour and all, when it still fits', async () => {
    stash(TWO_GROWN_UPS_AND_A_CHILD);
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.state.startTs).toBe(HOUR));
    expect(keys(result.current.state.people)).toEqual(['self', 'adult:2', 'guest:1']);
  });

  it('leaves out a second grown-up once «Voksen» is no longer a number, and the hour with it', async () => {
    stash(TWO_GROWN_UPS_AND_A_CHILD);
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      screens: { ...PARITY_CONFIG.screens, guestParty: true },
    });
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN, config })));
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['self', 'guest:1']));
    expect(result.current.state.choices.map((service) => service?.id)).toEqual([
      HERREKLIPP.id,
      GUTTEKLIPP.id,
    ]);
    expect(result.current.state.startTs).toBeNull();
  });

  it('leaves out a second grown-up when the party controls are off, even with the stepper on', async () => {
    stash(TWO_GROWN_UPS_AND_A_CHILD);
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      screens: { ...PARITY_CONFIG.screens, guestParty: false, adultStepper: true },
    });
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN, config })));
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['self', 'guest:1']));
    expect(result.current.state.startTs).toBeNull();
  });

  it('keeps the lines that still fit a lower party limit, rather than none', async () => {
    stash(TWO_GROWN_UPS_AND_A_CHILD);
    const config = resolveBookingConfig({
      ...STEPPER_CONFIG,
      party: { ...STEPPER_CONFIG.party, maxPeople: 2 },
    });
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN, config })));
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['self', 'adult:2']));
    expect(result.current.state.startTs).toBeNull();
  });

  it('keeps the lines a service can still take, in their order', async () => {
    stash(TWO_GROWN_UPS_AND_A_CHILD);
    const { result } = renderHook(() =>
      useBooking(
        options({
          guardian: GUARDIAN,
          seed: {
            services: [{ ...HERREKLIPP, maxPerBooking: 1 }, GUTTEKLIPP],
            resources: [],
            fromTs: NOW,
          },
        })
      )
    );
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['self', 'guest:1']));
    expect(result.current.state.choices.map((service) => service?.id)).toEqual([
      HERREKLIPP.id,
      GUTTEKLIPP.id,
    ]);
    expect(result.current.state.startTs).toBeNull();
  });
});
