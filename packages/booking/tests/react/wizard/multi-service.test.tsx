/**
 * Several services per person in the React shell: one person having a cut and
 * a wash is ONE visit — fetched, stored, seated, submitted, stashed and
 * confirmed as one — while a one-service basket asks with exactly the URLs it
 * always did.
 */

import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { createDraftStore, type WizardDraftItem } from '../../../src/core/draft-store';
import type {
  BookingDayDto,
  BookingResourceDto,
  BookingServiceDto,
  BookingSlotDto,
  BookingSubmission,
} from '../../../src/core/types';
import { BookingWizard } from '../../../src/react/BookingWizard';
import { createBookingKit } from '../../../src/react/kit';
import { useBooking } from '../../../src/react/useBooking';
import { confirmationProps, weekendNoteFor } from '../../../src/react/wizard/adapters';
import { TEST_LABELS } from '../../support/labels';
import { MULTI_SERVICE_CONFIG, PARITY_CONFIG } from '../../support/parity-config';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

pinAForeignViewerClock();

const pad = (value: number) => String(value).padStart(2, '0');
const osloTs = (day: number, hour: number, minute = 0) =>
  Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`);
const NOW = osloTs(2, 8);
/** A Saturday, for the per-service weekend rate. */
const SATURDAY = osloTs(5, 12);

const CUT: BookingServiceDto = {
  id: 'svc-cut',
  name: 'Klipp',
  category: 'dame',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 40_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
  bookableOnline: true,
};
const WASH: BookingServiceDto = {
  ...CUT,
  id: 'svc-wash',
  name: 'Vask',
  durationMinutes: 15,
  priceOre: 20_000,
  weekendSurchargePct: 20,
};
const COLOUR: BookingServiceDto = { ...CUT, id: 'svc-colour', name: 'Farge', durationMinutes: 60 };
const STYLE: BookingServiceDto = { ...CUT, id: 'svc-style', name: 'Føn', durationMinutes: 10 };
/** Only one person per booking may have it. */
const SOLO: BookingServiceDto = { ...CUT, id: 'svc-solo', name: 'Behandling', maxPerBooking: 1 };
/** On the children's menu. */
const KIDS_CUT: BookingServiceDto = {
  ...CUT,
  id: 'svc-kids',
  name: 'Barneklipp',
  category: 'barn',
};
const SERVICES = [CUT, WASH, COLOUR, STYLE, SOLO, KIDS_CUT];

const CUTS_ONLY: BookingResourceDto = {
  id: 'res-cuts',
  name: 'Bjarne',
  photoUrl: null,
  bio: null,
  serviceIds: [CUT.id],
  sortOrder: 1,
};
const DOES_BOTH: BookingResourceDto = {
  ...CUTS_ONLY,
  id: 'res-both',
  name: 'Ola',
  serviceIds: SERVICES.map((service) => service.id),
  sortOrder: 2,
};
const RESOURCES = [CUTS_ONLY, DOES_BOTH];

const OPEN_WEEK: BookingDayDto[] = [2, 3, 4, 5, 6, 7, 8].map((day) => ({
  dayKey: `2026-09-${pad(day)}`,
  opensTs: osloTs(day, 10),
  closesTs: osloTs(day, 17),
  lastStartTs: osloTs(day, 16, 30),
}));
const slot = (day: number, hour: number, resourceId: string): BookingSlotDto => ({
  startTs: osloTs(day, hour),
  resourceId,
});
/** The cut on its own, and the cut-and-wash visit: different answers, so a
 * test can tell which one the shell read. */
const CUT_SLOTS = [slot(2, 13, CUTS_ONLY.id)];
const VISIT_SLOTS = [slot(3, 11, DOES_BOTH.id)];

const drafts = createDraftStore(MULTI_SERVICE_CONFIG.storageNamespace);

type Answer = { status: number; body: unknown };

function stubApi(stub: { create?: Answer } = {}) {
  const urls: string[] = [];
  const bodies: Array<{ items: Array<Record<string, unknown>> }> = [];
  const answer = ({ status, body }: Answer) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      const { pathname, searchParams } = new URL(url, 'https://example.test');
      const extras = searchParams.get('extra_service_ids');
      if (pathname === '/api/booking/resources') {
        return answer({ status: 200, body: { resources: RESOURCES } });
      }
      if (pathname === '/api/booking/availability') {
        return answer({ status: 200, body: { slots: extras ? VISIT_SLOTS : CUT_SLOTS } });
      }
      if (pathname === '/api/booking/schedule') {
        return answer({ status: 200, body: { days: OPEN_WEEK } });
      }
      if (pathname === '/api/booking/create') {
        return answer(
          stub.create ?? {
            status: 201,
            body: {
              bookings: [
                { id: 'bk-1', manageToken: 't1' },
                { id: 'bk-2', manageToken: 't2' },
              ],
            },
          }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return { urls, bodies };
}

const options = (extra: Partial<Parameters<typeof useBooking>[0]> = {}) => ({
  config: MULTI_SERVICE_CONFIG,
  labels: TEST_LABELS,
  seed: { services: SERVICES, resources: RESOURCES, fromTs: NOW },
  ...extra,
});

const submission = (lines: number): BookingSubmission => ({
  items: Array.from({ length: lines }, () => ({ serviceId: CUT.id, startTs: osloTs(3, 11) })),
  contact: { phone: '40000000' },
  consentTerms: true,
  consentMarketing: false,
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  window.sessionStorage.clear();
  location.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One guest, on the service step, with `services` toggled on in order. */
function oneGuestWith(
  result: { current: ReturnType<typeof useBooking> },
  services: BookingServiceDto[]
) {
  act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
  for (const service of services) act(() => result.current.toggleServiceFor(0, service));
}

describe('useBooking — a visit of several services', () => {
  it('asks for the whole visit, and seats from the list stored under its key', async () => {
    const { urls } = stubApi();
    const { result } = renderHook(() => useBooking(options()));
    oneGuestWith(result, [CUT, WASH]);
    act(() => result.current.continueFromService());
    expect(result.current.state.step).toBe('when');

    const window = `from_ts=${NOW}&to_ts=${result.current.slots.toTs}`;
    const query = `service_id=svc-cut&extra_service_ids=svc-wash&${window}`;
    await waitFor(() => expect(result.current.slots.ready).toBe(true));
    expect(urls).toContain(`/api/booking/availability?${query}`);
    expect(urls).toContain(`/api/booking/schedule?${query}`);
    expect(urls).toContain(`/api/booking/resources?${query}`);
    // The visit's own answer — not the cut's.
    expect(result.current.slots.single).toEqual(VISIT_SLOTS);
  });

  it('asks a one-service basket with exactly the URL it always did', async () => {
    const { urls } = stubApi();
    const { result } = renderHook(() => useBooking(options()));
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(CUT));
    await waitFor(() => expect(result.current.slots.ready).toBe(true));
    const window = `from_ts=${NOW}&to_ts=${result.current.slots.toTs}`;
    expect(urls).toContain(`/api/booking/availability?service_id=svc-cut&${window}`);
    expect(urls.some((url) => url.includes('extra_service_ids'))).toBe(false);
    expect(result.current.slots.single).toEqual(CUT_SLOTS);
  });

  it('reads the seed for a one-service visit only, and fetches the longer one', async () => {
    const { urls } = stubApi();
    const seed = {
      services: SERVICES,
      resources: RESOURCES,
      fromTs: NOW,
      slots: { [CUT.id]: CUT_SLOTS },
      schedules: { [CUT.id]: OPEN_WEEK },
      nextAvailable: { [CUT.id]: { [CUTS_ONLY.id]: osloTs(2, 13) } },
    };
    const { result } = renderHook(() => useBooking(options({ seed })));
    oneGuestWith(result, [CUT]);
    expect(result.current.slots.ready).toBe(true);
    expect(urls).toEqual([]);

    act(() => result.current.toggleServiceFor(0, WASH));
    await waitFor(() => expect(result.current.slots.ready).toBe(true));
    expect(urls.every((url) => url.includes('extra_service_ids=svc-wash'))).toBe(true);
    expect(urls).toHaveLength(3);
  });

  it('continues only from the service step, and only once everybody has a service', () => {
    stubApi();
    const { result } = renderHook(() => useBooking(options()));
    act(() => result.current.continueFromService());
    expect(result.current.state.step).toBe('who');

    act(() => result.current.people.choosePeople([{ key: 'g1' }, { key: 'g2' }], true));
    act(() => result.current.toggleServiceFor(0, CUT));
    act(() => result.current.continueFromService());
    expect(result.current.state.step).toBe('service');

    act(() => result.current.toggleServiceFor(1, CUT));
    act(() => result.current.continueFromService());
    expect(result.current.state.step).toBe('when');
  });

  it('toggles a service off again, and lets a stylist go who cannot do the longer visit', () => {
    stubApi();
    const { result } = renderHook(() => useBooking(options()));
    oneGuestWith(result, [CUT]);
    act(() => result.current.pickResource(CUTS_ONLY.id));
    act(() => result.current.toggleServiceFor(0, WASH));
    expect(result.current.state.items[0].extraServices).toEqual([WASH]);
    expect(result.current.state.resourceId).toBeNull();

    act(() => result.current.toggleServiceFor(0, WASH));
    expect(result.current.state.items[0].extraServices).toBeUndefined();
  });

  it('sends the extras on the visit’s own line only', async () => {
    const { bodies } = stubApi();
    const { result } = renderHook(() => useBooking(options()));
    act(() => result.current.people.choosePeople([{ key: 'g1' }, { key: 'g2' }], true));
    act(() => result.current.toggleServiceFor(0, CUT));
    act(() => result.current.toggleServiceFor(0, WASH));
    act(() => result.current.toggleServiceFor(1, CUT));
    await act(() => result.current.submit(submission(2)));

    const [first, second] = bodies[0].items;
    expect(first.extraServiceIds).toEqual([WASH.id]);
    expect(second).not.toHaveProperty('extraServiceIds');
    // The frozen visit keeps the extras for the confirmation card.
    expect(result.current.confirmed?.submitted.items[0].extraServices).toEqual([WASH]);
  });

  it('refuses a body of another length rather than book the first service only', async () => {
    const { bodies } = stubApi();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useBooking(options()));
    oneGuestWith(result, [CUT, WASH]);
    await act(() => result.current.submit(submission(2)));
    expect(bodies).toHaveLength(0);
    expect(result.current.state.error).toBe('invalidInput');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('re-seeds a taken visit from the fresh slots under its key', async () => {
    const fresh = [slot(4, 15, DOES_BOTH.id)];
    stubApi({
      create: {
        status: 409,
        body: { error: 'slotTaken', freshSlots: { 'svc-cut+svc-wash': fresh, 'svc-cut': [] } },
      },
    });
    const { result } = renderHook(() => useBooking(options()));
    oneGuestWith(result, [CUT, WASH]);
    act(() => result.current.continueFromService());
    await waitFor(() => expect(result.current.slots.single).toEqual(VISIT_SLOTS));
    act(() => result.current.pickSlot(VISIT_SLOTS[0]));
    await act(() => result.current.submit(submission(1)));

    expect(result.current.slots.takenSlotTs).toBe(VISIT_SLOTS[0].startTs);
    expect(result.current.slots.single).toEqual(fresh);
    expect(result.current.slots.nextAvailableTs).toEqual({ [DOES_BOTH.id]: fresh[0].startTs });
  });

  it('drops a named stylist who cannot do every service of the visit', async () => {
    stubApi();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [line({ extraServiceIds: [WASH.id] })],
      resourceId: CUTS_ONLY.id,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.catalogue.stylistNotice).not.toBeNull());
    expect(result.current.state.resourceId).toBeNull();
    expect(result.current.state.items[0].extraServices).toEqual([WASH]);
  });
});

function line(extra: Partial<WizardDraftItem> = {}): WizardDraftItem {
  return {
    serviceId: CUT.id,
    bookedForName: null,
    bookedForBirthYear: null,
    adult: true,
    ...extra,
  };
}

function stashVisit(items: WizardDraftItem[]) {
  drafts.stashDraft({
    items,
    resourceId: null,
    partyMode: 'sequential',
    startTs: VISIT_SLOTS[0].startTs,
    resolvedResourceId: DOES_BOTH.id,
    partyResourceIds: null,
  });
}

describe('useBooking — a visit through the Vipps round trip', () => {
  it('stashes a line’s extras, and only where there are some', () => {
    stubApi();
    const { result } = renderHook(() => useBooking(options()));
    act(() => result.current.people.choosePeople([{ key: 'g1' }, { key: 'g2' }], true));
    act(() => result.current.toggleServiceFor(0, CUT));
    act(() => result.current.toggleServiceFor(0, WASH));
    act(() => result.current.toggleServiceFor(1, CUT));
    const stored = JSON.parse(window.sessionStorage.getItem(drafts.DRAFT_STORAGE_KEY) ?? '{}');
    expect(stored.items[0].extraServiceIds).toEqual([WASH.id]);
    expect(stored.items[1]).not.toHaveProperty('extraServiceIds');
  });

  it('brings the whole visit back, with its hour', async () => {
    stubApi();
    location.search = '?resume=1';
    stashVisit([line({ extraServiceIds: [WASH.id, STYLE.id] })]);
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.state.startTs).toBe(VISIT_SLOTS[0].startTs));
    expect(result.current.state.items[0].extraServices).toEqual([WASH, STYLE]);
    expect(result.current.state.resolvedResourceId).toBe(DOES_BOTH.id);
  });

  it.each([
    ['an extra the catalogue no longer books', [line({ extraServiceIds: ['svc-gone'] })]],
    ['the line’s own service again', [line({ extraServiceIds: [CUT.id] })]],
    [
      'more than the per-person ceiling',
      [line({ extraServiceIds: [WASH.id, COLOUR.id, STYLE.id] })],
    ],
    [
      'one taker too many for the service',
      [
        line({ extraServiceIds: [SOLO.id], adult: false }),
        line({ extraServiceIds: [SOLO.id], adult: false }),
      ],
    ],
  ])('lets the hour go when a visit comes back shorter: %s', async (_name, items) => {
    stubApi();
    location.search = '?resume=1';
    stashVisit(items);
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.state.items).toHaveLength(items.length));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.startTs).toBeNull();
    // What could come back did.
    expect(result.current.state.items[0].service).toEqual(CUT);
  });
});

describe('the shell around a visit', () => {
  const kit = createBookingKit(MULTI_SERVICE_CONFIG, TEST_LABELS);
  const visit = { service: CUT, extraServices: [WASH] };
  const confirmation = {
    bookings: [{ id: 'bk-1', manageHref: null }],
    submitted: {
      items: [visit],
      startTs: SATURDAY,
      partyMode: 'sequential' as const,
      resourceIds: [DOES_BOTH.id],
      stylistNames: ['Ola'],
    },
  };

  it('prices the confirmation line as the whole visit, each service at its own weekend rate', () => {
    const props = confirmationProps(kit, confirmation);
    const expected =
      kit.wizard.itemPriceOre(CUT, SATURDAY) + kit.wizard.itemPriceOre(WASH, SATURDAY);
    expect(kit.wizard.itemPriceOre(WASH, SATURDAY)).toBeGreaterThan(WASH.priceOre);
    expect(props.lines[0].priceOre).toBe(expected);
    expect(props.totalOre).toBe(expected);
  });

  it('writes one calendar entry as long as the visit, named after every service in it', () => {
    const ics = decodeURIComponent(confirmationProps(kit, confirmation).calendarHref ?? '').replace(
      /\r\n /g,
      ''
    );
    expect(ics).toContain('SUMMARY:Klipp + Vask hos Salong Demo');
    const end = ics.match(/^DTEND:(.*)$/m)?.[1];
    expect(end).toBe('20260905T104500Z');
  });

  it('notes the weekend for a visit whose second service pays it', () => {
    expect(weekendNoteFor(kit, [visit], SATURDAY)).toEqual({
      pct: null,
      priceOre: kit.wizard.totalPriceOre([visit], SATURDAY),
    });
    expect(weekendNoteFor(kit, [{ service: CUT }], SATURDAY)).toBeNull();
  });

  it('offers on the stylist step only the stylists who do every service of the visit', async () => {
    stubApi();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [line({ extraServiceIds: [WASH.id] })],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    render(
      <BookingWizard
        config={MULTI_SERVICE_CONFIG}
        labels={TEST_LABELS}
        seed={{ services: SERVICES, resources: RESOURCES, fromTs: NOW }}
      />
    );
    expect((await screen.findAllByText('Ola')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Bjarne')).toEqual([]);
  });
});

describe('<BookingWizard> — the multi-select service step', () => {
  // Synthetic on purpose: a public repository carries no real-looking person.
  const GUARDIAN = {
    firstName: 'Test',
    lastName: 'Forelder',
    email: 'forelder@example.com',
    phone: '+47 400 00 000',
    family: [{ name: 'Jonas', birthYear: 2018 }],
  };

  function renderStep(
    config: typeof PARITY_CONFIG = MULTI_SERVICE_CONFIG,
    guardian: typeof GUARDIAN | null = null
  ) {
    return render(
      <BookingWizard
        config={config}
        labels={TEST_LABELS}
        guardian={guardian}
        classNames={{ summary: { root: 'summary-bar' } }}
        seed={{ services: SERVICES, resources: RESOURCES, fromTs: NOW }}
      />
    );
  }

  /** A lone adult guest, on the service step. */
  async function asAdultGuest(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
  }

  const summaryBar = (container: HTMLElement) => container.querySelector('.summary-bar');

  it('ticks two services for one person, totals the visit and asks for it as one', async () => {
    const { urls } = stubApi();
    const user = userEvent.setup();
    const { container } = renderStep();
    await asAdultGuest(user);

    // Its own bar, not the wizard's.
    expect(summaryBar(container)).toBeNull();
    expect(screen.getByText('Velg minst én tjeneste')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Klipp/ }));
    await user.click(screen.getByRole('checkbox', { name: /Vask/ }));
    expect(screen.getByRole('checkbox', { name: /Klipp/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Vask/ })).toBeChecked();
    // 30 + 15 minutes, 400 + 200 kr: the number the summary bar would show.
    expect(screen.getByText(/^45 min · 600/)).toBeInTheDocument();
    expect(screen.queryByText('Velg minst én tjeneste')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await waitFor(() =>
      expect(
        urls.some(
          (url) =>
            url.startsWith('/api/booking/availability?') &&
            url.includes('service_id=svc-cut&extra_service_ids=svc-wash')
        )
      ).toBe(true)
    );
    // Past the service step the wizard's bar is back.
    expect(summaryBar(container)).not.toBeNull();
  });

  it('stays on the step when «Neste» is pressed with nothing ticked', async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await asAdultGuest(user);
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
  });

  it('refuses a fourth service politely, and forgets the refusal on the next tick', async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await asAdultGuest(user);
    for (const name of [/Klipp/, /Vask/, /Farge/, /Føn/]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    const refusal = 'Du kan velge opptil 3 tjenester per person.';
    expect(screen.getByText(refusal)).toBeInTheDocument();
    // Said once, in the step's own live region — not again as the wizard's alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Føn/ })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /Farge/ }));
    expect(screen.queryByText(refusal)).toBeNull();
    // 30 + 15 minutes once the colour is off again.
    expect(screen.getByText(/^45 min · 600/)).toBeInTheDocument();
  });

  it('gives a family one tab per person, and moves on once everyone has something', async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep(MULTI_SERVICE_CONFIG, GUARDIAN);
    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('checkbox', { name: /Meg selv \(voksen\)/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    const [jonas, adult] = tabs;
    expect(jonas).toHaveAccessibleName(/Jonas/);

    // The child's menu is the children's category only.
    await user.click(jonas);
    expect(screen.queryByRole('checkbox', { name: /Behandling/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Barneklipp/ }));
    expect(jonas).toHaveAccessibleName(/Jonas.*ferdig/);
    expect(screen.getByText('Velg minst én tjeneste')).toBeInTheDocument();

    // The grown-up takes the one-taker service, and a wash with it.
    await user.click(adult);
    await user.click(screen.getByRole('checkbox', { name: /Behandling/ }));
    await user.click(screen.getByRole('checkbox', { name: /Vask/ }));
    expect(screen.queryByText('Velg minst én tjeneste')).toBeNull();
    // Back to back: 30 (Jonas) + 30 + 15 (the adult).
    expect(screen.getByText(/^75 min · 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
  });

  /** A guardian whose one child last had a children's cut — «Samme som sist». */
  const RETURNING = {
    ...GUARDIAN,
    family: [
      {
        name: 'Jonas',
        birthYear: 2018,
        personId: 'p-1',
        lastVisit: {
          serviceId: KIDS_CUT.id,
          serviceName: KIDS_CUT.name,
          resourceId: null,
          startTs: NOW - 86_400_000,
        },
      },
    ],
  };

  async function asReturningChild(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
  }

  it('keeps «Samme som sist» one tap while the visit is just that service', async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep(MULTI_SERVICE_CONFIG, RETURNING);
    await asReturningChild(user);
    // A returning child is seated with the last service already ticked.
    expect(screen.getByRole('checkbox', { name: /Barneklipp/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Samme som sist/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
  });

  it('adds «Samme som sist» to a bigger visit and never unticks anything', async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep(MULTI_SERVICE_CONFIG, RETURNING);
    await asReturningChild(user);
    // Untick the seeded cut and take a wash instead, then ask for «the same».
    await user.click(screen.getByRole('checkbox', { name: /Barneklipp/ }));
    await user.click(screen.getByRole('checkbox', { name: /Vask/ }));
    await user.click(screen.getByRole('button', { name: /Samme som sist/ }));
    expect(screen.getByRole('checkbox', { name: /Vask/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Barneklipp/ })).toBeChecked();
    // Joined, not replaced — and still on the service step.
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    // Already in the visit: a second tap changes nothing.
    await user.click(screen.getByRole('button', { name: /Samme som sist/ }));
    expect(screen.getByRole('checkbox', { name: /Barneklipp/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Vask/ })).toBeChecked();
  });

  it('keeps the one-tap step, and the wizard’s bar, with the default of one service', async () => {
    stubApi();
    const user = userEvent.setup();
    const { container } = renderStep(PARITY_CONFIG);
    expect(PARITY_CONFIG.party.maxServicesPerPerson).toBe(1);
    await asAdultGuest(user);

    expect(summaryBar(container)).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('Velg én eller flere')).toBeNull();
    // A tap answers the step.
    await user.click(screen.getByRole('button', { name: /Klipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    expect(within(summaryBar(container) as HTMLElement).getByText(/Klipp/)).toBeInTheDocument();
  });
});
