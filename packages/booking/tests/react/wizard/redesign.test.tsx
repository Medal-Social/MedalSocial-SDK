import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * The redesign's opt-in screens, wired through the wizard: grown-ups as a
 * number, a search on a grown-up's list, the compact header, the desktop
 * «your appointment» panel and the booked screen's hero layout.
 */

const location = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { createAttemptStore } from '../../../src/core/attempt-store';
import { type BookingConfigInput, resolveBookingConfig } from '../../../src/core/config';
import { createDraftStore } from '../../../src/core/draft-store';
import type { BookingServiceDto, BookingSlotDto } from '../../../src/core/types';
import { BookingWizard } from '../../../src/react/BookingWizard';
import { mergeLabels } from '../../../src/react/labels';
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
const SKJEGG: BookingServiceDto = { ...HERREKLIPP, id: 'svc-skjegg', name: 'Skjegg' };

const ADA = {
  id: 'res-ada',
  name: 'Ada Demo',
  photoUrl: '/api/booking/avatar/res-ada',
  bio: null,
  serviceIds: [GUTTEKLIPP.id, HERREKLIPP.id, SKJEGG.id],
  sortOrder: 1,
};
const BO = { ...ADA, id: 'res-bo', name: 'Bo Eksempel', photoUrl: null, sortOrder: 2 };

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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const { pathname } = new URL(String(input), 'https://example.test');
      if (pathname.startsWith('/api/booking/resources')) {
        return json({ resources: [ADA, BO], nextAvailableTs: {} });
      }
      if (pathname.startsWith('/api/booking/availability')) return json({ slots: SLOTS });
      if (pathname.startsWith('/api/booking/schedule')) return json({ days: OPEN_WEEK });
      throw new Error(`unexpected fetch: ${pathname}`);
    })
  );
}

const L = TEST_LABELS as unknown as Record<string, string>;

function renderWizard(
  screens: Partial<BookingConfigInput['screens']> = {},
  extra: Partial<BookingConfigInput> = {},
  labels = TEST_LABELS
) {
  const config = resolveBookingConfig({
    ...PARITY_CONFIG,
    ...extra,
    screens: { ...PARITY_CONFIG.screens, guestParty: true, ...screens },
  });
  return render(
    <BookingWizard
      config={config}
      labels={labels}
      seed={{ services: [GUTTEKLIPP, HERREKLIPP, SKJEGG], resources: [ADA, BO], fromTs: NOW }}
      rangeDays={7}
    />
  );
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  window.sessionStorage.clear();
  window.localStorage.clear();
  location.search = '';
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BookingWizard — screens.adultStepper', () => {
  it('books two grown-ups, counted as such', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard(
      { adultStepper: true, compactHeader: true },
      { party: { ...PARITY_CONFIG.party, guestStartEmpty: true } }
    );
    const more = await screen.findByRole('button', { name: L['who.party.adultMore'] });
    await user.click(more);
    await user.click(more);
    expect(
      screen.getByText(L['who.party.adultCount'].replace('{count}', '2'), { selector: '.sr-only' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: L['summary.next'] }));
    await screen.findByRole('heading', { level: 2, name: L['service.heading'] });
    // The compact header's first crumb is the answer.
    const crumbs = screen.getByRole('list', { name: L['wizard.progressLabel'] });
    expect(crumbs).toHaveTextContent(L['people.adults'].replace('{count}', '2'));
  });

  it('adds no step-1 sentences of its own: a site writes them for its own limit', async () => {
    stubApi();
    renderWizard({}, { party: { ...PARITY_CONFIG.party, maxPeople: 2 } });
    await screen.findByRole('checkbox', { name: new RegExp(L['who.party.adult']) });
    expect(screen.queryByText(/tre i samme bestilling/i)).toBeNull();
    expect(screen.queryByText(/Kommer du med barnet/)).toBeNull();
  });

  it('keeps the check row without the switch', async () => {
    stubApi();
    renderWizard();
    expect(
      await screen.findByRole('checkbox', { name: new RegExp(L['who.party.adult']) })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: L['who.party.adultMore'] })).toBeNull();
  });
});

