/**
 * The wizard's package surface — the override ladder (`classNames`,
 * `components`), the monitoring tap, the calendar file's absolute links, the
 * login offer's switches — and the corners of `useBooking()` the moved suite
 * never reached. New with the package; the moved suites are next door.
 */

import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ search: '' as string | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => (location.search === null ? null : new URLSearchParams(location.search)),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { createAttemptStore } from '../../../src/core/attempt-store';
import { resolveBookingConfig } from '../../../src/core/config';
import { createDraftStore } from '../../../src/core/draft-store';
import { createRebookStore } from '../../../src/core/rebook-store';
import type {
  BookingDayDto,
  BookingGuardian,
  BookingServiceDto,
  BookingSlotDto,
} from '../../../src/core/types';
import { BookingWizard, type BookingWizardProps } from '../../../src/react/BookingWizard';
import { BookingProvider } from '../../../src/react/Provider';
import {
  confirmationLines,
  isCompleteConfirmation,
  useBooking,
} from '../../../src/react/useBooking';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';
import { textNodesOf } from '../../support/text-nodes';
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
const NAMELESS = { ...BJARNE, id: 'res-x', name: '', sortOrder: 3 };
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

const NS = PARITY_CONFIG.storageNamespace;
const attempts = createAttemptStore(NS);
const drafts = createDraftStore(NS);
const rebook = createRebookStore(NS);

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

const SUBMITTED = (names: Array<string | undefined>) => ({
  items: names.map((name) => ({ service: KIDS, ...(name ? { bookedForName: name } : {}) })),
  startTs: osloTs(2, 13),
  partyMode: 'sequential' as const,
  resourceIds: names.map(() => BJARNE.id),
  stylistNames: names.map(() => 'Bjarne'),
});

describe('BookingWizard — the override ladder', () => {
  it('hands each card renderer to the screen that draws it', async () => {
    stubApi();
    const user = userEvent.setup();
    const { unmount } = render(
      wizard({
        guardian: GUARDIAN,
        components: { PersonCard: ({ name }) => <p>person:{name}</p> },
      })
    );
    expect(screen.getByText('person:Theo')).toBeInTheDocument();
    unmount();

    location.search = '?kategori=barn';
    render(
      wizard({
        components: {
          ServiceCard: ({ service, onPick }) => (
            <button type="button" onClick={onPick}>
              card:{service.name}
            </button>
          ),
          StylistCard: ({ option, onClick }) => (
            <button type="button" onClick={onClick}>
              stylist:{option.name}
            </button>
          ),
          TimeChip: ({ label, onPick }) => (
            <button type="button" onClick={onPick}>
              chip:{label}
            </button>
          ),
        },
      })
    );
    await user.click(screen.getByRole('button', { name: 'card:Barneklipp' }));
    expect(await screen.findByRole('button', { name: 'stylist:Bjarne' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'chip:13:00' }));
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
  });

  it('draws the family chips and the party lines with the site’s renderers', async () => {
    stubApi();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [{ serviceId: KIDS.id, bookedForName: null, bookedForBirthYear: null }],
      resourceId: null,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: BJARNE.id,
      partyResourceIds: null,
    });
    const { unmount } = render(
      wizard({
        guardian: GUARDIAN,
        components: { FamilyChip: ({ member }) => <span>chip:{member.name}</span> },
      })
    );
    expect(await screen.findByText('chip:Theo')).toBeInTheDocument();
    unmount();

    location.search = '';
    attempts.rememberConfirmed(attempts.readAttempt(), {
      bookings: [
        { id: 'bk-1', manageHref: '/bestill/administrer/t1' },
        { id: 'bk-2', manageHref: null },
      ],
      submitted: SUBMITTED(['Theo', 'Mia']),
    });
    render(wizard({ components: { PartyLine: ({ text }) => <li>line:{text}</li> } }));
    expect(await screen.findAllByText(/^line:/)).toHaveLength(2);
  });

  it('lands the wizard’s own slot classes on the root and the banner', async () => {
    // A replay whose answer is still unknown keeps the visitor on step 1 with the banner.
    stubApi({ create: { status: 502, body: { error: 'upstreamError' } } });
    attempts.rememberPending(attempts.readAttempt(), {
      submission: {
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      },
      submitted: SUBMITTED(['Theo']),
    });
    const { container } = render(
      wizard({ classNames: { wizard: { root: 'site-root', alert: 'site-alert' } } })
    );
    expect(container.querySelector('#booking-wizard')).toHaveClass('site-root');
    expect(await screen.findByRole('alert')).toHaveClass('site-alert');
  });
});

