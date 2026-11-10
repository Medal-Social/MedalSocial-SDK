/**
 * The wizard's accessibility round: the steps in the browser's
 * history, `party.skipWhoStep`, the `?kategori=` landing, the steppers'
 * singular and plural, `config.priceFormat`, and the «loading more» line
 * after a `?tjeneste=` link.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ search: '' as string | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => (location.search === null ? null : new URLSearchParams(location.search)),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { resolveBookingConfig } from '../../../src/core/config';
import type {
  BookingDayDto,
  BookingGuardian,
  BookingServiceDto,
  BookingSlotDto,
} from '../../../src/core/types';
import { BookingWizard, type BookingWizardProps } from '../../../src/react/BookingWizard';
import { HISTORY_KEY } from '../../../src/react/wizard/step-history';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

pinAForeignViewerClock();

const pad = (value: number) => String(value).padStart(2, '0');
const osloTs = (day: number, hour: number, minute = 0) =>
  Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`);
const NOW = osloTs(2, 8);

const KIDS: BookingServiceDto = {
  id: 'svc-kids',
  name: 'Barneklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
  bookableOnline: true,
};
const SMALL: BookingServiceDto = {
  ...KIDS,
  id: 'svc-small',
  name: 'Minstemann',
  ageMaxYears: 4,
  weekendSurchargePct: 0,
};
const PHONE_ONLY: BookingServiceDto = {
  ...KIDS,
  id: 'svc-phone',
  name: 'Telefonklipp',
  bookableOnline: false,
};
const BJARNE = {
  id: 'res-b',
  name: 'Bjarne',
  photoUrl: null,
  bio: null,
  serviceIds: [KIDS.id, SMALL.id],
  sortOrder: 1,
};
const OLA = { ...BJARNE, id: 'res-o', name: 'Ola', sortOrder: 2 };
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

type StubResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type Answer = { status: number; body: unknown } | (() => Promise<StubResponse>);

interface Stub {
  resources?: Answer;
  availability?: Answer;
  schedule?: Answer;
  create?: Answer;
  persons?: Answer;
  verify?: Answer;
}

function stubApi(stub: Stub = {}) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const reply = (answer: Answer | undefined, fallback: { status: number; body: unknown }) => {
    if (typeof answer === 'function') return answer();
    const { status, body } = answer ?? fallback;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      const { pathname, searchParams } = new URL(url, 'https://example.test');
      if (pathname === '/api/booking/resources') {
        return reply(stub.resources, { status: 200, body: { resources: [BJARNE, OLA] } });
      }
      if (pathname === '/api/booking/availability') {
        const id = searchParams.get('service_id');
        return reply(stub.availability, {
          status: 200,
          body: { slots: id === KIDS.id || id === SMALL.id ? [slot(2, 13, BJARNE.id)] : [] },
        });
      }
      if (pathname === '/api/booking/schedule') {
        return reply(stub.schedule, { status: 200, body: { days: OPEN_WEEK } });
      }
      if (pathname === '/api/booking/create') {
        return reply(stub.create, {
          status: 201,
          body: { bookings: [{ id: 'bk-1', manageToken: 'tok-1' }] },
        });
      }
      if (pathname === '/api/portal/persons') {
        return reply(stub.persons, { status: 201, body: { ok: false } });
      }
      if (pathname === '/api/portal/login/verify') {
        return reply(stub.verify, { status: 200, body: { ok: true, guardian: null } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return { urls, bodies };
}

const ACTIONS: NonNullable<BookingWizardProps['actions']> = {
  startLogin: async () => ({ status: 'sent' }),
};

function wizard(props: Partial<BookingWizardProps> = {}) {
  return (
    <BookingWizard
      config={PARITY_CONFIG}
      labels={TEST_LABELS}
      actions={ACTIONS}
      seed={{ services: [KIDS, SMALL, PHONE_ONLY], fromTs: NOW }}
      {...props}
    />
  );
}

const GUARDIAN: BookingGuardian = {
  firstName: 'Kari',
  lastName: null,
  email: 'kari@example.test',
  phone: '40000000',
  family: [
    { name: 'Theo', birthYear: 2019, personId: 'p-theo' },
    { name: 'Mia', birthYear: 2023, birthMonth: 2 },
  ],
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  window.sessionStorage.clear();
  location.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ADULT_CUT: BookingServiceDto = {
  ...KIDS,
  id: 'svc-adult',
  name: 'Herreklipp',
  category: 'annet',
  weekendSurchargePct: 0,
};

/** Every card a plain button, so a test picks a service by name. */
const CARDS: BookingWizardProps['components'] = {
  ServiceCard: ({ service, onPick }) => (
    <button type="button" onClick={onPick}>
      card:{service.name}
    </button>
  ),
};

/** One customer per booking, no «who» step. */
const ONE_SEAT = {
  ...PARITY_CONFIG,
  party: { ...PARITY_CONFIG.party, maxPeople: 1, askWhoFirst: false, skipWhoStep: true },
};