describe('BookingWizard — screens.serviceSearch', () => {
  it('draws no search field over a child’s list', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard({ serviceSearch: true });
    await user.click(await screen.findByRole('button', { name: L['summary.next'] }));
    await screen.findByRole('heading', { level: 2, name: L['service.heading'] });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('searches a grown-up booking alone', async () => {
    stubApi();
    const user = userEvent.setup();
    location.search = 'hvem=voksen';
    renderWizard({ serviceSearch: true });
    const box = await screen.findByRole('searchbox', { name: L['service.searchLabel'] });
    await user.type(box, 'skjegg');
    expect(screen.getByText('Skjegg')).toBeInTheDocument();
    expect(screen.queryByText('Herreklipp')).toBeNull();
  });
});

describe('BookingWizard — screens.compactHeader', () => {
  it('drops the title and lets a reached crumb take you back', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard({ compactHeader: true });
    const crumbs = await screen.findByRole('list', { name: L['wizard.progressLabel'] });
    expect(screen.queryByText(L['wizard.title'])).toBeNull();
    expect(within(crumbs).getByText(L['wizard.step.who'])).toHaveAttribute('aria-current', 'step');

    await user.click(screen.getByRole('button', { name: L['summary.next'] }));
    await user.click(await screen.findByText('Gutteklipp'));
    await screen.findByRole('heading', { level: 2, name: L['time.heading'] });
    // «1 barn» and «Gutteklipp · 30 min totalt» are the crumbs now.
    expect(crumbs).toHaveTextContent(L['people.children'].replace('{count}', '1'));
    expect(crumbs).toHaveTextContent('Gutteklipp');
    await user.click(within(crumbs).getByRole('button', { name: /Gutteklipp/ }));
    await screen.findByRole('heading', { level: 2, name: L['service.heading'] });
    // And the arrow goes one step back.
    await user.click(
      screen.getByRole('button', {
        name: L['wizard.back'].replace('{label}', L['wizard.step.who']),
      })
    );
    await screen.findByRole('heading', { level: 2, name: L['who.heading'] });
  });
});

describe('BookingWizard — screens.desktopPanel', () => {
  it('draws «your appointment» beside the step, with the small print', async () => {
    stubApi();
    const user = userEvent.setup();
    const labels = mergeLabels('nb-NO', {
      ...(TEST_LABELS as Record<string, string>),
      'wizard.panel.payment': 'Vipps, kort eller kontant',
    });
    renderWizard({ desktopPanel: true }, { policy: { freeChangeHours: 24 } }, labels);
    const panel = await screen.findByRole('complementary', { name: L['panel.heading'] });
    expect(panel).toHaveTextContent(L['panel.notChosen']);
    expect(panel).toHaveTextContent(L['wizard.panel.freeChange'].replace('{hours}', '24'));
    expect(panel).toHaveTextContent('Vipps, kort eller kontant');
    expect(panel).toHaveTextContent('Torget 1, 0001 Oslo');

    // «Continue» in the panel moves on like the bar's «next».
    await user.click(within(panel).getByRole('button', { name: L['panel.continue'] }));
    await user.click(await screen.findByText('Gutteklipp'));
    await screen.findByRole('heading', { level: 2, name: L['time.heading'] });
    expect(panel).toHaveTextContent('Gutteklipp');
  });

  it('names the stylist «first available» gave, and swaps to another free then', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard({ desktopPanel: true, recap: true });
    await user.click(await screen.findByRole('button', { name: L['summary.next'] }));
    await user.click(await screen.findByText('Gutteklipp'));
    await screen.findByRole('heading', { level: 2, name: L['time.heading'] });
    await user.click(await screen.findByRole('button', { name: /^13:00/ }));
    const panel = screen.getByRole('complementary', { name: L['panel.heading'] });
    await waitFor(() => expect(panel).toHaveTextContent(L['panel.firstAvailable']));
    // No «continue» on the details step: the form has its own button.
    expect(within(panel).queryByRole('button', { name: L['panel.continue'] })).toBeNull();
    const swap = within(panel).getByRole('button', {
      name: `${L['panel.swap']} ${L['panel.swapTo'].replace('{name}', 'Bo Eksempel')}`,
    });
    await user.click(swap);
    await waitFor(() => expect(panel).toHaveTextContent('Bo Eksempel'));
    // An explicit switch names the stylist: no longer «first available».
    expect(panel).not.toHaveTextContent(L['panel.firstAvailable']);
  });

  it('has no place line without an address, and shows the time crumb on the details step', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard(
      { desktopPanel: true, compactHeader: true },
      { contact: { ...PARITY_CONFIG.contact, address: null } }
    );
    await user.click(await screen.findByRole('button', { name: L['summary.next'] }));
    await user.click(await screen.findByText('Gutteklipp'));
    await user.click(await screen.findByRole('button', { name: /^14:00/ }));
    const crumbs = await screen.findByRole('list', { name: L['wizard.progressLabel'] });
    await waitFor(() => expect(crumbs).toHaveTextContent('14:00'));
    const panel = screen.getByRole('complementary', { name: L['panel.heading'] });
    expect(panel).not.toHaveTextContent('Torget 1');
  });

  it('leaves the stylist row out for a family', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard({ desktopPanel: true });
    await user.click(await screen.findByRole('button', { name: L['who.party.more'] }));
    await user.click(screen.getByRole('button', { name: L['summary.next'] }));
    await screen.findByRole('heading', { level: 2, name: L['service.heading'] });
    const panel = screen.getByRole('complementary', { name: L['panel.heading'] });
    expect(within(panel).queryByText(L['panel.stylist'])).toBeNull();
  });
});