describe('BookingWizard — the package props', () => {
  it('reports the steps the visitor reaches and what the submission came to', async () => {
    stubApi({ create: { status: 409, body: { error: 'conflict' } } });
    const onEvent = vi.fn();
    const user = userEvent.setup();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [{ serviceId: KIDS.id, bookedForName: 'Theo', bookedForBirthYear: 2019 }],
      resourceId: null,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: BJARNE.id,
      partyResourceIds: null,
    });
    render(wizard({ onEvent, guardian: GUARDIAN }));
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({ type: 'submit_error', code: 'conflict' })
    );
    expect(onEvent).toHaveBeenCalledWith({ type: 'step', step: 'details' });
  });

  it('reports a confirmed booking', async () => {
    stubApi();
    const onEvent = vi.fn();
    attempts.rememberConfirmed(attempts.readAttempt(), {
      bookings: [{ id: 'bk-1', manageHref: '/bestill/administrer/t1' }],
      submitted: SUBMITTED(['Theo']),
    });
    render(wizard({ onEvent }));
    await screen.findByRole('heading', { name: /Timen er bekreftet/ });
    expect(onEvent).toHaveBeenCalledWith({ type: 'submit_ok', bookings: 1 });
  });

  it('gives each line’s calendar entry its own booking id as the UID', async () => {
    stubApi();
    attempts.rememberConfirmed(attempts.readAttempt(), {
      bookings: [
        { id: 'bk-theo', manageHref: null },
        { id: 'bk-mia', manageHref: null },
      ],
      submitted: SUBMITTED(['Theo', 'Mia']),
    });
    render(wizard());
    const link = await screen.findByRole('link', { name: 'Legg til i kalender' });
    const ics = decodeURIComponent(link.getAttribute('href') ?? '').replace(/\r\n /g, '');
    expect(ics.match(/^UID:.*$/gm)?.map((uid) => uid.split('@')[0])).toEqual([
      'UID:bk-theo',
      'UID:bk-mia',
    ]);
  });

  it('writes the manage link into the calendar file absolute, with the address', async () => {
    stubApi();
    attempts.rememberConfirmed(attempts.readAttempt(), {
      bookings: [{ id: 'bk-1', manageHref: '/bestill/administrer/t1' }],
      submitted: SUBMITTED([undefined]),
    });
    render(wizard({ siteUrl: 'https://example.test' }));
    const link = await screen.findByRole('link', { name: 'Legg til i kalender' });
    // Unfolded: long content lines are folded at 75 octets.
    const ics = decodeURIComponent(link.getAttribute('href') ?? '').replace(/\r\n /g, '');
    expect(ics).toContain('https://example.test/bestill/administrer/t1');
    expect(ics).toContain('LOCATION:');
    expect(ics).toContain('SUMMARY:Barneklipp hos Salong Demo');
  });

  it('offers no login without the actions, or with the portal off', () => {
    stubApi();
    const { unmount } = render(wizard({ actions: undefined }));
    expect(screen.queryByRole('button', { name: 'Logg inn' })).toBeNull();
    unmount();
    const off = resolveBookingConfig({
      ...PARITY_CONFIG,
      portal: { ...PARITY_CONFIG.portal, enabled: false },
    });
    render(wizard({ config: off }));
    expect(screen.queryByRole('button', { name: 'Logg inn' })).toBeNull();
  });

  it('takes its config from a provider', () => {
    stubApi();
    render(
      <BookingProvider config={PARITY_CONFIG} labels={TEST_LABELS}>
        <BookingWizard seed={{ services: [KIDS], fromTs: NOW }} />
      </BookingProvider>
    );
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('says «call us» unlinked when the openings fail and there is no number', async () => {
    stubApi({ availability: { status: 500, body: {} } });
    const user = userEvent.setup();
    const noPhone = resolveBookingConfig({
      ...PARITY_CONFIG,
      contact: { ...PARITY_CONFIG.contact, phone: null },
    });
    location.search = '?kategori=barn';
    render(wizard({ config: noPhone }));
    await user.click(screen.getByRole('button', { name: /Barneklipp/ }));
    const alert = await screen.findByText(/Vi får ikke hentet ledige tider/);
    expect(alert.textContent).toContain('ring oss, så finner vi en tid.');
    expect(within(alert).queryByRole('link')).toBeNull();
  });

  it('renders a package label the site writes as a string as ONE text node', async () => {
    stubApi({ availability: { status: 500, body: {} } });
    const user = userEvent.setup();
    location.search = '?kategori=barn';
    render(
      wizard({
        contact: { phone: '99 88 77 66' },
        labels: {
          ...TEST_LABELS,
          'wizard.progress': 'Steg {step} av {total} · {label}',
          'wizard.slotsUnavailable.call': 'ring oss på {phone}',
        },
      })
    );
    const progress = screen.getByText(/^Steg \d av \d · /);
    expect(textNodesOf(progress)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Barneklipp/ }));
    const call = await screen.findByRole('link', { name: 'Ring oss på 99 88 77 66' });
    expect(textNodesOf(call)).toEqual(['ring oss på 99 88 77 66']);
  });

  it('takes this request’s contact over the config’s', async () => {
    stubApi({ availability: { status: 500, body: {} } });
    const user = userEvent.setup();
    location.search = '?kategori=barn';
    const { rerender } = render(wizard({ contact: { phone: '99 88 77 66' } }));
    await user.click(screen.getByRole('button', { name: /Barneklipp/ }));
    expect(
      await screen.findByRole('link', { name: 'Ring oss på 99 88 77 66' })
    ).toBeInTheDocument();
    rerender(wizard({ contact: { phone: '99 88 77 66' } }));
    expect(screen.getByRole('link', { name: 'Ring oss på 99 88 77 66' })).toBeInTheDocument();
  });

  it('lets a family switch to «at the same time» on the stylist step', async () => {
    stubApi();
    const user = userEvent.setup();
    location.search = '?antall=2';
    render(wizard());
    for (const list of ['Tjenester for Barn 1', 'Tjenester for Barn 2']) {
      await user.click(
        within(await screen.findByRole('list', { name: list })).getByRole('button', {
          name: /Barneklipp/,
        })
      );
    }
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    const parallel = await screen.findByRole('button', { name: /samtidig/i });
    await user.click(parallel);
    expect(parallel).toHaveAttribute('aria-pressed', 'true');
  });

  it('spells the party size from the pack for {sizeWord}', async () => {
    stubApi();
    const user = userEvent.setup();
    location.search = '?antall=2';
    render(
      wizard({
        labels: {
          ...TEST_LABELS,
          'stylist.party.parallel.two': 'Alle {sizeWord} samtidig',
          'stylist.party.parallelNote.two': 'Vi finner {sizeWord} ledige på én gang.',
        },
      })
    );
    for (const list of ['Tjenester for Barn 1', 'Tjenester for Barn 2']) {
      await user.click(
        within(await screen.findByRole('list', { name: list })).getByRole('button', {
          name: /Barneklipp/,
        })
      );
    }
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await user.click(await screen.findByRole('button', { name: /Alle to samtidig/ }));
    expect(screen.getByText('Vi finner to ledige på én gang.')).toBeInTheDocument();
  });

  it('names a parent who logged in with no name by their e-mail', async () => {
    stubApi({
      verify: {
        status: 200,
        body: { ok: true, guardian: { ...GUARDIAN, firstName: null, family: [] } },
      },
    });
    const user = userEvent.setup();
    // On the form, where the row stays once the parent is known.
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [{ serviceId: KIDS.id, bookedForName: null, bookedForBirthYear: null }],
      resourceId: null,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: BJARNE.id,
      partyResourceIds: null,
    });
    render(wizard());
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Logg inn' });
    await user.type(within(dialog).getByLabelText('E-post'), 'kari@example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send kode' }));
    await user.click(await screen.findByLabelText('Engangskode'));
    await user.paste('492155');
    expect(await screen.findByText('Du er logget inn som kari@example.test.')).toBeInTheDocument();
  });

  it('moves on without scrolling where the browser cannot scroll an element', async () => {
    stubApi();
    const user = userEvent.setup();
    const scroll = HTMLElement.prototype.scrollIntoView;
    // @ts-expect-error -- a browser without it
    delete HTMLElement.prototype.scrollIntoView;
    try {
      render(wizard());
      await user.click(screen.getByRole('radio', { name: '1 barn' }));
      expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toHaveFocus();
    } finally {
      HTMLElement.prototype.scrollIntoView = scroll;
    }
  });

  it('runs its mount restore once under StrictMode', async () => {
    stubApi();
    attempts.rememberConfirmed(attempts.readAttempt(), {
      bookings: [{ id: 'bk-1', manageHref: null }],
      submitted: SUBMITTED(['Theo']),
    });
    render(<StrictMode>{wizard()}</StrictMode>);
    expect(await screen.findByRole('heading', { name: /Timen er bekreftet/ })).toBeInTheDocument();
  });
});