function resetHistory() {
  window.history.replaceState(null, '');
}

describe('BookingWizard — browser history', () => {
  beforeEach(resetHistory);

  it('tags the entry it arrived on, pushes a step, and steps back on popstate', async () => {
    stubApi();
    const user = userEvent.setup();
    const before = window.history.length;
    render(wizard({ components: CARDS }));
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'who', depth: 0 });
    expect(window.history.length).toBe(before);

    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'service', depth: 1 });
    expect(window.history.length).toBe(before + 1);

    await user.click(screen.getByRole('button', { name: 'card:Barneklipp' }));
    expect(await screen.findByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'when', depth: 2 });

    act(() => window.history.back());
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    // The visitor's answer is still there: back is a step, not a fresh page.
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'service', depth: 1 });
  });

  it('keeps the router’s own fields in the state it writes', () => {
    stubApi();
    window.history.replaceState({ __NA: true, tree: 'x' }, '');
    render(wizard());
    expect(window.history.state).toMatchObject({ __NA: true, tree: 'x' });
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'who', depth: 0 });
  });

  it('never pushes the same step twice', async () => {
    stubApi();
    const user = userEvent.setup();
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = render(wizard({ components: CARDS }));
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    rerender(wizard({ components: CARDS }));
    rerender(wizard({ components: CARDS }));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('walks history back when the wizard goes back to a step behind it', async () => {
    stubApi();
    const user = userEvent.setup();
    const go = vi.spyOn(window.history, 'go');
    render(wizard({ components: CARDS }));
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    await user.click(await screen.findByRole('button', { name: 'card:Barneklipp' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await user.click(screen.getByRole('button', { name: 'Tilbake til Hva' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(go).toHaveBeenCalledWith(-1);
  });

  it('re-tags an entry whose step cannot be reached instead of jumping to it', async () => {
    stubApi();
    render(wizard({ components: CARDS }));
    const forward = { [HISTORY_KEY]: { step: 'details', depth: 3 } };
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: forward }));
    });
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'who', depth: 3 });
  });

  it('ignores an entry the wizard never wrote', () => {
    stubApi();
    render(wizard());
    const replace = vi.spyOn(window.history, 'replaceState');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { other: 1 } }));
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      window.dispatchEvent(
        new PopStateEvent('popstate', { state: { [HISTORY_KEY]: { step: 'nope', depth: 1 } } })
      );
      window.dispatchEvent(
        new PopStateEvent('popstate', { state: { [HISTORY_KEY]: { step: 'who', depth: -1 } } })
      );
      window.dispatchEvent(new PopStateEvent('popstate', { state: { [HISTORY_KEY]: 'who' } }));
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('rewinds to the arrival entry once booked, so back leaves the page', async () => {
    stubApi();
    const user = userEvent.setup();
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    location.search = '?tjeneste=barneklipp';
    render(
      wizard({
        config: ONE_SEAT,
        components: {
          ...CARDS,
          TimeChip: ({ label, onPick }) => (
            <button type="button" onClick={onPick}>
              chip:{label}
            </button>
          ),
        },
      })
    );
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'when', depth: 0 });
    await user.click(await screen.findByRole('button', { name: 'chip:13:00' }));
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'details', depth: 1 });
    await user.type(screen.getByRole('textbox', { name: /Mobil/ }), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: /Timen er bekreftet/ });
    expect(go).toHaveBeenCalledWith(-1);
    // The traversal lands on the arrival entry, which becomes the booked screen.
    act(() => {
      window.dispatchEvent(
        new PopStateEvent('popstate', { state: { [HISTORY_KEY]: { step: 'when', depth: 0 } } })
      );
    });
    expect(window.history.state[HISTORY_KEY]).toEqual({ step: 'confirmed', depth: 0 });
  });
});

describe('BookingWizard — party.skipWhoStep', () => {
  beforeEach(resetHistory);

  it('refuses the flag for more than one person', () => {
    expect(() =>
      resolveBookingConfig({
        ...PARITY_CONFIG,
        party: { ...PARITY_CONFIG.party, maxPeople: 2, skipWhoStep: true },
      })
    ).toThrow(/skipWhoStep needs party.maxPeople 1/);
  });

  it('opens on the service step with three steps and no way back to «who»', () => {
    stubApi();
    render(wizard({ config: ONE_SEAT }));
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(screen.getByText(/Steg 1 av 3/)).toBeInTheDocument();
    const progress = screen.getByRole('list', { name: /steg|fremdrift|progress/i });
    expect(within(progress).queryByText('Hvem')).toBeNull();
    expect(within(progress).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Tilbake til/ })).toBeNull();
  });

  it('leaves «who» out of the compact crumbs and the desktop panel', () => {
    stubApi();
    const { container } = render(
      wizard({
        config: {
          ...ONE_SEAT,
          screens: { ...PARITY_CONFIG.screens, compactHeader: true, desktopPanel: true },
        },
      })
    );
    const crumbs = screen.getAllByRole('list')[0] as HTMLElement;
    expect(within(crumbs).getAllByRole('listitem')).toHaveLength(3);
    expect(within(crumbs).queryByText('Hvem')).toBeNull();
    const panel = within(container).getByTestId('booking-panel');
    expect(panel.parentElement).toHaveClass('[&_dl>div:first-child]:hidden');
  });

  it('still asks a logged-in parent with saved people who the visit is for', () => {
    stubApi();
    render(wizard({ config: ONE_SEAT, guardian: GUARDIAN }));
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(screen.getByText(/Steg 1 av 4/)).toBeInTheDocument();
  });

  it('skips it for a logged-in parent with nobody saved', () => {
    stubApi();
    render(wizard({ config: ONE_SEAT, guardian: { ...GUARDIAN, family: [] } }));
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(screen.getByText(/Steg 1 av 3/)).toBeInTheDocument();
  });
});