describe('BookingWizard — screens.bookedHero', () => {
  const { rememberConfirmed } = createAttemptStore(PARITY_CONFIG.storageNamespace);
  const SUBMITTED = {
    items: [{ service: GUTTEKLIPP, bookedForName: 'Jonas' }],
    startTs: osloTs(3, 13),
    partyMode: 'sequential' as const,
    resourceIds: [ADA.id],
    stylistNames: ['Ada Demo'],
  };

  it('leads with the leaf, the stylist’s face, directions and the free-change line', async () => {
    stubApi();
    rememberConfirmed(
      { nonce: 'n1' },
      { bookings: [{ id: 'bk_1', manageHref: '/bestill/administrer?t=x' }], submitted: SUBMITTED }
    );
    const { container } = renderWizard({ bookedHero: true }, { policy: { freeChangeHours: 24 } });
    expect(await screen.findByTestId('confirmation-leaf')).toBeInTheDocument();
    const directions = screen.getByRole('link', { name: L['confirmation.directions'] });
    expect(directions.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Torget%201%2C%200001%20Oslo'
    );
    expect(container.querySelector('img[src="/api/booking/avatar/res-ada"]')).not.toBeNull();
    expect(screen.getByText(/gratis til/)).toBeInTheDocument();
  });

  it('finds the face by the booked stylist, not by a cleaned or shared name', async () => {
    const VIKAR = {
      ...BO,
      id: 'res-vikar',
      name: 'bo (vikar)',
      photoUrl: '/api/booking/avatar/res-vikar',
    };
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        if (pathname.startsWith('/api/booking/resources')) {
          return json({ resources: [ADA, BO, VIKAR], nextAvailableTs: {} });
        }
        if (pathname.startsWith('/api/booking/schedule')) return json({ days: OPEN_WEEK });
        return json({ slots: [] });
      })
    );
    rememberConfirmed(
      { nonce: 'n1' },
      {
        bookings: [{ id: 'bk_1', manageHref: null }],
        submitted: { ...SUBMITTED, resourceIds: [VIKAR.id], stylistNames: ['Bo'] },
      }
    );
    const config = resolveBookingConfig({
      ...PARITY_CONFIG,
      screens: { ...PARITY_CONFIG.screens, bookedHero: true },
    });
    const { container } = render(
      <BookingWizard
        config={config}
        labels={TEST_LABELS}
        seed={{ services: [GUTTEKLIPP], resources: [ADA, BO, VIKAR], fromTs: NOW }}
        rangeDays={7}
      />
    );
    await screen.findByTestId('confirmation-leaf');
    expect(container.querySelector('img[src="/api/booking/avatar/res-vikar"]')).not.toBeNull();
  });

  it('takes the site’s own maps link, and says nothing about changes without a rule', async () => {
    stubApi();
    rememberConfirmed(
      { nonce: 'n1' },
      { bookings: [{ id: 'bk_1', manageHref: '/bestill/administrer?t=x' }], submitted: SUBMITTED }
    );
    rememberConfirmed(
      { nonce: 'n1' },
      {
        bookings: [{ id: 'bk_1', manageHref: '/bestill/administrer?t=x' }],
        // A stylist the catalogue no longer has: named, without a face.
        submitted: { ...SUBMITTED, stylistNames: ['Borte Frisør'] },
      }
    );
    renderWizard(
      { bookedHero: true },
      { contact: { ...PARITY_CONFIG.contact, mapsUrl: 'https://maps.example/salong' } }
    );
    expect(await screen.findByRole('link', { name: L['confirmation.directions'] })).toHaveAttribute(
      'href',
      'https://maps.example/salong'
    );
    expect(screen.queryByText(/gratis til/)).toBeNull();
  });

  it('promises no free change for a booking already inside the window', async () => {
    stubApi();
    rememberConfirmed(
      { nonce: 'n1' },
      {
        bookings: [{ id: 'bk_1', manageHref: '/bestill/administrer?t=x' }],
        // Today 13:00, booked at 08:00 with a 24-hour rule: the deadline has passed.
        submitted: { ...SUBMITTED, startTs: osloTs(2, 13) },
      }
    );
    renderWizard({ bookedHero: true }, { policy: { freeChangeHours: 24 } });
    await screen.findByTestId('confirmation-leaf');
    expect(screen.queryByText(/gratis til/)).toBeNull();
  });

  it('has no directions without an address', async () => {
    stubApi();
    rememberConfirmed(
      { nonce: 'n1' },
      {
        bookings: [{ id: 'bk_1', manageHref: null }],
        // A stylist the catalogue no longer has: no face, no name.
        submitted: { ...SUBMITTED, resourceIds: ['res-gone'], stylistNames: [null] },
      }
    );
    renderWizard({ bookedHero: true }, { contact: { ...PARITY_CONFIG.contact, address: null } });
    expect(await screen.findByTestId('confirmation-leaf')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: L['confirmation.directions'] })).toBeNull();
  });
});