describe('useBooking — the corners', () => {
  const options = (extra: Partial<Parameters<typeof useBooking>[0]> = {}) => ({
    config: PARITY_CONFIG,
    labels: TEST_LABELS,
    seed: { services: [KIDS, SMALL, PHONE_ONLY], resources: [BJARNE, OLA, NAMELESS], fromTs: NOW },
    ...extra,
  });

  it('zips each line to its OWN booking, and leaves out a line the answer has none for', () => {
    const lines = confirmationLines({
      bookings: [{ id: 'bk-1', manageHref: '/m/1' }],
      submitted: { ...SUBMITTED(['Theo', 'Mia']), stylistNames: [] },
    });
    expect(lines.map((line) => [line.bookingId, line.manageHref, line.stylistName])).toEqual([
      ['bk-1', '/m/1', null],
    ]);
    expect(confirmationLines({ bookings: [], submitted: SUBMITTED(['Theo']) })).toEqual([]);
  });

  it.each([
    ['one per line', [{ id: 'a' }, { id: 'b' }], 2, true],
    ['none', [], 2, false],
    ['none for no lines', [], 0, false],
    ['fewer', [{ id: 'a' }], 2, false],
    ['more', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, false],
    ['an empty id', [{ id: 'a' }, { id: '' }], 2, false],
    ['an id that is not a string', [{ id: 'a' }, { id: 7 }], 2, false],
    ['a null entry', [{ id: 'a' }, null], 2, false],
    ['one id on two lines', [{ id: 'a' }, { id: 'a' }], 2, false],
    ['no array', null, 1, false],
  ])('reads %s as a whole answer: %s', (_name, bookings, count, whole) => {
    expect(isCompleteConfirmation(bookings as never, count as number)).toBe(whole);
  });

  it('refuses a 201 one booking short of the basket, and keeps the attempt pending', async () => {
    stubApi({ create: { status: 201, body: { bookings: [{ id: 'bk-1', manageToken: 't1' }] } } });
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [
        { serviceId: KIDS.id, bookedForName: 'Theo', bookedForBirthYear: 2019, adult: false },
        { serviceId: KIDS.id, bookedForName: 'Mia', bookedForBirthYear: 2023, adult: false },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: BJARNE.id,
      partyResourceIds: null,
    });
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.state.items).toHaveLength(2));
    await act(() =>
      result.current.submit({
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      })
    );
    expect(result.current.state.error).toBe('upstreamError');
    expect(result.current.confirmed).toBeNull();
    expect(attempts.readAttempt().pending).toBeDefined();
    expect(attempts.readAttempt().confirmed).toBeUndefined();
  });

  it('forgets a remembered confirmation that is not one booking per line', async () => {
    stubApi();
    attempts.rememberConfirmed(attempts.readAttempt(), {
      bookings: [{ id: 'bk-1', manageHref: null }],
      submitted: SUBMITTED(['Theo', 'Mia']),
    });
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.confirmed).toBeNull();
    expect(attempts.readAttempt().confirmed).toBeUndefined();
  });

  it('reads no link when there is no router to ask', () => {
    stubApi();
    location.search = null;
    const { result } = renderHook(() => useBooking(options()));
    expect(result.current.state.step).toBe('who');
    expect(result.current.restore.linked).toBe(false);
  });

  it('pins its window to now when the seed has none', () => {
    stubApi();
    const { result } = renderHook(() => useBooking(options({ seed: { services: [KIDS] } })));
    expect(result.current.slots.fromTs).toBe(NOW);
  });

  it('keeps a stylist-only link for the first tap', async () => {
    stubApi();
    location.search = '?stylist=res-o';
    const { result } = renderHook(() => useBooking(options()));
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    await waitFor(() => expect(result.current.state.step).toBe('when'));
    expect(result.current.catalogue.resolveStylistName(NAMELESS.id)).toBeNull();
  });

  it.each([
    ['conflict', 'conflict'],
    ['invalidInput', 'invalidInput'],
    ['unconfigured', 'unconfigured'],
    ['inProgress', 'inProgress'],
    ['somethingElse', 'upstreamError'],
  ])('reads a refused submission (%s) as %s', async (code, error) => {
    stubApi({ create: { status: 409, body: { error: code } } });
    const { result } = renderHook(() => useBooking(options()));
    await act(() =>
      result.current.submit({
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      })
    );
    expect(result.current.state.error).toBe(error);
  });

  it('treats a body that is not JSON as an outage', async () => {
    stubApi({
      create: { status: 201, body: undefined },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => Promise.reject(new Error('x')),
      }))
    );
    const { result } = renderHook(() => useBooking(options()));
    await act(() =>
      result.current.submit({
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      })
    );
    expect(result.current.state.error).toBe('upstreamError');
  });

  it('evicts the lost service and keeps «next available» unseeded without a stylist list', async () => {
    stubApi({ create: { status: 409, body: { error: 'slotTaken', freshSlots: { x: 'no' } } } });
    const { result } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS], fromTs: NOW, slots: { [KIDS.id]: [] } } }))
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    act(() => result.current.pickSlot(slot(2, 13, BJARNE.id)));
    await act(() =>
      result.current.submit({
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      })
    );
    expect(result.current.slots.takenSlotTs).toBe(osloTs(2, 13));
  });

  it('says why a child could not be added, in the site’s words or the backend’s', async () => {
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    const child = { name: 'Ella', birthYear: 2020, birthMonth: 5 };
    stubApi({ persons: { status: 400, body: { ok: false, reason: 'throttled' } } });
    expect(await result.current.people.addChild(child)).toEqual({
      ok: false,
      message: TEST_LABELS['wizard.addChild.throttled'],
    });
    stubApi({ persons: { status: 400, body: { ok: false, message: 'Nei.' } } });
    expect(await result.current.people.addChild(child)).toEqual({ ok: false, message: 'Nei.' });
    stubApi({ persons: { status: 400, body: { ok: false, reason: 'odd' } } });
    expect(await result.current.people.addChild(child)).toEqual({
      ok: false,
      message: TEST_LABELS['wizard.addChild.unreachable'],
    });
    stubApi({ persons: () => Promise.reject(new Error('offline')) });
    expect(await result.current.people.addChild(child)).toEqual({
      ok: false,
      message: TEST_LABELS['wizard.addChild.unreachable'],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => Promise.reject(new Error()) }))
    );
    expect(await result.current.people.addChild(child)).toEqual({
      ok: false,
      message: TEST_LABELS['wizard.addChild.unreachable'],
    });
  });

  it('keeps a guest’s named children to the party limit, with their birth month', async () => {
    stubApi();
    const { result } = renderHook(() => useBooking(options()));
    for (const name of ['A', 'B', 'C']) {
      await act(async () => {
        await result.current.people.addChild({ name, birthYear: 2020, birthMonth: 3 });
      });
    }
    expect(result.current.state.people.map((person) => person.birthMonth)).toEqual([3, 3, 3]);
    expect(await result.current.people.addChild({ name: 'D', birthYear: 2020 })).toEqual({
      ok: false,
      message: 'Vi tar opptil tre i samme booking.',
    });
  });

  it('suggests nothing for a last visit that is not bookable, or that has no grown-up size', () => {
    stubApi();
    const family = [
      {
        name: 'Theo',
        birthYear: 2015,
        personId: 'p1',
        lastVisit: { serviceId: SMALL.id, serviceName: null, resourceId: null, startTs: NOW },
      },
      {
        name: 'Mia',
        birthYear: 2020,
        personId: 'p2',
        lastVisit: { serviceId: PHONE_ONLY.id, serviceName: null, resourceId: null, startTs: NOW },
      },
    ];
    const { result } = renderHook(() =>
      useBooking(
        options({
          guardian: { ...GUARDIAN, family },
          seed: { services: [SMALL, PHONE_ONLY], fromTs: NOW },
        })
      )
    );
    const { suggestionFor } = result.current.people;
    expect(
      suggestionFor({ key: 'p:p1', name: 'Theo', birthYear: 2015, personId: 'p1' })
    ).toBeNull();
    expect(suggestionFor({ key: 'p:p2', name: 'Mia', birthYear: 2020, personId: 'p2' })).toBeNull();
  });

  it('says «your child» in the outgrown note for a child with no name', () => {
    stubApi();
    const grownUp: BookingServiceDto = {
      ...KIDS,
      id: 'svc-big',
      name: 'Storeklipp',
      ageMinYears: 5,
    };
    const family = [
      {
        name: 'Theo',
        birthYear: 2015,
        personId: 'p1',
        lastVisit: { serviceId: SMALL.id, serviceName: null, resourceId: null, startTs: NOW },
      },
    ];
    const { result } = renderHook(() =>
      useBooking(
        options({
          guardian: { ...GUARDIAN, family },
          seed: { services: [SMALL, grownUp], fromTs: NOW },
        })
      )
    );
    const note = result.current.people.suggestionFor({
      key: 'p:p1',
      birthYear: 2015,
      personId: 'p1',
    })?.note;
    expect(note).toContain(TEST_LABELS['wizard.suggestion.someone']);
  });

  it('rebuilds a whole family draft: two lines, the names, side by side', async () => {
    stubApi();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [
        { serviceId: KIDS.id, bookedForName: 'Theo', bookedForBirthYear: 2019, adult: false },
        { serviceId: SMALL.id, bookedForName: 'Mia', bookedForBirthYear: 2023, adult: false },
      ],
      resourceId: null,
      partyMode: 'parallel',
      startTs: osloTs(2, 13),
      resolvedResourceId: null,
      partyResourceIds: [BJARNE.id, OLA.id],
    });
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.state.step).toBe('details'));
    expect(result.current.state.partyMode).toBe('parallel');
    expect(result.current.state.items.map((item) => item.bookedForName)).toEqual(['Theo', 'Mia']);
    expect(result.current.state.partyResourceIds).toEqual([BJARNE.id, OLA.id]);
  });

  const familyDraft = (items: Array<Record<string, unknown>>) =>
    drafts.stashDraft({
      items: items.map((item) => ({
        serviceId: KIDS.id,
        bookedForName: null,
        bookedForBirthYear: null,
        adult: false,
        ...item,
      })),
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });

  it('keeps the saved child’s person id in the draft it writes', async () => {
    stubApi();
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    act(() =>
      result.current.people.choosePeople(
        [{ key: 'p:p-theo', name: 'Theo', birthYear: 2019, personId: 'p-theo' }],
        true
      )
    );
    act(() => result.current.pickService(KIDS));
    await waitFor(() => expect(result.current.state.step).toBe('when'));
    const stored = JSON.parse(String(window.sessionStorage.getItem(drafts.DRAFT_STORAGE_KEY)));
    expect(stored.items).toEqual([
      expect.objectContaining({ serviceId: KIDS.id, bookedForName: 'Theo', personId: 'p-theo' }),
    ]);
  });

  it('reseats a parent’s own child from the draft by person id', async () => {
    stubApi();
    location.search = '?resume=1';
    familyDraft([
      { bookedForName: 'Theo', bookedForBirthYear: 2019, personId: 'p-theo' },
      { serviceId: SMALL.id, bookedForName: 'Mia', bookedForBirthYear: 2023 },
    ]);
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    const { people, items } = result.current.state;
    expect(people.map((person) => person.key)).toEqual(['p:p-theo', 'guest:2']);
    expect(
      items.map((item) => [item.service.id, item.bookedForPersonId, item.bookedForName])
    ).toEqual([
      [KIDS.id, 'p-theo', 'Theo'],
      [SMALL.id, undefined, 'Mia'],
    ]);
    expect(result.current.state.step).toBe('when');
  });

  describe('chairs an account change leaves', () => {
    const OTHER: BookingGuardian = {
      ...GUARDIAN,
      email: 'other@example.test',
      family: [{ name: 'Per', birthYear: 2017, personId: 'p-per' }],
    };
    const storedItems = () =>
      JSON.parse(String(window.sessionStorage.getItem(drafts.DRAFT_STORAGE_KEY))).items;

    /** A signed-out resume of a saved child's line: its chair waits for a parent. */
    async function waitingChair() {
      stubApi();
      location.search = '?resume=1';
      familyDraft([{ personId: 'p-theo' }]);
      const hook = renderHook(() => useBooking(options()));
      await waitFor(() => expect(hook.result.current.state.items).toHaveLength(1));
      expect(hook.result.current.state.people[0].key).toBe('guest:1');
      return hook;
    }

    it('waits through a login with no readable profile for the next one', async () => {
      const { result } = await waitingChair();
      act(() => result.current.login.signIn(null));
      expect(result.current.state.people[0].key).toBe('guest:1');
      await waitFor(() => expect(storedItems()[0]).toMatchObject({ personId: 'p-theo' }));

      act(() => result.current.login.signIn(GUARDIAN));
      expect(result.current.state.people[0]).toMatchObject({ key: 'p:p-theo', name: 'Theo' });
      expect(result.current.state.items[0]).toMatchObject({ bookedForPersonId: 'p-theo' });
    });

    it('forgets a waiting chair on «Book again»: a later guest’s chair is nobody’s', async () => {
      const { result } = await waitingChair();
      act(() => result.current.startOver());
      act(() => result.current.people.choosePeople([{ key: 'guest:1' }], true));
      act(() => result.current.pickService(KIDS));
      await waitFor(() => expect(result.current.state.step).toBe('when'));
      expect(storedItems()[0]).toMatchObject({ personId: null });

      act(() => result.current.login.signIn(GUARDIAN));
      expect(result.current.state.people.map((person) => person.key)).not.toContain('p:p-theo');
    });

    it('forgets a waiting chair step 1 replaced, not one it passed through', async () => {
      const { result } = await waitingChair();
      const chair = result.current.state.people[0];
      act(() => result.current.people.choosePeople([chair], false));
      await waitFor(() => expect(storedItems()[0]).toMatchObject({ personId: 'p-theo' }));
      act(() => result.current.people.choosePeople([{ key: 'guest:1' }], true));
      act(() => result.current.pickService(KIDS));
      await waitFor(() => expect(storedItems()[0]).toMatchObject({ personId: null }));
    });

    it('keeps a switched chair only while step 1 passes it through as it is', async () => {
      stubApi();
      const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
      const theo = { key: 'p:p-theo', name: 'Theo', birthYear: 2019, personId: 'p-theo' };
      act(() => result.current.people.choosePeople([theo], true));
      act(() => result.current.dispatch({ type: 'toggleServiceFor', index: 0, service: KIDS }));
      act(() => result.current.login.signIn(OTHER));
      const chair = result.current.state.people[0];
      expect(chair.key).toBe('guest:1');

      // Passed through untouched (a family child added beside it): still kept.
      const per = { key: 'p:p-per', name: 'Per', birthYear: 2017, personId: 'p-per' };
      act(() => result.current.people.choosePeople([chair, per], false));
      await waitFor(() => expect(result.current.state.people).toHaveLength(2));
      act(() => result.current.dispatch({ type: 'goToStep', step: 'service' }));
      expect(result.current.state.people.map((person) => person.key)).toEqual([
        'guest:1',
        'p:p-per',
      ]);
      expect(result.current.state.choices[0]).toMatchObject({ id: KIDS.id });

      // Replaced by a new chair under the same key: a guest seat like any other.
      act(() => result.current.people.choosePeople([{ key: 'guest:1' }, per], false));
      await waitFor(() =>
        expect(result.current.state.people.map((person) => person.key)).toEqual(['p:p-per'])
      );
    });
  });

  it('never reseats a person id the parent’s family does not have', async () => {
    stubApi();
    location.search = '?resume=1';
    familyDraft([{ bookedForName: 'Theo', bookedForBirthYear: 2019, personId: 'p-stranger' }]);
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.people.map((person) => person.key)).toEqual(['guest:1']);
    expect(result.current.state.items).toEqual([
      {
        service: expect.objectContaining({ id: KIDS.id }),
        bookedForName: 'Theo',
        bookedForBirthYear: 2019,
      },
    ]);
  });

  it('seats one child once when two lines name the same id', async () => {
    stubApi();
    location.search = '?resume=1';
    familyDraft([
      { bookedForName: 'Theo', personId: 'p-theo' },
      { bookedForName: 'Theo', personId: 'p-theo' },
    ]);
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.people.map((person) => person.key)).toEqual([
      'p:p-theo',
      'guest:2',
    ]);
    expect(result.current.state.items.map((item) => item.bookedForPersonId)).toEqual([
      'p-theo',
      undefined,
    ]);
  });

  it('restores a draft written before person ids exactly as before', async () => {
    stubApi();
    location.search = '?resume=1';
    const legacy = {
      items: [
        { serviceId: KIDS.id, bookedForName: 'Theo', bookedForBirthYear: 2019, adult: false },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
      savedAt: NOW,
    };
    window.sessionStorage.setItem(drafts.DRAFT_STORAGE_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.people).toEqual([
      { key: 'guest:1', name: 'Theo', birthYear: 2019 },
    ]);
    expect(result.current.state.items).toEqual([
      {
        service: expect.objectContaining({ id: KIDS.id }),
        bookedForName: 'Theo',
        bookedForBirthYear: 2019,
      },
    ]);
  });

  it('rebuilds a grown-up guest’s draft as the grown-up, first available', async () => {
    stubApi();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [{ serviceId: KIDS.id, bookedForName: null, bookedForBirthYear: null, adult: true }],
      resourceId: null,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.state.step).toBe('details'));
    expect(result.current.state.people).toEqual([{ key: 'adult', adult: true }]);
    expect(result.current.state.resolvedResourceId).toBeNull();
  });

  it('comes back from Vipps with nothing to rebuild', async () => {
    stubApi();
    location.search = '?resume=1';
    const { result } = renderHook(() => useBooking(options()));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.step).toBe('who');
  });

  it('seats a known parent’s child a «book again» name names, holding no service', async () => {
    stubApi();
    rebook.stashRebookWho('Theo');
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.state.people[0]?.name).toBe('Theo'));
    expect(result.current.state.items).toEqual([]);
  });

  it('puts a known parent’s «book again» link back after a refused replay', async () => {
    stubApi({ create: { status: 409, body: { error: 'conflict' } } });
    location.search = `?service=${KIDS.id}&stylist=${OLA.id}`;
    attempts.rememberPending(attempts.readAttempt(), {
      submission: {
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      },
      submitted: SUBMITTED(['Theo']),
    });
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.pendingService?.id).toBe(KIDS.id);
    expect(result.current.state.step).toBe('who');
  });

  it('puts back a stylist-less link after a refused replay', async () => {
    stubApi({ create: { status: 409, body: { error: 'conflict' } } });
    location.search = `?service=${KIDS.id}`;
    attempts.rememberPending(attempts.readAttempt(), {
      submission: {
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      },
      submitted: SUBMITTED(['Theo']),
    });
    const { result } = renderHook(() => useBooking(options({ guardian: GUARDIAN })));
    await waitFor(() => expect(result.current.restore.restoring).toBe(false));
    expect(result.current.state.pendingService?.id).toBe(KIDS.id);
  });

  it('fills only what the profile has: no phone, no name', async () => {
    stubApi();
    const { result } = renderHook(() =>
      useBooking(options({ guardian: { ...GUARDIAN, firstName: null, phone: null, family: [] } }))
    );
    await waitFor(() => expect(result.current.state.contact.email).toBe('kari@example.test'));
    expect(result.current.state.contact).toMatchObject({ name: '', phone: '' });
  });

  it('reads empty answers as empty, and keeps «next» on the last step', async () => {
    stubApi({
      resources: { status: 200, body: {} },
      availability: { status: 200, body: {} },
      schedule: { status: 200, body: {} },
    });
    const { result } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS], fromTs: NOW } }))
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    await waitFor(() => expect(result.current.slots.ready).toBe(true));
    expect(result.current.catalogue.resources).toEqual([]);
    expect(result.current.slots.single).toEqual([]);
    act(() => result.current.dispatch({ type: 'goToStep', step: 'details' }));
    act(() => result.current.next());
  });

  it('drops a «book again» stylist once the visitor picks another service', async () => {
    stubApi();
    location.search = `?service=${KIDS.id}&stylist=${OLA.id}`;
    const { result } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS, SMALL], fromTs: NOW } }))
    );
    act(() => result.current.pickService(SMALL));
    await waitFor(() => expect(result.current.catalogue.resourcesKnown).toBe(true));
    expect(result.current.state.resourceId).toBeNull();
  });

  it('cuts a visit’s tail off a holiday’s hours, which stay shut', async () => {
    stubApi({
      schedule: {
        status: 200,
        body: { days: [{ ...OPEN_WEEK[0], lastStartTs: null }, OPEN_WEEK[1]] },
      },
    });
    const { result } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS], fromTs: NOW } }))
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }, { key: 'g2' }], true));
    act(() => result.current.pickServiceFor(0, KIDS));
    act(() => result.current.pickServiceFor(1, KIDS));
    await waitFor(() => expect(result.current.schedule.openDays).not.toBeNull());
    expect(result.current.schedule.openDays?.[0].lastStartTs).toBeNull();
    expect(result.current.schedule.openDays?.[1].lastStartTs).toBe(osloTs(3, 16));
  });

  it('asks for the chosen stylist’s days, and the salon’s again for first available', async () => {
    const { urls } = stubApi({
      schedule: { status: 200, body: { days: [OPEN_WEEK[3], OPEN_WEEK[4]] } },
    });
    const { result } = renderHook(() =>
      useBooking(
        options({
          seed: {
            services: [KIDS],
            resources: [BJARNE, OLA],
            fromTs: NOW,
            schedules: { [KIDS.id]: OPEN_WEEK },
          },
        })
      )
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    expect(result.current.schedule.openDays).toHaveLength(OPEN_WEEK.length);

    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() =>
      expect(result.current.schedule.openDays?.map((day) => day.dayKey)).toEqual([
        '2026-09-05',
        '2026-09-06',
      ])
    );
    const narrowed = urls
      .filter((url) => url.includes('/api/booking/schedule'))
      .map((url) => new URL(url, 'https://example.test').searchParams.get('resource_id'));
    expect(narrowed).toEqual([BJARNE.id]);

    act(() => result.current.pickResource(null));
    expect(result.current.schedule.openDays).toHaveLength(OPEN_WEEK.length);
  });

  it('treats a failed stylist schedule as unknown hours, not the salon week', async () => {
    stubApi({ schedule: { status: 500, body: {} } });
    const { result } = renderHook(() =>
      useBooking(
        options({
          seed: {
            services: [KIDS],
            resources: [BJARNE, OLA],
            fromTs: NOW,
            schedules: { [KIDS.id]: OPEN_WEEK },
          },
        })
      )
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    expect(result.current.schedule.openDays).toHaveLength(OPEN_WEEK.length);

    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() => expect(result.current.schedule.openDays).toBeNull());
    // Settled, so the time step stays up and can say the hours are unknown.
    expect(result.current.schedule.settled).toBe(true);
  });

  it('does not settle the next stylist off the previous stylist’s failed read', async () => {
    let calls = 0;
    const { urls } = stubApi({
      schedule: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        return new Promise<StubResponse>(() => undefined);
      },
    });
    const { result } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS], resources: [BJARNE, OLA], fromTs: NOW } }))
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    await waitFor(() => expect(result.current.schedule.settled).toBe(true));

    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() =>
      expect(urls.some((url) => url.includes(`resource_id=${BJARNE.id}`))).toBe(true)
    );
    expect(result.current.schedule.settled).toBe(false);
  });

  it('drops a stylist’s earlier days when picking them again fails', async () => {
    let calls = 0;
    stubApi({
      schedule: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ days: [OPEN_WEEK[3]] }),
          });
        }
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      },
    });
    const { result } = renderHook(() =>
      useBooking(
        options({
          seed: {
            services: [KIDS],
            resources: [BJARNE, OLA],
            fromTs: NOW,
            schedules: { [KIDS.id]: OPEN_WEEK },
          },
        })
      )
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() =>
      expect(result.current.schedule.openDays?.map((day) => day.dayKey)).toEqual(['2026-09-05'])
    );

    act(() => result.current.pickResource(null));
    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() => expect(result.current.schedule.openDays).toBeNull());
    expect(result.current.schedule.settled).toBe(true);
  });

  it('does not treat a stylist’s retry as already settled', async () => {
    let calls = 0;
    const { urls } = stubApi({
      schedule: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        return new Promise<StubResponse>(() => undefined);
      },
    });
    const { result } = renderHook(() =>
      useBooking(
        options({
          seed: {
            services: [KIDS],
            resources: [BJARNE, OLA],
            fromTs: NOW,
            schedules: { [KIDS.id]: OPEN_WEEK },
          },
        })
      )
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() => expect(result.current.schedule.openDays).toBeNull());

    act(() => result.current.pickResource(null));
    act(() => result.current.pickResource(BJARNE.id));
    await waitFor(() =>
      expect(urls.filter((url) => url.includes(`resource_id=${BJARNE.id}`))).toHaveLength(2)
    );
    // The retry is in flight. Unknown-and-settled would be the previous failure
    // speaking for a request that has not answered yet.
    expect(result.current.schedule.openDays === null && result.current.schedule.settled).toBe(
      false
    );
  });

  it('forgets a failed read that lands after the visitor moved on', async () => {
    const pending: Array<() => void> = [];
    const fail = () => {
      for (const reject of pending) reject();
    };
    const late = () =>
      new Promise<never>((_, reject) => {
        pending.push(() => reject(new Error('late')));
      });
    stubApi({ availability: late, resources: late, schedule: late });
    const { result, unmount } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS], fromTs: NOW } }))
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    unmount();
    await act(async () => {
      fail();
    });
    expect(result.current.slots.failed).toBe(false);
  });

  it('holds a known parent’s link stylist until a stylist list exists', async () => {
    stubApi({ resources: { status: 200, body: { resources: [] } } });
    location.search = `?service=${KIDS.id}&stylist=${OLA.id}`;
    const { result } = renderHook(() =>
      useBooking(options({ guardian: GUARDIAN, seed: { services: [KIDS], fromTs: NOW } }))
    );
    act(() =>
      result.current.people.choosePeople(
        [{ key: 'p:p-theo', name: 'Theo', birthYear: 2019, personId: 'p-theo' }],
        true
      )
    );
    act(() => result.current.pickServiceFor(0, KIDS));
    act(() => result.current.dispatch({ type: 'goToStep', step: 'when' }));
    await waitFor(() => expect(result.current.catalogue.resourcesKnown).toBe(true));
    expect(result.current.state.resourceId).toBeNull();
  });

  it('names nobody for a stylist whose name is only an admin note', () => {
    stubApi();
    const note = { ...BJARNE, id: 'res-n', name: '   ' };
    const { result } = renderHook(() =>
      useBooking(options({ seed: { services: [KIDS], resources: [note], fromTs: NOW } }))
    );
    expect(result.current.catalogue.resolveStylistName('res-n')).toBeNull();
  });

  it('submits «first available» with no stylist name, and «next» stays put on the last step', async () => {
    const { bodies } = stubApi();
    const { result } = renderHook(() =>
      useBooking(
        options({
          seed: { services: [KIDS], fromTs: NOW, slots: { [KIDS.id]: [] }, resources: [] },
        })
      )
    );
    act(() => result.current.people.choosePeople([{ key: 'g1' }], true));
    act(() => result.current.pickService(KIDS));
    act(() => result.current.pickSlot({ startTs: osloTs(2, 13), resourceId: null }));
    expect(result.current.state.step).toBe('details');
    act(() => result.current.next());
    expect(result.current.state.step).toBe('details');
    await act(() =>
      result.current.submit({
        items: [],
        contact: { phone: '' },
        consentTerms: true,
        consentMarketing: false,
      })
    );
    expect(bodies).toHaveLength(1);
    expect(result.current.confirmed?.submitted.stylistNames).toEqual([null]);
  });
});

