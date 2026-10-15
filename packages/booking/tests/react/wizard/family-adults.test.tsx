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

const GUARDIAN: BookingGuardian = {
  firstName: 'Kari',
  lastName: null,
  email: 'kari@example.test',
  phone: '40000000',
  family: [{ name: 'Theo', birthYear: 2019, personId: 'p-theo' }],
};
const OTHER: BookingGuardian = { ...GUARDIAN, email: 'ola@example.test', family: [] };

const SELF = { key: 'self', adult: true };
const SECOND = { key: 'adult:2', adult: true };

const options = (extra: Partial<Parameters<typeof useBooking>[0]> = {}) => ({
  config: PARITY_CONFIG,
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
        { ...line, serviceId: GUTTEKLIPP.id, adult: false, personId: 'p-theo' },
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
      expect(keys(result.current.state.people)).toEqual(['self', 'adult:2', 'p:p-theo'])
    );
    expect(result.current.state.choices.map((service) => service?.id)).toEqual([
      HERREKLIPP.id,
      HERREKLIPP.id,
      GUTTEKLIPP.id,
    ]);
    expect(result.current.state.step).toBe('when');
  });

  it('rebuilds a draft from before the adult flag as it always did: children, Theo by id', async () => {
    const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
    const line = { bookedForName: null, bookedForBirthYear: null };
    stashDraft({
      items: [
        { ...line, serviceId: GUTTEKLIPP.id, personId: 'p-theo' },
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
    await waitFor(() => expect(keys(result.current.state.people)).toEqual(['p:p-theo', 'guest:2']));
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
          personId: 'p-theo',
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
