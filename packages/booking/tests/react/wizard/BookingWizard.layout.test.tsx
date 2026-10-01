import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * Layout stability and orientation in the wizard shell: skeletons while things
 * load, scroll and focus on a step change, and the restore gate that stops a
 * refreshed confirmation or a Vipps return from flashing step 1 first.
 */

const location = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** Step 1, counted: the restore gate's promise is that it never renders. */
const serviceStepRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('@medalsocial/meda/booking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@medalsocial/meda/booking')>();
  return {
    ...actual,
    ServiceScreen: (props: Parameters<typeof actual.ServiceScreen>[0]) => {
      serviceStepRenders.count += 1;
      return actual.ServiceScreen(props);
    },
  };
});

import { createAttemptStore } from '../../../src/core/attempt-store';
import { createDraftStore } from '../../../src/core/draft-store';
import type { BookingServiceDto, BookingSlotDto } from '../../../src/core/types';
import { BookingWizard } from '../../support/legacy-wizard';
import { PARITY_CONFIG } from '../../support/parity-config';

const { ATTEMPT_STORAGE_KEY, rememberConfirmed, rememberPending } = createAttemptStore(
  PARITY_CONFIG.storageNamespace
);
const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);

pinAForeignViewerClock();

const pad = (value: number) => String(value).padStart(2, '0');
function osloTs(day: number, hour: number, minute = 0): number {
  return Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`);
}
const NOW = osloTs(2, 8);

const GUTTEKLIPP: BookingServiceDto = {
  id: 'svc-gutt',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
  bookableOnline: true,
};

const SARA = {
  id: 'res-sara',
  name: 'Sara (Salong Demo)',
  photoUrl: null,
  bio: null,
  serviceIds: [GUTTEKLIPP.id],
  sortOrder: 1,
};

const OPEN_WEEK = [2, 3, 4, 5, 6, 7, 8].map((day) => ({
  dayKey: `2026-09-${pad(day)}`,
  opensTs: osloTs(day, 10),
  closesTs: osloTs(day, 17),
  lastStartTs: osloTs(day, 16, 30),
}));

const SLOTS: BookingSlotDto[] = [{ startTs: osloTs(2, 13), resourceId: SARA.id }];

interface Holds {
  resources?: Promise<void>;
  availability?: Promise<void>;
  create?: Promise<void>;
  /** The stylist list the resources route answers with; `[SARA]` by default. */
  resourceList?: unknown[];
}

function stubApi(holds: Holds = {}) {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const { pathname } = new URL(String(input), 'https://example.test');
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (pathname.startsWith('/api/booking/resources')) {
        if (holds.resources) await holds.resources;
        return json({ resources: holds.resourceList ?? [SARA], nextAvailableTs: {} });
      }
      if (pathname.startsWith('/api/booking/availability')) {
        if (holds.availability) await holds.availability;
        return json({ slots: SLOTS });
      }
      if (pathname.startsWith('/api/booking/schedule')) return json({ days: OPEN_WEEK });
      if (pathname.startsWith('/api/booking/create')) {
        if (holds.create) await holds.create;
        return { ok: true, status: 201, json: async () => ({ bookings: [{ id: 'bk_1' }] }) };
      }
      throw new Error(`unexpected fetch: ${pathname}`);
    })
  );
  return { bodies };
}

function held() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function wizard(props: Partial<Parameters<typeof BookingWizard>[0]> = {}) {
  return (
    <BookingWizard
      services={[GUTTEKLIPP]}
      phone="22 33 44 55"
      rangeStart={NOW}
      rangeDays={7}
      {...props}
    />
  );
}

const SUBMITTED = {
  items: [{ service: GUTTEKLIPP, bookedForName: 'Jonas' }],
  startTs: osloTs(2, 13),
  partyMode: 'sequential' as const,
  resourceIds: [SARA.id],
  stylistNames: ['Sara (Salong Demo)'],
};

let scrollIntoView: ReturnType<typeof vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>>;
let reducedMotion = false;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  window.sessionStorage.clear();
  location.search = '';
  serviceStepRenders.count = 0;
  reducedMotion = false;
  scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') && reducedMotion,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BookingWizard — step changes', () => {
  it('leaves focus and scroll alone on first mount', () => {
    stubApi();
    render(wizard());

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).not.toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls the wizard into view and focuses the new step’s heading', async () => {
    stubApi();
    const user = userEvent.setup();
    render(wizard());

    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await user.click(await screen.findByRole('button', { name: /Gutteklipp/ }));

    const heading = await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('jumps rather than glides for a visitor who asked for reduced motion', async () => {
    reducedMotion = true;
    stubApi();
    const user = userEvent.setup();
    render(wizard());

    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await user.click(await screen.findByRole('button', { name: /Gutteklipp/ }));

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    );
  });
});

describe('BookingWizard — loading without moving', () => {
  it('holds stylist placeholders while the list is on its way, and names them cleanly after', async () => {
    const resources = held();
    stubApi({ resources: resources.promise });
    const user = userEvent.setup();
    const { container } = render(wizard());

    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await user.click(await screen.findByRole('button', { name: /Gutteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    expect(container.querySelectorAll('[data-testid="stylist-skeleton"]')).toHaveLength(5);

    await act(async () => resources.release());
    expect(await screen.findByRole('radio', { name: /^Sara/ })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="stylist-skeleton"]')).toBeNull();
    expect(screen.queryByText(/Salong Demo/)).toBeNull();
  });

  /**
   * A saved draft names Sara, and the stylist list is still on its way. The
   * group must not say «nobody chosen», nor put the tab stop on «Første
   * ledige» — the one answer the parent did NOT give.
   */
  function stashSaraDraft() {
    stashDraft({
      items: [{ serviceId: GUTTEKLIPP.id, bookedForName: null, bookedForBirthYear: null }],
      resourceId: SARA.id,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
  }

  it('holds a checked stand-in for a restored stylist until the list lands', async () => {
    const resources = held();
    stubApi({ resources: resources.promise });
    stashSaraDraft();
    const { container } = render(wizard());

    const group = await screen.findByRole('radiogroup', { name: 'Hvem vil du gå til?' });
    expect(group).toHaveAttribute('aria-busy', 'true');
    const standIn = screen.getByRole('radio', { name: 'Valgt frisør' });
    expect(standIn).toHaveAttribute('aria-checked', 'true');
    expect(standIn).toHaveAttribute('tabindex', '0');
    expect(standIn).toHaveClass('h-32', 'md:h-24');
    const first = screen.getByRole('radio', { name: 'Første ledige' });
    expect(first).toHaveAttribute('aria-checked', 'false');
    expect(first).toHaveAttribute('tabindex', '-1');
    // The stand-in takes one placeholder's place: the row is as long as ever.
    expect(container.querySelectorAll('[data-testid="stylist-skeleton"]')).toHaveLength(4);

    await act(async () => resources.release());
    const sara = await screen.findByRole('radio', { name: /^Sara/ });
    expect(sara).toHaveAttribute('aria-checked', 'true');
    expect(sara).toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('radio', { name: 'Valgt frisør' })).toBeNull();
    expect(group).toHaveAttribute('aria-busy', 'false');
  });

  it('falls back to «Første ledige», and says so, when the restored stylist is gone', async () => {
    const resources = held();
    const MARCUS = { ...SARA, id: 'res-marcus', name: 'Marcus', sortOrder: 2 };
    stubApi({ resources: resources.promise, resourceList: [MARCUS] });
    stashSaraDraft();
    render(wizard());

    expect(await screen.findByRole('radio', { name: 'Valgt frisør' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    await act(async () => resources.release());
    await screen.findByRole('radio', { name: /^Marcus/ });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Første ledige' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    );
    expect(screen.queryByRole('radio', { name: 'Valgt frisør' })).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((node) => node.textContent?.includes('Frisøren du valgte er ikke ledig'))
      ).toBe(true)
    );
  });

  it('draws the time step as a skeleton, not a one-line «Henter …», until the openings land', async () => {
    const availability = held();
    stubApi({ availability: availability.promise });
    const user = userEvent.setup();
    const { container } = render(wizard({ initialResources: [SARA] }));

    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await user.click(await screen.findByRole('button', { name: /Gutteklipp/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });
    expect(container.querySelectorAll('[data-testid="day-chip-skeleton"]')).toHaveLength(7);
    expect(container.querySelector('[data-testid="slot-skeleton"]')).not.toBeNull();

    await act(async () => availability.release());
    expect(await screen.findByRole('button', { name: '13:00' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="slot-skeleton"]')).toBeNull();
  });
});

describe('BookingWizard — the restore gate', () => {
  it('opens a refreshed confirmation without ever drawing step 1', async () => {
    stubApi();
    rememberConfirmed(
      { nonce: 'n1' },
      { bookings: [{ id: 'bk_1', manageHref: null }], submitted: SUBMITTED }
    );

    render(wizard());

    expect(
      await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Sara/)).toBeInTheDocument();
    expect(screen.queryByText(/Salong Demo/)).toBeNull();
    expect(serviceStepRenders.count).toBe(0);
  });

  /**
   * A deep link is a parent here to book. An old confirmation this tab still
   * remembers must not swallow it — neither in the gate script (which would
   * hide step 1 behind the skeleton) nor in the mount effect (which would
   * show «Timen er bekreftet» and throw the link away).
   */
  it.each([['?kategori=barn'], [`?tjeneste=${'svc-gutt'}`], ['?frisor=sara'], ['?antall=2']])(
    'lets a fresh deep link (%s) beat a remembered confirmation',
    async (search) => {
      stubApi();
      rememberConfirmed(
        { nonce: 'n1' },
        { bookings: [{ id: 'bk_1', manageHref: null }], submitted: SUBMITTED }
      );
      location.search = search;

      render(wizard());

      expect(screen.queryByTestId('restore-skeleton')).toBeNull();
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeNull()
      );
      expect(screen.queryByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeNull();
      // Forgotten, not merely hidden: a reload must not bring it back either.
      expect(window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY) ?? '').not.toContain('confirmed');
    }
  );

  it('holds the skeleton while a pending attempt is replayed, then shows its answer', async () => {
    const create = held();
    const { bodies } = stubApi({ create: create.promise });
    rememberPending({ nonce: 'n1' }, { submission: { items: [] } as never, submitted: SUBMITTED });

    render(wizard());

    expect(screen.getByTestId('restore-skeleton')).toBeInTheDocument();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(screen.getByTestId('restore-skeleton')).toBeInTheDocument();

    await act(async () => create.release());
    expect(
      await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' })
    ).toBeInTheDocument();
    expect(serviceStepRenders.count).toBe(0);
  });

  it('gives a replay that never answers 15 s, then settles on the ambiguous state', async () => {
    // The gate is bounded: a create request that hangs would otherwise hold
    // the skeleton up for ever. The timeout's signal is taken over so the test
    // can fire it; the fetch honours it the way the browser's does.
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        if (pathname.startsWith('/api/booking/create')) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation timed out.', 'TimeoutError'))
            );
          });
        }
        return { ok: true, status: 200, json: async () => ({}) };
      })
    );
    rememberPending({ nonce: 'n1' }, { submission: { items: [] } as never, submitted: SUBMITTED });

    render(wizard());

    expect(screen.getByTestId('restore-skeleton')).toBeInTheDocument();
    await waitFor(() => expect(timeout).toHaveBeenCalledWith(15_000));
    expect(screen.getByTestId('restore-skeleton')).toBeInTheDocument();

    await act(async () => controller.abort());

    await waitFor(() => expect(screen.queryByTestId('restore-skeleton')).toBeNull());
    // The same «we do not know yet» state an ambiguous replay always lands in,
    // with the attempt kept for the next try.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('demo:booking:attempt')).toContain('pending');
  });

  it('brings a Vipps return back on its own step without step 1 in between', async () => {
    stubApi();
    stashDraft({
      items: [{ serviceId: GUTTEKLIPP.id, bookedForName: null, bookedForBirthYear: null }],
      resourceId: SARA.id,
      partyMode: 'sequential',
      startTs: osloTs(2, 13),
      resolvedResourceId: SARA.id,
      partyResourceIds: null,
    });
    location.search = '?resume=1';

    render(wizard({ initialResources: [SARA] }));

    expect(await screen.findByRole('heading', { name: 'Nesten ferdig!' })).toBeInTheDocument();
    expect(serviceStepRenders.count).toBe(0);
  });

  it('shows step 1 straight away when there is nothing to restore', () => {
    stubApi();
    render(wizard());
    expect(screen.queryByTestId('restore-skeleton')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  /**
   * The server cannot see this tab's storage, so it renders step 1 — and the
   * inline script in that HTML hides it before first paint when there is
   * something to restore. Hydration then has to agree with the server's tree.
   */
  it('hydrates the server’s step 1 without a mismatch, hidden by the inline gate', async () => {
    stubApi();
    const html = renderToString(wizard());
    expect(html).toContain('Hvem skal klippes?');

    rememberConfirmed(
      { nonce: 'n1' },
      { bookings: [{ id: 'bk_1', manageHref: null }], submitted: SUBMITTED }
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    // innerHTML does not run scripts; the browser would, during parsing.
    const script = host.querySelector('script');
    expect(script).not.toBeNull();
    expect(new Function(`return ${script?.textContent ?? ''}`)()).toBe(true);
    const root = host.querySelector('#booking-wizard');
    expect(root).toHaveAttribute('data-restoring');

    const errors = vi.spyOn(console, 'error');
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(host, wizard(), { onRecoverableError: recoverable });
    });

    expect(
      await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' })
    ).toBeInTheDocument();
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector('#booking-wizard')).not.toHaveAttribute('data-restoring');
    expect(host.querySelector('script')).toBeNull();
    host.remove();
  });

  it('leaves the server’s step 1 visible when there is nothing to restore', () => {
    stubApi();
    const host = document.createElement('div');
    host.innerHTML = renderToString(wizard());
    document.body.append(host);
    const script = host.querySelector('script')?.textContent ?? '';
    // The script evaluates to its answer: `false` is «ran, nothing to
    // restore», which a script that threw could never produce.
    expect(new Function(`return ${script}`)()).toBe(false);
    expect(host.querySelector('#booking-wizard')).not.toHaveAttribute('data-restoring');
    host.remove();
  });
});
