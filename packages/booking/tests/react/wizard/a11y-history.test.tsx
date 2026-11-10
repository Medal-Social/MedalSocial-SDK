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
import { createBookingKit } from '../../../src/react/kit';
import { mergeLabels } from '../../../src/react/labels';
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

  /** The mark on the current entry. */
  const here = () => window.history.state?.[HISTORY_KEY];
  /** A mark of the visit on the current entry, or of another. */
  const markOf = (step: string, depth: number, visit: string = here().visit) => ({
    [HISTORY_KEY]: { step, depth, visit },
  });
  const pop = (...states: unknown[]) =>
    act(() => {
      for (const state of states) window.dispatchEvent(new PopStateEvent('popstate', { state }));
    });
  const TIME_CHIPS: BookingWizardProps['components'] = {
    ...CARDS,
    TimeChip: ({ label, onPick }) => (
      <button type="button" onClick={onPick}>
        chip:{label}
      </button>
    ),
  };

  /** A guest on «when» (depth 2): «Voksen», then Barneklipp. */
  async function onTheTimeStep(user: ReturnType<typeof userEvent.setup>) {
    render(wizard({ components: CARDS }));
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    await user.click(await screen.findByRole('button', { name: 'card:Barneklipp' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
  }

  it('tags the entry it arrived on, pushes a step, and steps back on popstate', async () => {
    stubApi();
    const user = userEvent.setup();
    const before = window.history.length;
    render(wizard({ components: CARDS }));
    expect(here()).toEqual({ step: 'who', depth: 0, visit: expect.any(String) });
    const visit = here().visit;
    expect(window.history.length).toBe(before);

    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(here()).toEqual({ step: 'service', depth: 1, visit });
    expect(window.history.length).toBe(before + 1);

    await user.click(screen.getByRole('button', { name: 'card:Barneklipp' }));
    expect(await screen.findByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    expect(here()).toEqual({ step: 'when', depth: 2, visit });

    act(() => window.history.back());
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    // The visitor's answer is still there: back is a step, not a fresh page.
    expect(here()).toEqual({ step: 'service', depth: 1, visit });
  });

  it('keeps the router’s own fields in the state it writes', () => {
    stubApi();
    window.history.replaceState({ __NA: true, tree: 'x' }, '');
    render(wizard());
    expect(window.history.state).toMatchObject({ __NA: true, tree: 'x' });
    expect(here()).toMatchObject({ step: 'who', depth: 0 });
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
    await onTheTimeStep(user);
    await user.click(screen.getByRole('button', { name: 'Tilbake til Hva' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(go).toHaveBeenCalledWith(-1);
  });

  it('never lets the browser’s back move forward after an in-app back past the arrival', async () => {
    stubApi();
    const user = userEvent.setup();
    location.search = '?tjeneste=barneklipp';
    const push = vi.spyOn(window.history, 'pushState');
    render(wizard({ config: ONE_SEAT, components: TIME_CHIPS }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    const visit = here().visit;
    expect(here()).toEqual({ step: 'when', depth: 0, visit });
    await user.click(screen.getByRole('button', { name: 'Tilbake til Hva' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    // «Hva» takes the arrival entry over instead of being pushed after «Når».
    expect(push).not.toHaveBeenCalled();
    expect(here()).toEqual({ step: 'service', depth: 0, visit });
    // Forward again is a new entry after it, and back returns to «Hva».
    await user.click(screen.getByRole('button', { name: 'card:Barneklipp' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    expect(here()).toEqual({ step: 'when', depth: 1, visit });
    act(() => window.history.back());
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(here()).toEqual({ step: 'service', depth: 0, visit });
  });

  it('sends a forward step it cannot show back to where the visitor was', () => {
    stubApi();
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    render(wizard({ components: CARDS }));
    pop(markOf('details', 3));
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(go).toHaveBeenCalledWith(-3);
    // The return lands on the entry the visitor was on: nothing more to do.
    go.mockClear();
    pop(markOf('who', 0));
    expect(go).not.toHaveBeenCalled();
  });

  it('passes another visit’s entries through, and ignores unmarked ones', () => {
    stubApi();
    render(wizard());
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const replace = vi.spyOn(window.history, 'replaceState');
    pop(
      { other: 1 },
      null,
      { [HISTORY_KEY]: { step: 'nope', depth: 1, visit: 'x' } },
      { [HISTORY_KEY]: { step: 'who', depth: -1, visit: 'x' } },
      { [HISTORY_KEY]: { step: 'who', depth: 1 } },
      { [HISTORY_KEY]: 'who' }
    );
    expect(go).not.toHaveBeenCalled();
    pop(markOf('service', 1, 'an-earlier-visit'));
    expect(go).toHaveBeenCalledExactlyOnceWith(-1);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('takes the visit over when the page opens on a marked entry (a reload, a return)', () => {
    stubApi();
    window.history.replaceState(
      { [HISTORY_KEY]: { step: 'details', depth: 2, visit: 'before-reload' } },
      ''
    );
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    render(wizard({ components: CARDS }));
    // Nothing restored: the fresh wizard is on «who», at the entry's depth.
    expect(here()).toEqual({ step: 'who', depth: 2, visit: 'before-reload' });
    // «when» behind it cannot be shown any more: straight out of the visit,
    // never a press that changes nothing.
    pop(markOf('when', 1));
    expect(go).toHaveBeenCalledExactlyOnceWith(-2);
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('leaves the visit from an entry that holds a booking already made', async () => {
    stubApi();
    const user = userEvent.setup();
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    render(wizard({ components: CARDS }));
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    pop(markOf('confirmed', 0));
    expect(go).toHaveBeenCalledExactlyOnceWith(-1);
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
  });

  it('keeps the newest of two quick traversals (back, then forward)', async () => {
    stubApi();
    const user = userEvent.setup();
    await onTheTimeStep(user);
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    // Both land before React shows the first: forward must win.
    pop(markOf('service', 1), markOf('when', 2));
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
    expect(here()).toMatchObject({ step: 'when', depth: 2 });
  });

  it('holds the form while a booking is in flight, and rewinds once booked', async () => {
    let answer: (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void =
      () => {};
    const held = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>(
      (resolve) => {
        answer = resolve;
      }
    );
    stubApi({ create: () => held });
    const user = userEvent.setup();
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    location.search = '?tjeneste=barneklipp';
    render(wizard({ config: ONE_SEAT, components: TIME_CHIPS }));
    expect(here()).toMatchObject({ step: 'when', depth: 0 });
    await user.click(await screen.findByRole('button', { name: 'chip:13:00' }));
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
    expect(here()).toMatchObject({ step: 'details', depth: 1 });
    await user.type(screen.getByRole('textbox', { name: /Mobil/ }), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    // Back while it is being sent: history goes back to the form's entry.
    pop(markOf('when', 0));
    expect(go).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('heading', { name: 'Nesten ferdig!' })).toBeInTheDocument();
    pop(markOf('details', 1));

    await act(async () => {
      answer({
        ok: true,
        status: 201,
        json: async () => ({ bookings: [{ id: 'bk-1', manageToken: 'tok-1' }] }),
      });
    });
    await screen.findByRole('heading', { name: /Timen er bekreftet/ });
    expect(go).toHaveBeenLastCalledWith(-1);
    // The rewind lands on the arrival entry, which becomes the booked screen.
    pop(markOf('when', 0));
    expect(here()).toMatchObject({ step: 'confirmed', depth: 0 });
    // Forward into the old form comes straight back: no extra back to press.
    pop(markOf('details', 1));
    expect(go).toHaveBeenLastCalledWith(-1);
    expect(screen.getByRole('heading', { name: /Timen er bekreftet/ })).toBeInTheDocument();
  });

  it('rewrites the arrival entry as booked when the booking was made there', async () => {
    stubApi();
    const user = userEvent.setup();
    location.search = '?tjeneste=barneklipp';
    render(wizard({ config: ONE_SEAT, components: TIME_CHIPS }));
    await user.click(await screen.findByRole('button', { name: 'chip:13:00' }));
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
    // The visitor came back to the arrival entry with the browser and booked from there.
    const visit = here().visit;
    window.history.replaceState({ [HISTORY_KEY]: { step: 'details', depth: 0, visit } }, '');
    pop(markOf('details', 0));
    await user.type(screen.getByRole('textbox', { name: /Mobil/ }), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: /Timen er bekreftet/ });
    expect(here()).toEqual({ step: 'confirmed', depth: 0, visit });
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

  it('seats a guest as the grown-up, even on a site with a children’s menu', () => {
    stubApi();
    render(wizard({ config: ONE_SEAT }));
    // The bar names who before what: one grown-up, never «1 barn».
    expect(screen.getByText('Voksen')).toBeInTheDocument();
    expect(screen.queryByText(/1 barn/)).toBeNull();
  });

  it('still seats a child for a guest whose link asks for one', () => {
    stubApi();
    location.search = '?hvem=barn';
    render(wizard({ config: ONE_SEAT }));
    expect(screen.getByText('1 barn')).toBeInTheDocument();
  });

  it('seats a parent with nobody saved as themselves, whatever the link says', async () => {
    stubApi();
    location.search = '?hvem=barn';
    render(wizard({ config: ONE_SEAT, guardian: { ...GUARDIAN, family: [] } }));
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(await screen.findByText('Meg selv')).toBeInTheDocument();
    expect(screen.queryByText('1 barn')).toBeNull();
  });

  it('opens «book another» on the service step too', async () => {
    stubApi();
    const user = userEvent.setup();
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
    await user.click(await screen.findByRole('button', { name: 'chip:13:00' }));
    await user.type(await screen.findByRole('textbox', { name: /Mobil/ }), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await user.click(await screen.findByRole('button', { name: 'Bestill ny time' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(screen.getByText(/Steg 1 av 3/)).toBeInTheDocument();
    expect(screen.getByText('Voksen')).toBeInTheDocument();
  });

  it('opens «book another» on the service step for a parent with nobody saved', async () => {
    stubApi();
    const user = userEvent.setup();
    location.search = '?tjeneste=barneklipp';
    render(
      wizard({
        config: ONE_SEAT,
        guardian: { ...GUARDIAN, family: [] },
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
    await user.click(await screen.findByRole('button', { name: 'chip:13:00' }));
    const phone = await screen.findByRole('textbox', { name: /Mobil/ });
    await user.clear(phone);
    await user.type(phone, '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await user.click(await screen.findByRole('button', { name: 'Bestill ny time' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(screen.getByText(/Steg 1 av 3/)).toBeInTheDocument();
    expect(screen.getByText('Meg selv')).toBeInTheDocument();
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

  it('scrolls to the group, not the wizard’s top, when the link starts on «who»', async () => {
    stubApi();
    location.search = '?kategori=annet';
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const user = userEvent.setup();
    render(wizard({ components: CARDS, seed: { services: [KIDS, ADULT_CUT], fromTs: NOW } }));
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    // One scroll for the move, and it is to the group.
    expect(scroll.mock.contexts).toEqual([document.getElementById('booking-services-annet')]);
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

describe('config.priceFormat outside the wizard', () => {
  it('reaches every price the kit writes: manage page, Min side, calendar text', () => {
    const config = resolveBookingConfig({ ...PARITY_CONFIG, priceFormat: 'dash' });
    const kit = createBookingKit(config, mergeLabels(config.locale));
    // The manage page's calendar file and Min side read `kit.money`; the
    // screens and the wizard's calendar entries read `kit.format.price`; the
    // summary bar reads the machine's own money, built from the same config.
    expect(kit.money.formatMinor(49_000)).toBe('490,-');
    expect(kit.format.price(186_000)).toBe('1\u00A0860,-');
    expect(kit.config.priceFormat).toBe('dash');
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
