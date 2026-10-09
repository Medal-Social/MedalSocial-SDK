import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * `config.screens`: each opt-in screen feature, wired through the wizard —
 * the guest party, «free soon» and day fullness, the two-line bar and its
 * hints, the stylist faces, and the details step's recap with its swap. And
 * that a site that asks for none of them sees none of them.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { resolveBookingConfig } from '../../../src/core/config';
import type { BookingServiceDto, BookingSlotDto } from '../../../src/core/types';
import { BookingWizard } from '../../../src/react/BookingWizard';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

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
  weekendSurchargePct: 0,
  bookableOnline: true,
};
const HERREKLIPP: BookingServiceDto = {
  ...GUTTEKLIPP,
  id: 'svc-herre',
  name: 'Herreklipp',
  category: 'herre',
  priceOre: 57_000,
};

const ADA = {
  id: 'res-ada',
  name: 'Ada Demo',
  photoUrl: '/api/booking/avatar/res-ada',
  bio: null,
  serviceIds: [GUTTEKLIPP.id, HERREKLIPP.id],
  sortOrder: 1,
};
const BO = {
  ...ADA,
  id: 'res-bo',
  name: 'Bo Eksempel',
  photoUrl: '/api/booking/avatar/res-bo',
  sortOrder: 2,
};

/** Ada and Bo are both free at 13:00; only Ada at 14:00. */
const SLOTS: BookingSlotDto[] = [
  { startTs: osloTs(2, 13), resourceId: ADA.id },
  { startTs: osloTs(2, 13), resourceId: BO.id },
  { startTs: osloTs(2, 14), resourceId: ADA.id },
];

const OPEN_WEEK = [2, 3, 4, 5, 6, 7, 8].map((day) => ({
  dayKey: `2026-09-${pad(day)}`,
  opensTs: osloTs(day, 10),
  closesTs: osloTs(day, 17),
  lastStartTs: osloTs(day, 16, 30),
}));

function stubApi() {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const { pathname } = new URL(String(input), 'https://example.test');
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (pathname.startsWith('/api/booking/resources')) {
        return json({ resources: [ADA, BO], nextAvailableTs: {} });
      }
      if (pathname.startsWith('/api/booking/availability')) return json({ slots: SLOTS });
      if (pathname.startsWith('/api/booking/schedule')) return json({ days: OPEN_WEEK });
      if (pathname.startsWith('/api/booking/create')) {
        return { ok: true, status: 201, json: async () => ({ bookings: [{ id: 'bk_1' }] }) };
      }
      throw new Error(`unexpected fetch: ${pathname}`);
    })
  );
  return { bodies };
}

const ALL_ON = {
  recap: true,
  soonest: true,
  dayFullness: true,
  summaryDetail: true,
  hideDisabledNext: true,
  firstAvailableFaces: true,
  stylistEdgeFade: true,
  guestParty: true,
  childMenuFirst: true,
};

function renderWizard(screens: Partial<typeof ALL_ON> | null = ALL_ON) {
  const config = resolveBookingConfig({
    ...PARITY_CONFIG,
    ...(screens ? { screens: { ...PARITY_CONFIG.screens, ...screens } } : {}),
  });
  return render(
    <BookingWizard
      config={config}
      labels={TEST_LABELS}
      seed={{ services: [GUTTEKLIPP, HERREKLIPP], resources: [ADA, BO], fromTs: NOW }}
      rangeDays={7}
    />
  );
}

const L = TEST_LABELS as unknown as Record<string, string>;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  window.sessionStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
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

/** Step 1 with one child (the guest party's start), then a service. */
async function toTimeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: L['summary.next'] }));
  await user.click(await screen.findByText('Gutteklipp'));
  await screen.findByRole('heading', { level: 2, name: L['time.heading'] });
}