describe('BookingWizard — ?kategori= lands on its group', () => {
  beforeEach(resetHistory);

  it('scrolls the linked group into view once, on the service step', async () => {
    stubApi();
    location.search = '?kategori=annet';
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      wizard({
        config: ONE_SEAT,
        components: CARDS,
        seed: { services: [KIDS, ADULT_CUT], fromTs: NOW },
      })
    );
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('booking-services-annet'));
    expect(scroll.mock.calls[0][0]).toMatchObject({ block: 'start' });

    // Back on the step later: the list is left where the visitor scrolls it.
    await user.click(screen.getByRole('button', { name: 'card:Herreklipp' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    scroll.mockClear();
    await user.click(screen.getByRole('button', { name: /^Tilbake til/ }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    // Only the step change's own scroll, to the wizard's top.
    expect(scroll.mock.contexts).not.toContain(document.getElementById('booking-services-annet'));
  });

  it('does not scroll to the group the list starts with', async () => {
    stubApi();
    location.search = '?kategori=barn';
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(wizard({ config: ONE_SEAT, seed: { services: [KIDS, ADULT_CUT], fromTs: NOW } }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    await act(async () => {});
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does nothing for a group with no services on the page', async () => {
    stubApi();
    location.search = '?kategori=dame';
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(wizard({ config: ONE_SEAT, seed: { services: [KIDS, ADULT_CUT], fromTs: NOW } }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    await act(async () => {});
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('BookingWizard — counts in the right number', () => {
  beforeEach(resetHistory);

  const PARTY = {
    ...PARITY_CONFIG,
    screens: { ...PARITY_CONFIG.screens, guestParty: true, adultStepper: true },
  };

  it('reads the .one and .other forms for the number on the steppers', async () => {
    stubApi();
    const user = userEvent.setup();
    render(
      wizard({
        config: PARTY,
        labels: {
          ...TEST_LABELS,
          'who.party.count': '{count} stk',
          'who.party.count.one': '{count} barnet',
          'who.party.count.other': '{count} barna',
          'who.party.adultCount': '{count} voksne',
          'who.party.adultCount.one': '{count} voksen',
        },
      })
    );
    expect(await screen.findByText('1 barnet')).toBeInTheDocument();
    expect(screen.getByText('0 voksne')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /flere barn|Legg til et barn|Ett barn til/i })
    );
    expect(await screen.findByText('2 barna')).toBeInTheDocument();
  });

  it('keeps the screen’s own count where the pack has no forms', async () => {
    stubApi();
    render(wizard({ config: PARTY }));
    expect((await screen.findAllByText(/^1 barn$/)).length).toBeGreaterThan(0);
  });
});

describe('BookingWizard — config.priceFormat', () => {
  beforeEach(resetHistory);

  it('writes the wizard’s prices as «490,-» when the site asks for it', async () => {
    stubApi();
    render(
      wizard({
        config: { ...ONE_SEAT, priceFormat: 'dash' },
        seed: { services: [KIDS], fromTs: NOW },
      })
    );
    expect((await screen.findAllByText(/490,-/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/490 kr/)).toBeNull();
  });
});

describe('BookingWizard — the «loading more» line', () => {
  beforeEach(resetHistory);

  for (const chunked of [true, false]) {
    it(`clears once a ?tjeneste= link's window is read (${chunked ? 'chunked' : 'whole'})`, async () => {
      stubApi();
      location.search = '?tjeneste=barneklipp';
      render(
        <StrictMode>
          {wizard({
            config: ONE_SEAT,
            seed: {
              services: [KIDS],
              resources: [BJARNE],
              fromTs: NOW,
              toTs: NOW + 3 * 86400000,
              ...(chunked ? { maxAdvanceDays: 61 } : {}),
              slots: { [KIDS.id]: [slot(2, 13, BJARNE.id)] },
              schedules: { [KIDS.id]: OPEN_WEEK },
            },
          })}
        </StrictMode>
      );
      expect((await screen.findAllByText('13:00')).length).toBeGreaterThan(0);
      await waitFor(() => expect(screen.queryByText('Henter ledige tider …')).toBeNull());
    });
  }
});