describe('BookingWizard — a restored guest party with two grown-ups', () => {
  it('reseats them on their own seats', async () => {
    stubApi();
    const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
    stashDraft({
      items: [
        { serviceId: HERREKLIPP.id, bookedForName: null, bookedForBirthYear: null, adult: true },
        { serviceId: HERREKLIPP.id, bookedForName: null, bookedForBirthYear: null, adult: true },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
    renderWizard({ adultStepper: true, compactHeader: true });
    // No time in the draft: back on the time step, as a one-person draft is.
    await screen.findByRole('heading', { level: 2, name: L['time.heading'] });
    await waitFor(() =>
      expect(screen.getByRole('list', { name: L['wizard.progressLabel'] })).toHaveTextContent(
        L['people.adults'].replace('{count}', '2')
      )
    );
  });

  it('numbers a grown-up and a child each on their own seats', async () => {
    stubApi();
    const user = userEvent.setup();
    const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
    stashDraft({
      items: [
        { serviceId: HERREKLIPP.id, bookedForName: null, bookedForBirthYear: null, adult: true },
        { serviceId: GUTTEKLIPP.id, bookedForName: null, bookedForBirthYear: null, adult: false },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
    renderWizard({ adultStepper: true, compactHeader: true });
    await screen.findByRole('heading', { level: 2, name: L['time.heading'] });
    // Step 1 shows the restored party as its own controls would make it.
    await user.click(screen.getByRole('button', { name: new RegExp(L['wizard.step.who']) }));
    expect(
      await screen.findByText(L['who.party.count'].replace('{count}', '1'), {
        selector: '.sr-only',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(L['who.party.adultCount'].replace('{count}', '1'), { selector: '.sr-only' })
    ).toBeInTheDocument();
  });
});