describe('BookingWizard — focus after a lost slot', () => {
  it('leaves focus where the visitor put it while the openings were re-read', async () => {
    let release = () => {};
    let calls = 0;
    stubApi({
      create: { status: 409, body: { error: 'slotTaken' } },
      availability: () =>
        new Promise((resolve) => {
          calls += 1;
          const answer = {
            ok: true,
            status: 200,
            json: async () => ({ slots: [slot(2, 14, BJARNE.id)] }),
          };
          if (calls === 1) resolve(answer as never);
          else release = () => resolve(answer as never);
        }) as never,
    });
    const user = userEvent.setup();
    location.search = '?resume=1';
    drafts.stashDraft({
      items: [{ serviceId: KIDS.id, bookedForName: 'Theo', bookedForBirthYear: 2019 }],
      resourceId: null,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: BJARNE.id,
      partyResourceIds: null,
    });
    render(wizard({ guardian: GUARDIAN }));
    await screen.findByRole('heading', { name: 'Nesten ferdig!' });
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });
    const back = await screen.findByRole('button', { name: /Tilbake til/ });
    back.focus();
    await act(async () => release());
    await screen.findByRole('button', { name: /^14:00/ });
    expect(back).toHaveFocus();
  });
});

describe('useBooking — party.askWhoFirst', () => {
  const unasked = (categories?: Parameters<typeof resolveBookingConfig>[0]['categories']) =>
    resolveBookingConfig({
      ...PARITY_CONFIG,
      party: { ...PARITY_CONFIG.party, askWhoFirst: false },
      ...(categories
        ? { categories, fallbackCategory: 'annet', window: { prefetchCategory: null } }
        : {}),
    });

  it('starts a guest on step 2 as one child where the site has a children’s menu', () => {
    stubApi();
    const { result } = renderHook(() =>
      useBooking({
        config: unasked(),
        labels: TEST_LABELS,
        seed: { services: [KIDS], fromTs: NOW },
      })
    );
    expect(result.current.state.step).toBe('service');
    expect(result.current.state.people).toHaveLength(1);
    expect(result.current.state.people[0].adult).toBeUndefined();
  });

  it('starts as one grown-up where it has none, and still asks a known parent', () => {
    stubApi();
    const adults = unasked([{ key: 'annet', audience: 'any' }]);
    const guest = renderHook(() =>
      useBooking({ config: adults, labels: TEST_LABELS, seed: { services: [KIDS], fromTs: NOW } })
    );
    expect(guest.result.current.state.people).toEqual([{ key: 'adult', adult: true }]);
    const parent = renderHook(() =>
      useBooking({
        config: adults,
        labels: TEST_LABELS,
        guardian: GUARDIAN,
        seed: { services: [KIDS], fromTs: NOW },
      })
    );
    expect(parent.result.current.state.step).toBe('who');
  });

  it('lets a link that names a service seat as usual', () => {
    stubApi();
    location.search = `?service=${KIDS.id}`;
    const { result } = renderHook(() =>
      useBooking({
        config: unasked(),
        labels: TEST_LABELS,
        seed: { services: [KIDS], fromTs: NOW },
      })
    );
    expect(result.current.state.items.map((item) => item.service.id)).toEqual([KIDS.id]);
  });
});