describe('BookingWizard — config.screens', () => {
  it('a guest books a child and themselves together', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();

    // Starts at one child, so «next» is live at once.
    expect(await screen.findByRole('button', { name: L['summary.next'] })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: new RegExp(L['who.party.adult']) }));
    expect(
      screen.getByText(L['who.party.count'].replace('{count}', '1'), { selector: '.sr-only' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: L['summary.next'] }));
    await screen.findByRole('heading', { level: 2, name: L['service.heading'] });
    // Two people on the service step: the child and the grown-up.
    expect(screen.getAllByText('Herreklipp').length).toBeGreaterThan(0);
  });

  it('renders step 1 on the server with the one child already in, and «next» live', async () => {
    const { renderToString } = await import('react-dom/server');
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      screens: { ...PARITY_CONFIG.screens, guestParty: true },
    });
    const html = renderToString(
      <BookingWizard
        config={config}
        labels={TEST_LABELS}
        seed={{ services: [GUTTEKLIPP, HERREKLIPP], resources: [ADA, BO], fromTs: NOW }}
        rangeDays={7}
      />
    );
    expect(html).toContain(L['who.party.count'].replace('{count}', '1'));
    // «next» is drawn enabled: no `disabled` on the summary bar's button.
    const next = html.match(new RegExp(`<button[^>]*>${L['summary.next']}</button>`))?.[0] ?? '';
    expect(next).not.toBe('');
    expect(next).not.toMatch(/\sdisabled(=""|\s|>)/);
  });

  it('leads the time step with «free soon», with who, and marks each day', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();
    await toTimeStep(user);

    const soonest = await screen.findByRole('region', { name: L['time.soonest.heading'] });
    const cards = within(soonest).getAllByRole('button');
    expect(cards[0]).toHaveTextContent('13:00');
    expect(cards[0]).toHaveTextContent('Ada Demo');
    expect(document.querySelector('[data-testid="day-free-marks"]')).not.toBeNull();
  });

  it('draws «first available» as the offered stylists’ faces, and fades the phone row', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();
    await toTimeStep(user);

    const first = screen.getByRole('radio', { name: L['stylist.firstAvailable'] });
    expect(first.querySelectorAll('[data-testid="stylist-faces"] img')).toHaveLength(2);
    expect(screen.getByTestId('stylist-options').className).toContain('mask-image');
  });

  it('puts the time and price on the bar’s second line, and a hint for the dead «next»', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();
    await toTimeStep(user);

    expect(screen.queryByRole('button', { name: L['summary.next'] })).toBeNull();
    expect(screen.getByText(L['summary.hint.when'])).toBeInTheDocument();
    expect(screen.getByText(new RegExp(L['summary.pickTime']))).toHaveClass('text-xs');
  });

  it('opens the details step with the recap, and swaps to the other stylist free then', async () => {
    const { bodies } = stubApi();
    const user = userEvent.setup();
    renderWizard();
    await toTimeStep(user);

    const soonest = await screen.findByRole('region', { name: L['time.soonest.heading'] });
    await user.click(within(soonest).getAllByRole('button')[0] as HTMLElement);

    const recap = await screen.findByRole('region', { name: L['recap.label'] });
    expect(recap).toHaveTextContent('Gutteklipp hos Ada Demo');
    await user.click(
      within(recap).getByRole('button', {
        name: L['recap.swapTo'].replace('{name}', 'Bo Eksempel'),
      })
    );
    expect(screen.getByRole('region', { name: L['recap.label'] })).toHaveTextContent(
      'Gutteklipp hos Bo Eksempel'
    );
    // Still on the details step, nothing lost.
    expect(
      screen.getByRole('heading', { level: 2, name: L['details.heading'] })
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it('goes back to the time step from the recap', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();
    await toTimeStep(user);
    const soonest = await screen.findByRole('region', { name: L['time.soonest.heading'] });
    await user.click(within(soonest).getAllByRole('button')[0] as HTMLElement);

    await user.click(await screen.findByRole('button', { name: L['recap.editLabel'] }));
    expect(
      await screen.findByRole('heading', { level: 2, name: L['time.heading'] })
    ).toBeInTheDocument();
  });

  it('leads a child’s list with the children’s groups, the grown-ups’ below the divider', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('button', { name: L['summary.next'] }));
    await screen.findByRole('heading', { level: 2, name: L['service.heading'] });

    const divider = screen.getByText(L['service.ageDivider.unnamed']);
    const below = screen.getByRole('list', { name: L['service.ageDivider.unnamed'] });
    expect(within(below).getByText('Herreklipp')).toBeInTheDocument();
    expect(within(below).queryByText('Gutteklipp')).toBeNull();
    expect(divider).toBeInTheDocument();
  });

  it('changes nothing for a site that asks for none of them', async () => {
    stubApi();
    renderWizard(null);
    // The guest chips, not the party; a dead «next», not a hint.
    expect(await screen.findByRole('radio', { name: /1 barn/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: new RegExp(L['who.party.adult']) })).toBeNull();
    expect(screen.getByRole('button', { name: L['summary.next'] })).toBeDisabled();
  });
});
