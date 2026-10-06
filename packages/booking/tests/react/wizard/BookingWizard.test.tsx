import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRebookStore } from '../../../src/core/rebook-store';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * The address bar. Its own hoisted box so a test can arrive with a «Bestill
 * igjen» link without re-mocking the module; empty, which is how every test
 * that is not about the link arrives.
 */
const location = vi.hoisted(() => ({ search: '' }));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => router,
}));

/**
 * The portal's login actions, behind the login sheet the wizard offers — the
 * app's server actions, handed to the wizard as a prop (Decision 8). What the
 * sheet does with them has its own suite; what matters here is where the
 * wizard offers it, and what the wizard does with the parent it hands back.
 */
const actions = vi.hoisted(() => ({
  startLoginAction: vi.fn(),
  startVippsLoginAction: vi.fn(),
}));

import { createClock } from '../../../src/core/clock';
import { createDraftStore } from '../../../src/core/draft-store';
import type { BookingDayDto, BookingServiceDto, BookingSlotDto } from '../../../src/core/types';
import { BookingWizard, setLegacyWizardActions } from '../../support/legacy-wizard';
import { PARITY_CONFIG } from '../../support/parity-config';
import { textNodesOf } from '../../support/text-nodes';

setLegacyWizardActions({
  startLogin: (input) => actions.startLoginAction(input),
  startVipps: (previous, formData) => actions.startVippsLoginAction(previous, formData),
});

const { stashRebookWho, takeRebookWho } = createRebookStore(PARITY_CONFIG.storageNamespace);
const { stashDraft } = createDraftStore(PARITY_CONFIG.storageNamespace);
const { dayKey: salonDayKey } = createClock(PARITY_CONFIG);

/**
 * A «Neste ledige» row by its whole text. The prefix is its own span (screen
 * reader only on a phone), so `getByText('Neste ledige: …')` on its own no
 * longer matches one text node.
 */
function nextAvailableRow(text: string) {
  return (_content: string, element: Element | null) =>
    element?.getAttribute('data-testid') === 'next-available-row' && element.textContent === text;
}

/**
 * The shell, which is where every seam in this feature meets: the machine, the
 * three steps, the party search, the route handlers and the confirmation.
 *
 * Every assertion below is about WIRING — that a thing the wizard already knows
 * how to do is actually reachable from a tap. The rules themselves are proved
 * without rendering, in `wizard-machine.test.ts` and `party-slots.test.ts`.
 */

// Times on the chips are the salon's, and this suite normally runs in Oslo —
// where a shell that handed a component the viewer's clock would look identical.
pinAForeignViewerClock();

const pad = (value: number) => String(value).padStart(2, '0');

/** An instant at an Oslo wall-clock time. The offset is spelled out because
 * 2026-09 is inside CEST, and that is the one construction the runner's own
 * zone cannot move. */
function osloTs(day: number, hour: number, minute = 0): number {
  return Date.parse(`2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`);
}

/** Wednesday 2 September 2026, 08:00 Oslo — the instant the whole suite stands
 * at, so «I dag» and «I morgen» name the days the fixtures use. */
const NOW = osloTs(2, 8);

/** `formatPrice` joins with U+00A0. An assertion written with a plain space
 * fails against correct code, and the default normalizer hides the reverse. */
const exactly = (text: string) => text;

/** U+00A0, the one `formatPrice` joins with. */
const NBSP = '\u00A0';

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

const JENTEKLIPP: BookingServiceDto = {
  ...GUTTEKLIPP,
  id: 'svc-jente',
  name: 'Jenteklipp',
};

/** Bookable, in the kids' menu, and alone: `partyLimit` takes `Math.min` over
 * the whole basket, so adding this one to anything is the refusal. */
const HULL_I_ORENE: BookingServiceDto = {
  ...GUTTEKLIPP,
  id: 'svc-hull',
  name: 'Hull i ørene',
  maxPerBooking: 1,
};

const SARA = {
  id: 'res-sara',
  name: 'Sara',
  photoUrl: null,
  bio: null,
  serviceIds: [GUTTEKLIPP.id, JENTEKLIPP.id, HULL_I_ORENE.id],
  sortOrder: 1,
};

const MARCUS = {
  id: 'res-marcus',
  name: 'Marcus',
  photoUrl: null,
  bio: null,
  serviceIds: [GUTTEKLIPP.id, JENTEKLIPP.id],
  sortOrder: 2,
};

function slot(day: number, hour: number, resourceId: string, minute = 0): BookingSlotDto {
  return { startTs: osloTs(day, hour, minute), resourceId };
}

/**
 * One open date in the suite's September. The default is 10:00–17:00 with a
 * last start of 16:30 — the half-hour gap a 30-minute Gutteklipp leaves before
 * closing, and the gap that makes «for sent» a different answer from «fullt».
 */
function openDay(day: number, lastStart: [number, number] | null = [16, 30]): BookingDayDto {
  return {
    dayKey: `2026-09-${pad(day)}`,
    opensTs: osloTs(day, 10),
    closesTs: osloTs(day, 17),
    lastStartTs: lastStart === null ? null : osloTs(day, lastStart[0], lastStart[1]),
  };
}

/**
 * The whole seven-day window the shell asks about, open every day.
 *
 * The DEFAULT, and deliberately not `[]`. An empty schedule is a salon that
 * keeps no hours at all, which would make «Stengt» the right answer to every
 * empty day — and would quietly turn every fixture in this file that happens to
 * have no slots into a test about a closed salon rather than about whatever it
 * was written for. A test that wants a shut day says so.
 */
const AN_OPEN_WEEK: BookingDayDto[] = [2, 3, 4, 5, 6, 7, 8].map((day) => openDay(day));

interface ApiStub {
  resources?: { resources?: unknown[]; nextAvailableTs?: Record<string, number> };
  resourcesStatus?: number;
  slots?: Record<string, BookingSlotDto[]>;
  availabilityStatus?: number;
  days?: BookingDayDto[];
  scheduleStatus?: number;
  create?: unknown;
  createStatus?: number;
  /** Held open so a test can act while the create is still in flight. */
  createHold?: Promise<void>;
  /** What `POST /api/portal/login/verify` answers — the login sheet's code check. */
  verify?: { status: number; body: unknown };
  /** What `POST /api/portal/persons` answers — step 1's «+ Legg til barn», logged in. */
  persons?: { status: number; body: unknown };
  /** What `POST /api/portal/vipps/link/verify` answers — a Vipps confirm code. */
  vippsVerify?: { status: number; body: unknown };
}

/**
 * Every route handler the shell may call, and a log of what it asked.
 *
 * The log is the point of the `never asks Medal` test: `MEDAL_API_KEY` is read
 * by a `server-only` module, and the guarantee that it stays out of the browser
 * is exactly the guarantee that every request from here is same-origin and
 * under `/api/booking/`.
 */
function stubApi(stub: ApiStub = {}) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const verifyBodies: unknown[] = [];
  const personBodies: unknown[] = [];

  const json = (status: number, body: unknown) => ({
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

      // Routed on the PATH, so a request aimed straight at Medal is still
      // answered — otherwise the «never leaves this site» assertion below would
      // be carried by the stub throwing rather than by the URL being wrong.
      const { pathname, searchParams } = new URL(url, 'https://example.test');
      if (
        pathname.startsWith('/api/booking/resources') ||
        pathname.endsWith('/bookings/resources')
      ) {
        return json(stub.resourcesStatus ?? 200, stub.resources ?? { resources: [SARA, MARCUS] });
      }
      if (
        pathname.startsWith('/api/booking/availability') ||
        pathname.endsWith('/bookings/availability')
      ) {
        const serviceId = searchParams.get('service_id') ?? '';
        return json(stub.availabilityStatus ?? 200, { slots: stub.slots?.[serviceId] ?? [] });
      }
      if (pathname.startsWith('/api/booking/schedule') || pathname.endsWith('/bookings/schedule')) {
        return json(stub.scheduleStatus ?? 200, { days: stub.days ?? AN_OPEN_WEEK });
      }
      if (pathname === '/api/portal/vipps/link/verify') {
        verifyBodies.push(JSON.parse(String(init?.body)));
        return json(stub.vippsVerify?.status ?? 401, stub.vippsVerify?.body ?? { ok: false });
      }
      if (pathname === '/api/portal/persons') {
        personBodies.push(JSON.parse(String(init?.body)));
        return json(stub.persons?.status ?? 201, stub.persons?.body ?? { ok: false });
      }
      if (pathname === '/api/portal/login/verify') {
        verifyBodies.push(JSON.parse(String(init?.body)));
        return json(stub.verify?.status ?? 200, stub.verify?.body ?? { ok: true, guardian: null });
      }
      if (pathname.startsWith('/api/booking/create')) {
        if (stub.createHold) await stub.createHold;
        return json(
          stub.createStatus ?? 201,
          stub.create ?? { bookings: [{ id: 'bk-1', manageToken: 'tok-1' }] }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );

  return { urls, bodies, verifyBodies, personBodies };
}

function renderWizard(props: Partial<Parameters<typeof BookingWizard>[0]> = {}) {
  return render(
    <BookingWizard
      services={[GUTTEKLIPP, JENTEKLIPP, HULL_I_ORENE]}
      phone="22 33 44 55"
      rangeStart={NOW}
      rangeDays={7}
      {...props}
    />
  );
}

/**
 * Step 1 as a guest: «1 barn» is one tap and lands on «Hva skal gjøres?». A
 * no-op where the wizard is already past it — a link, a restored draft.
 */
async function chooseOneChild(user: ReturnType<typeof userEvent.setup>) {
  const chip = screen.queryByRole('radio', { name: '1 barn' });
  if (chip === null) return;
  await user.click(chip);
  await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
}

/**
 * A sibling, the SP10 way: back to «Hvem», «2 barn» (the first child keeps
 * their service), and the second child's service from their own list.
 */
async function addSibling(user: ReturnType<typeof userEvent.setup>, service: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Hvem' }));
  await user.click(await screen.findByRole('radio', { name: '2 barn' }));
  await user.click(
    within(await screen.findByRole('list', { name: 'Tjenester for Barn 2' })).getByRole('button', {
      name: service,
    })
  );
}

/** Step 1 → step 2 → step 3, which is what «1 barn» and a service card do. */
async function pickGutteklipp(user: ReturnType<typeof userEvent.setup>) {
  await chooseOneChild(user);
  await user.click(screen.getByRole('button', { name: /Gutteklipp/ }));
  await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
}

/**
 * «Første ledige», then wait for the openings.
 *
 * Both halves are on step 2 now — the stylist and the hour are one screen — so
 * this no longer advances anything. It still says what it did: the visitor has
 * answered the stylist question with the default and is looking at the times.
 */
async function takeFirstAvailable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Første ledige/ }));
  await screen.findByRole('heading', { name: 'Når passer det?' });
}

/**
 * The hour → «Bekreft», which is one tap now: picking a slot IS the way to the
 * form. There used to be a login step between them; the login is a sheet
 * offered on the form itself, and a parent who wants no account never sees
 * more than the row that offers it.
 */
async function onDetails() {
  await screen.findByRole('heading', { name: 'Nesten ferdig!' });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  // The attempt store is per TAB and deliberately outlives a page load, so
  // without this one test's confirmation is the next one's starting screen.
  window.sessionStorage.clear();
  location.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BookingWizard', () => {
  it('keeps a guest’s «+ Legg til barn» in this booking, and asks for nothing more on «Bekreft»', async () => {
    const { urls } = stubApi({ slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Legg til barn' }));
    const sheet = await screen.findByRole('dialog', { name: 'Legg til barn' });
    // Nowhere to keep a note for a guest, so none is asked for.
    expect(within(sheet).queryByLabelText(/Notat til frisøren/)).toBeNull();
    await user.type(within(sheet).getByLabelText('Navn'), 'Theo');
    await user.selectOptions(within(sheet).getByLabelText('Fødselsår'), '2019');
    await user.click(within(sheet).getByRole('button', { name: 'Legg til' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(urls.some((url) => url.includes('/api/portal/persons'))).toBe(false);
    expect(screen.getByRole('checkbox', { name: /Theo/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    // A named guest child: the fields are there, already filled.
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Theo');
    expect(screen.getByLabelText('Fødselsår')).toHaveValue('2019');
  });

  it('opens on «Hvem skal klippes?» and a guest chip is one tap to step 2', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(screen.getByText('Steg 1 av 4 · Hvem')).toBeInTheDocument();
    // One text node per literal run and per hole, as a JSX `{a}{b}` sentence
    // renders: a single filled string lays its glyphs out sub-pixel apart.
    expect(textNodesOf(screen.getByText('Steg 1 av 4 · Hvem'))).toEqual([
      'Steg ',
      '1',
      ' av ',
      '4',
      ' · ',
      'Hvem',
    ]);
    for (const chip of ['1 barn', '2 barn', '3 barn', 'Voksen']) {
      expect(screen.getByRole('radio', { name: chip })).toHaveAttribute('aria-checked', 'false');
    }
    // The login offer is on this step, for the parent who would rather be known.
    expect(screen.getByRole('button', { name: 'Logg inn' })).toBeInTheDocument();

    await pickGutteklipp(user);
  });

  it('asks a family for each child’s service on step 2, and only then opens step 3', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('radio', { name: '2 barn' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();

    await user.click(
      within(screen.getByRole('list', { name: 'Tjenester for Barn 1' })).getByRole('button', {
        name: /Gutteklipp/,
      })
    );
    // One child answered is not a basket: the bar still waits for the other.
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();
    await user.click(
      within(screen.getByRole('list', { name: 'Tjenester for Barn 2' })).getByRole('button', {
        name: /Jenteklipp/,
      })
    );
    expect(screen.getByText(/2 tjenester/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
  });

  it('asks this site for everything, so the Medal key never has to leave the server', async () => {
    const { urls } = stubApi({ slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);
    await screen.findByRole('button', { name: '13:00' });

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('/api/booking/')).toBe(true);
  });

  it('fills «Neste ledige» from the resources route rather than from step 3’s slots', async () => {
    // Step 2's line is answered for every stylist at once. Deriving it from the
    // wizard's own availability would collapse to whoever was selected, and the
    // other cards would lose their line while the visitor was still choosing.
    stubApi({
      resources: {
        resources: [SARA, MARCUS],
        nextAvailableTs: { [SARA.id]: osloTs(3, 9) },
      },
    });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);

    expect(
      await screen.findByText(nextAvailableRow('Neste ledige: i morgen 09:00'))
    ).toBeInTheDocument();
  });

  it('drops «Neste ledige» when the new service\u2019s refresh fails', async () => {
    // The times are answered for ONE service. Keeping the previous service's
    // answers when the refresh fails labels the stylists of a Jenteklipp with
    // opening times calculated for a Gutteklipp — and the two need not have the
    // same availability, or any.
    const stub: ApiStub = {
      resources: { resources: [SARA, MARCUS], nextAvailableTs: { [SARA.id]: osloTs(3, 9) } },
    };
    stubApi(stub);
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    expect(
      await screen.findByText(nextAvailableRow('Neste ledige: i morgen 09:00'))
    ).toBeInTheDocument();

    stub.resourcesStatus = 500;
    await user.click(screen.getByRole('button', { name: 'Hva' }));
    await user.click(await screen.findByRole('button', { name: /Jenteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });

    await waitFor(() => expect(screen.queryByText(/Neste ledige:/)).toBeNull());
    // The catalogue itself is worth keeping — a step 2 with nobody on it is a
    // bigger failure than a step 2 with no opening times on it.
    expect(screen.getByRole('radio', { name: /Sara/ })).toBeInTheDocument();
  });

  it('drops a named stylist the added child puts out of reach', async () => {
    // Marcus does Gutteklipp and nothing else here, so adding a Jenteklipp
    // takes him off step 2's list — `StylistStep` only offers people who cover
    // the whole basket. Keeping the preference anyway left the step with
    // nothing selected and step 3 filtered to a diary that cannot take the
    // visit: «Fullt» on every day of the week at a salon with a free chair.
    //
    // The machine cannot know who does what; the shell holds the catalogue and
    // hands the fact down. This is the only test that proves it actually does.
    const GUTT_ONLY = { ...MARCUS, serviceIds: [GUTTEKLIPP.id] };
    stubApi({ resources: { resources: [GUTT_ONLY] } });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('radio', { name: /Marcus/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    await addSibling(user, /Jenteklipp/);

    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });

    // «Første ledige» is selected again, rather than the step showing no answer
    // at all while the machine still holds Marcus.
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.queryByRole('radio', { name: /Marcus/ })).toBeNull();
  });

  it('keeps a named stylist who can take the added child too', async () => {
    // The other half of the rule, and the reason the shell hands down a list
    // rather than clearing on every add: a parent who asked for Sara and then
    // added a sibling she can also take has not changed their mind about her,
    // and being re-asked is the cost of getting this wrong the other way.
    stubApi({ resources: { resources: [SARA] } });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('radio', { name: /Sara/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    await addSibling(user, /Jenteklipp/);

    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });

    expect(screen.getByRole('radio', { name: /Sara/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('names the stylist in the summary bar instead of leaving an id under the thumb', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('radio', { name: /Sara/ }));

    // Read exactly: the price carries a non-breaking space, and the dashes are
    // the machine's own «not chosen yet».
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
  });

  it('never asks about a day the strip cannot draw', async () => {
    // The window and the day strip are one answer, and the arithmetic that
    // produced them used to be two. `fromTs + 7 × 86 400 000` reaches to 08:00
    // on the EIGHTH day whenever the page is opened at 08:00 — a morning with
    // no chip, whose openings step 2 could still quote as a stylist's «Neste
    // ledige» and step 3 could then never show.
    const { urls } = stubApi();
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    const strip = await screen.findByRole('group', { name: 'Velg dag' });
    const chips = within(strip).getAllByRole('button');
    expect(chips).toHaveLength(7);

    // Every window the shell asks about — availability, resources, schedule.
    const bounds = urls
      .map((url) => new URL(url, 'https://example.test').searchParams.get('to_ts'))
      .filter((value): value is string => value !== null)
      .map(Number);
    expect(bounds.length).toBeGreaterThan(0);
    // The last instant inside each of them has to belong to the last chip.
    for (const toTs of bounds) expect(salonDayKey(toTs - 1)).toBe('2026-09-08');
  });

  it('shows a fully-booked day, which takes the window and not just the slots', async () => {
    // The strip can only be drawn from the days the wizard ASKED about. Without
    // them a day with nothing in it has no chip, and «Fullt i dag» — the whole
    // dead-end affordance — can never appear.
    //
    // «Fullt» rather than «Stengt» because the schedule says the salon is open
    // today with time left on it, which is the one reading that makes the word
    // true. The chip has to survive the strip's filter too: a full day is not a
    // shut one, and it must stay tappable.
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(4, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    expect(await screen.findByText(/Fullt i dag/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I dag' })).toBeInTheDocument();
  });

  it('never offers a day the salon is shut on', async () => {
    // End to end through the shell: the schedule fetch, the prop, the strip.
    // Only Friday the 4th is open, so the other six days of the window are not
    // chips at all — and the visitor lands on the day that has something rather
    // than on today's dead end.
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(4, 13, SARA.id)] }, days: [openDay(4)] });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    expect(await screen.findByRole('button', { name: /13:00/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I dag' })).toBeNull();
  });

  it('says the salon is shut, not full, when it keeps no hours all week', async () => {
    // The salon away for the whole window — a refurbishment, or the fortnight
    // in July. Every day is filtered out of the strip, today goes back in so
    // there is a day to name, and the card names it truthfully. «Fullt» here is
    // the exact false claim this path was built to remove.
    stubApi({ days: [] });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    expect(await screen.findByText(/Stengt i dag/)).toBeInTheDocument();
    expect(screen.queryByText(/Fullt/)).toBeNull();
    // Nobody is there to answer, so there is no number to ring.
    expect(screen.queryByRole('link', { name: /Ring oss/ })).toBeNull();
  });

  it('degrades to the old wording when the schedule endpoint is not there yet', async () => {
    // DEPLOY ORDER. The site can ship before the engine's /bookings/schedule
    // does — the route relays Medal's 404, the fetch fails, `openDays` stays
    // null, and the card falls back to a sentence that is true whatever the
    // salon's hours are. It must NOT read as «Stengt»: a 404 of ours is not a
    // closed salon, and saying so would be the same class of false claim about
    // the business that the schedule was added to remove.
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(4, 13, SARA.id)] }, scheduleStatus: 404 });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    expect(await screen.findByText(/Ingenting ledig i dag/)).toBeInTheDocument();
    expect(screen.queryByText(/Stengt|Fullt|For sent/)).toBeNull();
    // And today is still offered, because nothing is known against it.
    expect(screen.getByRole('button', { name: 'I dag' })).toBeInTheDocument();
  });

  it('does not judge a new service’s days by the old service’s cutoffs', async () => {
    // `lastStartTs` is «the last start THIS service fits». Carrying Gutteklipp's
    // over to Jenteklipp is not a stale label but a confident wrong answer to
    // «is this day over?» — and it survives indefinitely when the new fetch
    // fails. Cleared to null, step 3 falls back to the wording that is true
    // whatever the hours turn out to be.
    //
    // Gutteklipp's schedule answers and says today is open; Jenteklipp's fails.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname, searchParams } = new URL(String(input), 'https://example.test');
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
        if (pathname.startsWith('/api/booking/schedule')) {
          if (searchParams.get('service_id') === GUTTEKLIPP.id) return ok({ days: AN_OPEN_WEEK });
          return { ok: false, status: 503, json: async () => ({ error: 'upstreamError' }) };
        }
        if (pathname.startsWith('/api/booking/resources')) return ok({ resources: [SARA] });
        return ok({ slots: [] });
      })
    );
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);
    // Gutteklipp's own schedule is in hand, so the day is judged confidently.
    expect(await screen.findByText(/Fullt/)).toBeInTheDocument();

    // Step 1 again, a different service, and its schedule does not answer.
    await user.click(screen.getByRole('button', { name: 'Hva' }));
    await user.click(await screen.findByRole('button', { name: /Jenteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await takeFirstAvailable(user);

    expect(await screen.findByText(/Ingenting ledig/)).toBeInTheDocument();
    expect(screen.queryByText(/Fullt|Stengt|For sent/)).toBeNull();
  });

  it('measures the day against the whole family visit, not just the first child', async () => {
    // The schedule is fetched for ONE service, so `lastStartTs` describes a
    // 30-minute Gutteklipp. Two children back to back run an hour, so the last
    // start a FAMILY fits is half an hour earlier — and a day past that is
    // «For sent», not «Fullt». «Fullt» there sends a parent to a telephone for
    // a day that is simply over.
    //
    // 16:15 with the day's single-service cutoff at 16:30: still open for one
    // child, already gone for two.
    vi.spyOn(Date, 'now').mockReturnValue(osloTs(2, 16, 15));
    stubApi({ days: [openDay(2)] });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await addSibling(user, /Jenteklipp/);
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await takeFirstAvailable(user);

    expect(await screen.findByText(/For sent/)).toBeInTheDocument();
    expect(screen.queryByText(/Fullt/)).toBeNull();
  });

  it('can ask for the openings again after a transient failure', async () => {
    // A failed fetch writes nothing into the cache, so `missingKey` is the same
    // string it was and the effect has no reason to run again. Going back and
    // picking the SAME service therefore never retried — the wizard sat on the
    // telephone-only card until the visitor reloaded the page.
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
        if (pathname.startsWith('/api/booking/availability')) {
          calls += 1;
          if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
          return ok({ slots: [slot(2, 13, SARA.id)] });
        }
        if (pathname.startsWith('/api/booking/resources')) return ok({ resources: [SARA] });
        if (pathname.startsWith('/api/booking/schedule')) return ok({ days: AN_OPEN_WEEK });
        return ok({});
      })
    );
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    // Not `takeFirstAvailable`: step 3's heading lives inside `TimeStep`, which
    // does not render at all while the openings are missing.
    await user.click(screen.getByRole('radio', { name: /Første ledige/ }));
    expect(await screen.findByText(/Vi får ikke hentet ledige tider/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));

    expect(await screen.findByRole('button', { name: '13:00' })).toBeInTheDocument();
    expect(screen.queryByText(/Vi får ikke hentet ledige tider/)).toBeNull();
    expect(calls).toBe(2);
  });

  it('says the openings could not be read rather than that the salon is full', async () => {
    // «Fullt» is a claim about the salon. A failed fetch is a claim about us,
    // and telling a parent the chair is taken when it is free is the worse of
    // the two ways to be wrong.
    //
    // The schedule still answers here, so the empty-day card would have had the
    // hours to say «Fullt» with — which is exactly why the assertion is that it
    // did not render at all.
    stubApi({ availabilityStatus: 502 });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    // Not `takeFirstAvailable`: step 3 has no «Når passer det?» heading when the
    // openings could not be read, because `TimeStep` is what draws it and there
    // is nothing for it to draw.
    await user.click(screen.getByRole('radio', { name: /Første ledige/ }));

    expect(await screen.findByText(/Vi får ikke hentet ledige tider/)).toBeInTheDocument();
    expect(screen.queryByText(/Fullt|Stengt|Ingenting ledig/)).toBeNull();
    // The link's sentence keeps its hole as its own text node.
    const call = screen.getByRole('link', { name: 'Ring oss på 22 33 44 55' });
    expect(textNodesOf(call)).toEqual(['ring oss på ', '22 33 44 55']);
  });

  it('runs the party search, so a family gets one chip for the whole visit', async () => {
    // `findPartySlots` had no caller at all before the shell. Two children back
    // to back with one stylist is one offer — 13:00 → 14:00 — and not two
    // single-service chips the parent would have to book twice.
    stubApi({
      slots: {
        [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)],
        // Gutteklipp is 30 minutes, so «rett etter hverandre» is exactly 13:30
        // — and it has to be Sara, because a sequential visit is one chair.
        [JENTEKLIPP.id]: [slot(2, 13, SARA.id, 30)],
      },
    });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    // Back to step 1 to add the sibling, which is where the affordance lives.
    await addSibling(user, /Jenteklipp/);

    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await takeFirstAvailable(user);

    expect(await screen.findByRole('button', { name: '13:00 → 14:00' })).toBeInTheDocument();
  });

  /**
   * Seen on staging: a family of two on «Samme frisør, rett etter hverandre»
   * got stylist cards with an empty «Neste ledige» row. The route's answer is
   * for ONE service, so the wizard now runs the party search per stylist over
   * the openings it already holds — the first minute the WHOLE family fits.
   */
  it('gives a family each stylist’s first back-to-back start as «Neste ledige»', async () => {
    stubApi({
      resources: {
        resources: [SARA, MARCUS],
        // The single-service answer: right for one child, wrong for two.
        nextAvailableTs: { [SARA.id]: osloTs(2, 13), [MARCUS.id]: osloTs(2, 13) },
      },
      slots: {
        [GUTTEKLIPP.id]: [
          slot(2, 13, SARA.id),
          slot(2, 15, SARA.id),
          slot(2, 13, MARCUS.id),
          slot(2, 14, MARCUS.id),
        ],
        // Sara can take Emma at 15:30 only; Marcus straight after 14:00.
        [JENTEKLIPP.id]: [slot(2, 15, SARA.id, 30), slot(2, 14, MARCUS.id, 30)],
      },
    });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await addSibling(user, /Jenteklipp/);
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });

    expect(
      await screen.findByRole('radio', { name: 'Sara Neste ledige: i dag 15:00' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Marcus Neste ledige: i dag 14:00' })
    ).toBeInTheDocument();
    // Never the one-child minute, which the time step could not honour.
    expect(screen.queryByText(nextAvailableRow('Neste ledige: i dag 13:00'))).toBeNull();

    // And the card agrees with the time step once Sara is picked.
    await user.click(screen.getByRole('radio', { name: /^Sara/ }));
    expect(await screen.findByRole('button', { name: '15:00 → 16:00' })).toBeInTheDocument();
  });

  it('offers the parallel alternative on a day with nothing back to back', async () => {
    // The report's rescue. It is only reachable because the shell runs the
    // parallel search over the UNFILTERED slots alongside the sequential one —
    // two children at once is by construction two different stylists.
    stubApi({
      slots: {
        [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)],
        // Marcus is free at the same minute, and nobody is free at 13:30 — so
        // there is no back-to-back visit and there is a simultaneous one.
        [JENTEKLIPP.id]: [slot(2, 13, MARCUS.id)],
      },
    });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await addSibling(user, /Jenteklipp/);
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await takeFirstAvailable(user);

    expect(
      await screen.findByText(/Ingen ledige timer rett etter hverandre i dag/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ta 13:00 samtidig' })).toBeInTheDocument();
  });

  it('offers a family no service the strictest limit would refuse', async () => {
    // `partyLimit` takes `Math.min` over the whole basket, and «Hull i ørene»
    // takes one child per booking — so a family of two is never offered it,
    // rather than offered it and refused.
    stubApi();
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await user.click(screen.getByRole('button', { name: 'Hvem' }));
    await user.click(await screen.findByRole('radio', { name: '2 barn' }));

    const second = within(await screen.findByRole('list', { name: 'Tjenester for Barn 2' }));
    expect(second.getByRole('button', { name: /Jenteklipp/ })).toBeInTheDocument();
    expect(second.queryByRole('button', { name: /Hull i ørene/ })).toBeNull();
  });

  it('goes back through the progress dots but never forward past an unanswered step', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByRole('button', { name: 'Frisør og tid' })).toBeDisabled();

    await pickGutteklipp(user);
    expect(screen.getByRole('button', { name: 'Hva' })).toBeEnabled();
    // A slot is what step 3 answers, and nothing has been picked.
    expect(screen.getByRole('button', { name: 'Bekreft' })).toBeDisabled();
  });
});

describe('BookingWizard submission', () => {
  /** Step 1 through step 4, ending on «Nesten ferdig!» with a phone number in. */
  async function fillIn(user: ReturnType<typeof userEvent.setup>) {
    await pickGutteklipp(user);
    await takeFirstAvailable(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
  }

  const OPEN_AT_ONE = { slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } };

  /**
   * The whole path, because the bug is only reachable along it: pick a slot,
   * go back, change the stylist, jump forward on the dots, submit.
   *
   * `pickResource` used to change the preference and leave `startTs`,
   * `resolvedResourceId` and the seating chart standing. `canGoToStep` asks
   * only whether `startTs` is non-null, so «Detaljer» stayed tappable and the
   * booking that went out was Sara's 13:00 filed against Marcus — a stylist the
   * parent did not choose, at a time they were never shown for him.
   */
  it('will not submit the old slot after the visitor changes stylist and jumps ahead', async () => {
    const { bodies } = stubApi({
      // Sara at one, Marcus at two, and neither free when the other is: the
      // stale slot and the honest one cannot be confused for each other.
      slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id), slot(2, 14, MARCUS.id)] },
    });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await takeFirstAvailable(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    // Back to step 2 on the dots, and a different stylist.
    await user.click(screen.getByRole('button', { name: 'Frisør og tid' }));
    await user.click(await screen.findByRole('radio', { name: /Marcus/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    // The jump the bug allowed. Sara's hour is not Marcus's hour, so there is
    // nothing answered here to carry forward.
    expect(screen.getByRole('button', { name: 'Bekreft' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Bekreft' }));
    expect(screen.queryByRole('heading', { name: 'Nesten ferdig!' })).toBeNull();

    // And the honest way through still works — the point is that the visitor is
    // sent back for a time, not that they are stuck.
    await user.click(await screen.findByRole('button', { name: '14:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const submitted = bodies[0] as { items: Array<{ resourceId?: string; startTs: number }> };
    expect(submitted.items[0]).toMatchObject({
      resourceId: MARCUS.id,
      startTs: osloTs(2, 14),
    });
  });

  it('confirms, and builds the manage link out of the token that came back', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    expect(
      await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Endre eller avbestill' })).toHaveAttribute(
      'href',
      '/bestill/administrer/tok-1'
    );
  });

  /**
   * The create route answers with one booking and one manage token PER LINE
   * ITEM, and the plaintext token is returned exactly once — only its hash is
   * stored. Keeping `bookings[0]` alone therefore threw Emma's credential away
   * permanently, and because e-mail is optional on step 4 there was no second
   * copy of it anywhere: a parent who booked both children without giving an
   * address could never reach the second appointment again.
   */
  it('keeps a manage link for every child, not just the one the response led with', async () => {
    stubApi({
      slots: {
        [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)],
        [JENTEKLIPP.id]: [slot(2, 13, SARA.id, 30)],
      },
      create: {
        bookings: [
          { id: 'bk-jonas', manageToken: 'tok-jonas' },
          { id: 'bk-emma', manageToken: 'tok-emma' },
        ],
      },
    });
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await addSibling(user, /Jenteklipp/);
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await takeFirstAvailable(user);
    await user.click(await screen.findByRole('button', { name: '13:00 → 14:00' }));

    await onDetails();
    // Named, so the links can be told apart by whose appointment they move.
    await user.type(screen.getAllByLabelText('Hvem skal klippes?')[0], 'Jonas');
    await user.type(screen.getAllByLabelText('Hvem skal klippes?')[1], 'Emma');
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    expect(
      screen.getByRole('link', { name: 'Endre eller avbestill Jonas kl. 13:00' })
    ).toHaveAttribute('href', '/bestill/administrer/tok-jonas');
    // The one that used to be discarded — and the token behind it is gone from
    // the wire the moment this render is missed.
    expect(
      screen.getByRole('link', { name: 'Endre eller avbestill Emma kl. 13:30' })
    ).toHaveAttribute('href', '/bestill/administrer/tok-emma');

    // And each child's calendar entry is keyed to that child's OWN booking:
    // the manage page emits its reschedule under the id of the booking it
    // manages, so a family whose entries all carried the first child's id could
    // never be moved one at a time.
    const href =
      screen.getByRole('link', { name: 'Legg til i kalender' }).getAttribute('href') ?? '';
    const ics = decodeURIComponent(href.replace(/^data:text\/calendar;charset=utf-8,/, ''));
    const uids = ics.split('\r\n').filter((line) => line.startsWith('UID:'));
    expect(uids).toEqual(['UID:bk-jonas', 'UID:bk-emma']);
  });

  it('sends the nonce, so a double-tapped «Bekreft» derives one idempotency key', async () => {
    const { bodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const submitted = bodies[0] as { submissionNonce?: unknown; items?: unknown[] };
    expect(typeof submitted.submissionNonce).toBe('string');
    expect(submitted.items).toHaveLength(1);
  });

  it('sends a parent whose submission Medal already holds to their e-mail, not the button', async () => {
    stubApi({ ...OPEN_AT_ONE, createStatus: 409, create: { error: 'inProgress' } });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Vi har allerede fått denne bestillingen. Sjekk e-posten din'
    );
  });

  it('keeps one submission nonce across a step-4 remount, so a lost answer books once', async () => {
    // The nonce is half the create route's idempotency key, and the wizard
    // mounts ONE step at a time — so a nonce owned by `DetailsStep` dies every
    // time the visitor steps back. The case that costs a real appointment is a
    // lost RESPONSE: the engine commits the booking, the answer never arrives,
    // and a retry carrying a fresh nonce hashes to a fresh key and books the
    // child twice.
    const { bodies } = stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');

    // Back to step 3 and forward again — which unmounts and remounts step 4.
    await user.click(screen.getByRole('button', { name: 'Frisør og tid' }));
    await screen.findByRole('heading', { name: 'Når passer det?' });
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    const nonces = bodies.map((b) => (b as { submissionNonce?: string }).submissionNonce);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).toBeTruthy();
    expect(nonces[1]).toBe(nonces[0]);
  });

  it('confirms what was SUBMITTED, not what step 4 says by the time it answers', async () => {
    // The inputs stay editable while the create is in flight. Reading the live
    // machine afterwards meant a parent who corrected a child's name during a
    // slow request got Jonas's appointment in Medal and a screen — and a
    // calendar file — that both said Emma.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { bodies } = stubApi({ ...OPEN_AT_ONE, createHold: held });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.type(screen.getByLabelText('Hvem skal klippes?'), 'Jonas');
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    // Mid-flight, the parent changes their mind about the name.
    await user.clear(screen.getByLabelText('Hvem skal klippes?'));
    await user.type(screen.getByLabelText('Hvem skal klippes?'), 'Emma');
    release();

    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    // What Medal was told, and what the card says, are the same child.
    const sent = (bodies[0] as { items: Array<{ bookedForName?: string }> }).items[0];
    expect(sent.bookedForName).toBe('Jonas');
    expect(screen.getByText(/Jonas/)).toBeInTheDocument();
    expect(screen.queryByText(/Emma/)).toBeNull();
  });

  it('finishes a booking whose answer was lost, rather than making a second one', async () => {
    // The engine commits, the response never arrives, and reloading is the
    // visitor's only way out of a request that never ends. The wizard restarts
    // empty — and their own booking has by now taken their slot out of
    // availability, so they could not rebuild the same body even if they
    // remembered it. Resending the stored one under the stored nonce derives
    // the same key, so the engine replays its answer instead of booking again.
    window.sessionStorage.clear();
    const first = stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');

    // The reload: everything in memory goes, sessionStorage does not.
    view.unmount();
    const second = stubApi(OPEN_AT_ONE);
    renderWizard();

    // No gesture — the visitor is handed the outcome of what they already
    // pressed. It cannot double-book, which is what makes that safe.
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const nonceOf = (bodies: unknown[]) =>
      (bodies[0] as { submissionNonce?: string }).submissionNonce;
    expect(nonceOf(first.bodies)).toBeTruthy();
    // Same nonce AND same body: the two halves of the key the engine dedupes on.
    expect(nonceOf(second.bodies)).toBe(nonceOf(first.bodies));
    expect(second.bodies[0]).toEqual(first.bodies[0]);
  });

  it('keeps the manage links when the confirmation is refreshed', async () => {
    // The engine mints each manage token once and returns the plaintext exactly
    // once — it stores only a hash. So a refresh of this screen before the
    // parent has saved the calendar file used to take every manage link with
    // it, permanently, for a booking made without an e-mail address.
    window.sessionStorage.clear();
    stubApi({
      ...OPEN_AT_ONE,
      create: { bookings: [{ id: 'bk_1', manageToken: 'mt_test_1' }] },
    });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    expect(screen.getByRole('link', { name: /Endre eller avbestill/ })).toHaveAttribute(
      'href',
      '/bestill/administrer/mt_test_1'
    );

    // The refresh.
    view.unmount();
    const second = stubApi(OPEN_AT_ONE);
    renderWizard();

    expect(await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Endre eller avbestill/ })).toHaveAttribute(
      'href',
      '/bestill/administrer/mt_test_1'
    );
    // Restored, not re-fetched: a confirmed booking is not replayed.
    expect(second.bodies).toHaveLength(0);
  });

  it('discards a confirmation this tab still remembers when the link says «book again»', async () => {
    // Confirm a booking, then — within the one-hour restore window, in the
    // same tab — arrive from Min side's «Bestill igjen». The old card must not
    // hide the prefilled wizard; the link is the parent's answer.
    window.sessionStorage.clear();
    stubApi({
      ...OPEN_AT_ONE,
      create: { bookings: [{ id: 'bk_1', manageToken: 'mt_test_1' }] },
    });
    const user = userEvent.setup();
    const view = renderWizard();
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    view.unmount();

    location.search = `?service=${GUTTEKLIPP.id}`;
    stubApi();
    renderWizard();

    expect(screen.queryByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    // And it stays gone: a plain reload no longer restores it either.
    expect(JSON.stringify(window.sessionStorage)).not.toContain('mt_test_1');
  });

  it('lets a parent start another booking straight after confirming', async () => {
    // The confirmation is restored across a reload for an hour, so without a
    // way out a parent who has just booked one child and immediately needs a
    // separate appointment — a service whose `maxPerBooking` is 1, or a sibling
    // wanting a different hour — is stuck on this screen until the tab closes.
    window.sessionStorage.clear();
    const first = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const readsBeforeReset = first.urls.filter((url) => url.includes('/availability')).length;
    await user.click(screen.getByRole('button', { name: 'Bestill ny time' }));

    // An empty wizard, not a second confirmation.
    expect(await screen.findByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeNull();

    // And the openings are re-read, because the booking just made is not in the
    // ones already cached — they were fetched before it existed, so step 3
    // would otherwise offer the parent their own appointment back until
    // submitting it came back `slotTaken`.
    await pickGutteklipp(user);
    await takeFirstAvailable(user);
    await waitFor(() =>
      expect(first.urls.filter((url) => url.includes('/availability')).length).toBeGreaterThan(
        readsBeforeReset
      )
    );

    // The stored attempt is gone too, so a reload lands on the wizard rather
    // than restoring the booking they just finished.
    view.unmount();
    const second = stubApi(OPEN_AT_ONE);
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(second.bodies).toHaveLength(0);

    // And the second booking carries its own identity.
    const firstNonce = (first.bodies[0] as { submissionNonce?: string }).submissionNonce;
    expect(firstNonce).toBeTruthy();
    expect(window.sessionStorage.getItem('demo:booking:attempt')).not.toContain(
      firstNonce as string
    );
  });

  it('resends the SAME body when the visitor retries an ambiguous create', async () => {
    // The 502 copy asks them to press «Bekreft time» again, and that is only
    // safe while the body does not move: the route hashes the nonce AND the
    // body, so a name corrected in between is a different key — a second
    // appointment rather than a recovery of the first. Step 4 stays editable,
    // so the guarantee cannot live in a disabled field.
    window.sessionStorage.clear();
    const { bodies } = stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.type(screen.getByLabelText('Hvem skal klippes?'), 'Jonas');
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');

    // They change their mind about the name, then follow the advice.
    await user.clear(screen.getByLabelText('Hvem skal klippes?'));
    await user.type(screen.getByLabelText('Hvem skal klippes?'), 'Emma');
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    // Byte for byte the first submission — same nonce, same body, same key.
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('keeps an attempt whose replay is ALSO ambiguous', async () => {
    // Two 502s is still «we do not know»: either request may have committed.
    // Discarding here would let the visitor build a different booking, derive a
    // different key, and get a second appointment for a first that may exist.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');

    view.unmount();
    const second = stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    renderWizard();

    // The replay ran and was no more conclusive than the first try.
    await waitFor(() => expect(second.bodies).toHaveLength(1));
    // So the attempt survives, and a further reload will try again.
    await waitFor(() =>
      expect(window.sessionStorage.getItem('demo:booking:attempt')).toContain('pending')
    );
  });

  it('keeps the stylist on every line of a restored confirmation', async () => {
    // The names come from the stylist catalogue, which is fetched for the
    // basket's service — and a restored confirmation has no basket, so that
    // fetch never runs and every id would resolve to null. The card would lose
    // the stylist from every line the original card named.
    window.sessionStorage.clear();
    stubApi({
      slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] },
      create: { bookings: [{ id: 'bk_1', manageToken: 'mt_test_1' }] },
    });
    const user = userEvent.setup();
    const view = renderWizard();

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('radio', { name: /^Sara/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    expect(screen.getByText(/Sara/)).toBeInTheDocument();

    // The refresh keeps her.
    view.unmount();
    stubApi(OPEN_AT_ONE);
    renderWizard();
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    expect(screen.getByText(/Sara/)).toBeInTheDocument();
  });

  it('lands on a clean wizard when a REPLAY comes back refused', async () => {
    // A resumed page holds a submission and a snapshot, not a wizard — the
    // machine was never hydrated. So a `slotTaken` here would move an EMPTY
    // basket to step 3: no chips, no service to re-read openings for, and no
    // way forward. The booking did not happen and the visitor has to build
    // another one, so a clean wizard is the honest state.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');

    // The reload — and this time the replay finds the slot gone, because
    // somebody else took it while the visitor was stuck.
    view.unmount();
    const second = stubApi({
      ...OPEN_AT_ONE,
      createStatus: 409,
      create: { error: 'slotTaken' },
    });
    renderWizard();

    expect(await screen.findByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    // One replay and no more: the attempt is cleared, so a further reload does
    // not resend a submission that has now been answered.
    expect(second.bodies).toHaveLength(1);
    expect(window.sessionStorage.getItem('demo:booking:attempt')).toBeNull();
  });

  it('lands a «Bestill igjen» parent where the link pointed even when a replay is refused', async () => {
    // A pending attempt from an earlier visit in this tab, then the parent
    // arrives by a rebook link. The replay is owed and runs — and comes back
    // refused, which starts the wizard over. The link's answers have nothing
    // to do with that refusal, so they are applied again rather than lost.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');
    view.unmount();

    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stashRebookWho('Jonas');
    const second = stubApi({ ...OPEN_AT_ONE, createStatus: 409, create: { error: 'slotTaken' } });
    renderWizard();

    // The old attempt was replayed once and answered; the parent is on the
    // link's step 3 with Sara chosen, not on an empty step 1.
    await screen.findByRole('heading', { name: 'Når passer det?' });
    expect(second.bodies).toHaveLength(1);
    expect(window.sessionStorage.getItem('demo:booking:attempt')).toBeNull();
    // `findByText`, not `getByText`: the stylist and the hour are one screen, so
    // «Når passer det?» is on it from the moment the service is in the basket —
    // it no longer marks the arrival of the stylist list, and the summary bar
    // naming Sara is the first thing that does.
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
  });

  it('completes the stylist half after a late refusal, from the list fetched for the restarted basket', async () => {
    // The replay's `send` is the first render's closure, whose `resources` is
    // `[]` for ever; the refusal here is held until well after mount. The
    // stylist must come from the list the RESTARTED basket fetches, not from
    // anything that closure holds.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');
    view.unmount();

    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    let release!: () => void;
    const createHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = stubApi({
      ...OPEN_AT_ONE,
      createStatus: 409,
      create: { error: 'slotTaken' },
      createHold,
    });
    renderWizard();

    // The replay has left, and the wizard is held behind the restore gate's
    // skeleton while it is owed — not on a step 1 the answer would replace.
    await waitFor(() => expect(second.bodies).toHaveLength(1));
    expect(screen.getByTestId('restore-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hvem skal klippes?' })).toBeNull();
    release();

    // Not step 2 with «Første ledige»: Sara, from the list that has arrived.
    await screen.findByRole('heading', { name: 'Når passer det?' });
    // `findByText`, not `getByText`: the stylist and the hour are one screen, so
    // «Når passer det?» is on it from the moment the service is in the basket —
    // it no longer marks the arrival of the stylist list, and the summary bar
    // naming Sara is the first thing that does.
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
  });

  it('keeps the «Bestill igjen» link for after a replay that turns out to have SUCCEEDED', async () => {
    // The old attempt was in fact booked; its confirmation is shown first,
    // because it is real. «Bestill ny time» then starts the booking the link
    // asked for, rather than an empty wizard.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');
    view.unmount();

    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stashRebookWho('Jonas');
    stubApi({
      ...OPEN_AT_ONE,
      create: { bookings: [{ id: 'bk_old', manageToken: 'mt_test_old' }] },
    });
    renderWizard();

    await user.click(await screen.findByRole('button', { name: 'Bestill ny time' }));

    await screen.findByRole('heading', { name: 'Når passer det?' });
    // `findByText`, not `getByText`: the stylist and the hour are one screen, so
    // «Når passer det?» is on it from the moment the service is in the basket —
    // it no longer marks the arrival of the stylist list, and the summary bar
    // naming Sara is the first thing that does.
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
  });

  it('spends the link on the booking it was for — «Bestill ny time» after THAT is a clean wizard', async () => {
    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stashRebookWho('Jonas');
    stubApi({ ...OPEN_AT_ONE });
    const user = userEvent.setup();
    renderWizard();

    await screen.findByRole('heading', { name: 'Når passer det?' });
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await user.click(await screen.findByRole('button', { name: 'Bestill ny time' }));

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('holds the rebook wizard back while an old attempt is still unanswered, and keeps the link for after it', async () => {
    // Replay ambiguous again: step 4's «Bekreft time» will resend the OLD body
    // whatever is built, so a wizard prefilled from the link would let the
    // parent «book» the rebook they see while confirming somebody else's
    // appointment. The wizard is emptied until the old attempt is answered.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');
    view.unmount();

    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stashRebookWho('Jonas');
    const second = stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    renderWizard();

    await waitFor(() => expect(second.bodies).toHaveLength(1));
    // Not the link's step 3: an empty first step, with the old attempt owed.
    expect(await screen.findByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();

    // The retry, this time answered: it books the OLD appointment, shows its
    // confirmation — and only then does the link start the booking it was for.
    stubApi({
      ...OPEN_AT_ONE,
      create: { bookings: [{ id: 'bk_old', manageToken: 'mt_test_old' }] },
    });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await user.click(await screen.findByRole('button', { name: 'Bestill ny time' }));

    await screen.findByRole('heading', { name: 'Når passer det?' });
    // `findByText`, not `getByText`: the stylist and the hour are one screen, so
    // «Når passer det?» is on it from the moment the service is in the basket —
    // it no longer marks the arrival of the stylist list, and the summary bar
    // naming Sara is the first thing that does.
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
  });

  it('restores the rebook link when the retry of an old attempt is REFUSED', async () => {
    // Replay ambiguous, the parent builds a throwaway wizard to reach
    // «Bekreft time», and the resend of the old body comes back `slotTaken`.
    // That refusal belongs to the old attempt, not to the throwaway basket:
    // the link's booking starts, on its own step 3.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('alert');
    view.unmount();

    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stashRebookWho('Jonas');
    const second = stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: {} });
    renderWizard();
    await waitFor(() => expect(second.bodies).toHaveLength(1));

    const third = stubApi({ ...OPEN_AT_ONE, createStatus: 409, create: { error: 'slotTaken' } });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    await screen.findByRole('heading', { name: 'Når passer det?' });
    expect(third.bodies).toHaveLength(1);
    expect(window.sessionStorage.getItem('demo:booking:attempt')).toBeNull();
    // `findByText`, not `getByText`: the stylist and the hour are one screen, so
    // «Når passer det?» is on it from the moment the service is in the basket —
    // it no longer marks the arrival of the stylist list, and the summary bar
    // naming Sara is the first thing that does.
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
  });

  it('does not replay a submission the engine already refused', async () => {
    // A slot that went, or a body that was rejected, is an ANSWER — no
    // appointment was made and the visitor is about to build a different one.
    // Replaying it on the next load would resend a «Bekreft time» nobody
    // pressed.
    window.sessionStorage.clear();
    stubApi({ ...OPEN_AT_ONE, createStatus: 409, create: { error: 'slotTaken' } });
    const user = userEvent.setup();
    const view = renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    view.unmount();
    const second = stubApi(OPEN_AT_ONE);
    renderWizard();

    // Step 1, not a confirmation and not a POST.
    expect(await screen.findByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(second.bodies).toHaveLength(0);
  });

  it('mints a fresh nonce for the next booking, so a sibling is not a replay of the first', async () => {
    // This assertion used to read
    // `sessionStorage.getItem('demo:booking:submission-nonce')` — a key
    // nothing has ever written (the store's real key is
    // `demo:booking:attempt`, and the nonce is shell state, not storage).
    // `getItem` therefore returned null however the wizard behaved, so the
    // test passed against a wizard that reused one nonce forever, which is the
    // precise bug its title names: the second child's booking would be
    // swallowed as an idempotent replay of the first and never reach the salon.
    //
    // Asserted end to end instead — two real submissions, two different
    // nonces — which is the property that actually matters and is now
    // reachable through «Bestill ny time».
    window.sessionStorage.clear();
    const { bodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    await user.click(screen.getByRole('button', { name: 'Bestill ny time' }));
    await screen.findByRole('heading', { name: 'Hvem skal klippes?' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const nonces = bodies.map((body) => (body as { submissionNonce?: string }).submissionNonce);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).toBeTruthy();
    expect(nonces[1]).toBeTruthy();
    expect(nonces[1]).not.toBe(nonces[0]);
  });

  it('sends a stolen slot back to step 3 with the day it was lost from', async () => {
    stubApi({ ...OPEN_AT_ONE, createStatus: 409, create: { error: 'slotTaken' } });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    // Waited for rather than found once: the skeleton's heading is replaced by
    // the real step's when the re-read lands.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument()
    );
    // A toast, up from the moment the slot is lost — through the re-read of the
    // openings as well, which is when the visitor most needs telling.
    const toast = (await screen.findByText(/Oi, den ble nettopp tatt/)).closest('[role="status"]');
    expect(toast).toHaveClass('fixed');
  });

  it('after a stolen slot, scrolls to and focuses the TIMES, and keeps one toast throughout', async () => {
    // The alternatives are on the time half of step 2, so that is where the
    // parent is sent — not to «Hvem vil du gå til?» above it. The re-read of the
    // openings is held so the skeleton phase can be looked at.
    let availabilityCalls = 0;
    let releaseReread = () => {};
    const reread = new Promise<void>((resolve) => {
      releaseReread = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
        if (pathname.startsWith('/api/booking/availability')) {
          availabilityCalls += 1;
          if (availabilityCalls > 1) await reread;
          return ok({ slots: [slot(2, 13, SARA.id), slot(2, 14, SARA.id)] });
        }
        if (pathname.startsWith('/api/booking/resources')) return ok({ resources: [SARA] });
        if (pathname.startsWith('/api/booking/schedule')) return ok({ days: AN_OPEN_WEEK });
        return { ok: false, status: 409, json: async () => ({ error: 'slotTaken' }) };
      })
    );
    const scrolled: Element[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    scrolled.length = 0;
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    // The skeleton, with its heading focused and scrolled to.
    const skeletonHeading = await screen.findByRole('heading', { name: 'Når passer det?' });
    await waitFor(() => expect(skeletonHeading).toHaveFocus());
    expect(scrolled.map((element) => element.id)).toContain('booking-time-heading');
    const toast = screen.getByText(/Oi, den ble nettopp tatt/).closest('[role="status"]');

    releaseReread();
    // The real step replaces the skeleton; focus follows to ITS heading, and the
    // toast is the very same live region, not a second announcement.
    await screen.findByRole('button', { name: /14:00/ });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Når passer det?' })).toHaveFocus()
    );
    expect(screen.getByRole('heading', { name: 'Når passer det?' })).not.toBe(skeletonHeading);
    expect(screen.getByText(/Oi, den ble nettopp tatt/).closest('[role="status"]')).toBe(toast);
  });

  it('re-reads the openings after a stolen slot, so the loop cannot start', async () => {
    // The rescue screen used to offer the very slot that had just been refused.
    // Its openings were read BEFORE the clash, so the taken instant was still
    // in them — and «nærmeste alternativer» ranks it first, because its
    // distance from the taken time is zero. Tap the top suggestion, lose again,
    // repeat.
    let availabilityCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
        if (pathname.startsWith('/api/booking/availability')) {
          availabilityCalls += 1;
          // Somebody else took 13:00 between the read and the submit, so the
          // second read no longer offers it.
          return ok({
            slots: availabilityCalls === 1 ? [slot(2, 13, SARA.id)] : [slot(2, 13, SARA.id, 30)],
          });
        }
        if (pathname.startsWith('/api/booking/resources')) return ok({ resources: [SARA] });
        if (pathname.startsWith('/api/booking/schedule')) return ok({ days: AN_OPEN_WEEK });
        if (pathname.startsWith('/api/booking/create')) {
          return { ok: false, status: 409, json: async () => ({ error: 'slotTaken' }) };
        }
        return ok({});
      })
    );
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    await screen.findByRole('heading', { name: 'Når passer det?' });
    // Matched loosely: the chip's accessible name carries «nærmeste
    // alternativ» alongside the time.
    expect(await screen.findByRole('button', { name: /13:30/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /13:00/ })).toBeNull();
    expect(availabilityCalls).toBeGreaterThan(1);
  });

  /**
   * The ordinary path now: the 409 carries what is free NOW, read live on the
   * server, so the time step is redrawn from it and nothing is fetched. (There
   * is no public way to skip the server's cache, so a re-read could still be
   * served the stale entry that offered the lost slot.)
   */
  it('redraws the time step from the slotTaken’s fresh slots, with no follow-up request', async () => {
    const { urls, bodies } = stubApi({
      ...OPEN_AT_ONE,
      createStatus: 409,
      create: { error: 'slotTaken', freshSlots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id, 30)] } },
    });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    const sentAt = urls.length;

    await screen.findByRole('heading', { name: 'Når passer det?' });
    expect((await screen.findAllByRole('button', { name: /13:30/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /13:00/ })).toBeNull();
    // Give any effect the chance to fire a request it should not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(urls.slice(sentAt)).toEqual([]);
    expect(urls.some((url) => url.includes('fresh='))).toBe(false);
    // The window the route re-reads over is the wizard's own.
    expect((bodies[0] as { window?: unknown }).window).toEqual({
      fromTs: NOW,
      toTs: Date.parse('2026-09-09T00:00:00+02:00'),
    });
  });

  it('falls back to an ordinary read when the slotTaken carries no fresh slots', async () => {
    const { urls } = stubApi({ ...OPEN_AT_ONE, createStatus: 409, create: { error: 'slotTaken' } });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    const before = urls.filter((url) => url.startsWith('/api/booking/availability')).length;
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    await waitFor(() =>
      expect(urls.filter((url) => url.startsWith('/api/booking/availability')).length).toBe(
        before + 1
      )
    );
    expect(urls.some((url) => url.includes('fresh='))).toBe(false);
  });

  it('keeps the visitor on step 4 when the timebook simply did not answer', async () => {
    // `upstreamError` is a code the machine's union always admitted and no
    // action could produce. Leaving `details` would also throw away the slot
    // they chose, for a failure that is ours rather than theirs.
    stubApi({ ...OPEN_AT_ONE, createStatus: 502, create: { error: 'upstreamError' } });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    // Ambiguous on purpose — see `ERROR_COPY`. The booking may well exist.
    expect(await screen.findByRole('alert')).toHaveTextContent('Vi vet ikke om timen ble satt opp');
    expect(screen.getByRole('heading', { name: 'Nesten ferdig!' })).toBeInTheDocument();
  });

  it('treats a 201 with no booking in it as a failure rather than a confirmation', async () => {
    stubApi({ ...OPEN_AT_ONE, create: { bookings: [] } });
    const user = userEvent.setup();
    renderWizard();

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('timeboken svarte ikke');
    expect(screen.queryByRole('heading', { name: 'Timen er bekreftet! 🎉' })).toBeNull();
  });
});

describe('BookingWizard without a telephone number', () => {
  it('renders every dead end unlinked, because a tel: that dials nothing fails in the hand', async () => {
    // `null` is the live case: the number is not on the Sanity `site` document
    // yet, and this is the state the site actually ships in today.
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(4, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard({ phone: null });

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    const fullyBooked = await screen.findByText(/Fullt i dag/);
    expect(fullyBooked).toHaveTextContent('Fullt i dag – ring oss, så finner vi en tid.');
    expect(within(fullyBooked).queryByRole('link')).toBeNull();
  });

  it('links the number when there is one', async () => {
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(4, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard({ phone: '22 33 44 55' });

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    const link = await screen.findByRole('link', { name: 'Ring oss på 22 33 44 55' });
    expect(link).toHaveAttribute('href', 'tel:22334455');
  });
});

describe('BookingWizard prefetch', () => {
  it('uses the slots the page already fetched instead of asking again', async () => {
    // The page prefetches the kids' menu so step 3 is drawn rather than fetched.
    // A seed the shell ignored would be one wasted round trip on the server and
    // a spinner in front of the visitor anyway.
    const { urls } = stubApi();
    const user = userEvent.setup();
    renderWizard({ initialSlots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    expect(await screen.findByRole('button', { name: '13:00' })).toBeInTheDocument();
    await waitFor(() =>
      expect(urls.some((url) => url.startsWith('/api/booking/resources'))).toBe(true)
    );
    expect(urls.filter((url) => url.startsWith('/api/booking/availability'))).toEqual([]);
  });

  /**
   * The page also hands down the stylists, their «Neste ledige» and the hours
   * for the services it prefetched. Step 2 then lands with the list on it
   * instead of popping it in above the time grid, and nothing is fetched.
   */
  const SEEDED = {
    initialSlots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] },
    initialResources: [SARA, MARCUS],
    initialNextAvailable: { [GUTTEKLIPP.id]: { [SARA.id]: osloTs(3, 9) } },
    initialSchedule: { [GUTTEKLIPP.id]: AN_OPEN_WEEK },
  };

  /**
   * A lost slot means the seeded «Neste ledige» was read before the clash too.
   * With fresh slots on the 409 it is recomputed from them, and nothing is
   * read — otherwise Sara's card keeps promising an hour just refused.
   */
  it('recomputes «Neste ledige» from the slotTaken’s fresh slots, without a request', async () => {
    const { urls } = stubApi({
      createStatus: 409,
      create: { error: 'slotTaken', freshSlots: { [GUTTEKLIPP.id]: [slot(3, 11, SARA.id)] } },
    });
    const user = userEvent.setup();
    renderWizard(SEEDED);

    await pickGutteklipp(user);
    expect(screen.getByText(nextAvailableRow('Neste ledige: i morgen 09:00'))).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    expect(
      await screen.findByText(nextAvailableRow('Neste ledige: i morgen 11:00'))
    ).toBeInTheDocument();
    expect(screen.queryByText(nextAvailableRow('Neste ledige: i morgen 09:00'))).toBeNull();
    expect(urls.filter((url) => !url.startsWith('/api/booking/create'))).toEqual([]);
  });

  it('re-reads «Neste ledige» once, the ordinary way, when the 409 carries no fresh slots', async () => {
    const { urls } = stubApi({
      createStatus: 409,
      create: { error: 'slotTaken' },
      resources: { resources: [SARA, MARCUS], nextAvailableTs: { [SARA.id]: osloTs(3, 11) } },
    });
    const user = userEvent.setup();
    renderWizard(SEEDED);

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '40000000');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    expect(
      await screen.findByText(nextAvailableRow('Neste ledige: i morgen 11:00'))
    ).toBeInTheDocument();
    const reads = urls.filter((url) => url.startsWith('/api/booking/resources'));
    expect(reads).toHaveLength(1);
    expect(new URL(reads[0], 'https://example.test').searchParams.get('fresh')).toBeNull();
  });

  it('asks for neither the stylists nor the hours when the page already sent them', async () => {
    const { urls } = stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    await pickGutteklipp(user);

    // Present on the very first render of step 2, not after a round trip.
    expect(screen.getByRole('radio', { name: /Sara/ })).toBeInTheDocument();
    expect(screen.getByText(nextAvailableRow('Neste ledige: i morgen 09:00'))).toBeInTheDocument();

    await takeFirstAvailable(user);
    expect(await screen.findByRole('button', { name: '13:00' })).toBeInTheDocument();
    expect(urls).toEqual([]);
  });

  it('judges a seeded day by the seeded hours', async () => {
    // Today open and nothing free: «Fullt» is only said with the salon's hours
    // in hand, so seeing it proves the seed reached step 3 without a fetch.
    const { urls } = stubApi();
    const user = userEvent.setup();
    renderWizard({ ...SEEDED, initialSlots: { [GUTTEKLIPP.id]: [slot(3, 13, SARA.id)] } });

    await pickGutteklipp(user);
    await takeFirstAvailable(user);

    expect(await screen.findByText(/Fullt/)).toBeInTheDocument();
    expect(urls.filter((url) => url.startsWith('/api/booking/schedule'))).toEqual([]);
  });

  it('still fetches both for a service the page did not prefetch', async () => {
    const { urls } = stubApi({
      resources: { resources: [SARA, MARCUS], nextAvailableTs: { [MARCUS.id]: osloTs(3, 10) } },
    });
    const user = userEvent.setup();
    renderWizard(SEEDED);

    await chooseOneChild(user);
    await user.click(screen.getByRole('button', { name: /Jenteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });

    expect(
      await screen.findByText(nextAvailableRow('Neste ledige: i morgen 10:00'))
    ).toBeInTheDocument();
    // Not Gutteklipp's line for Sara, carried over to a service it was not
    // computed for.
    expect(screen.queryByText(nextAvailableRow('Neste ledige: i morgen 09:00'))).toBeNull();
    await waitFor(() => {
      expect(urls.some((url) => url.startsWith('/api/booking/resources'))).toBe(true);
      expect(urls.some((url) => url.startsWith('/api/booking/schedule'))).toBe(true);
    });
  });
});

/**
 * `/bestill?service=&stylist=` plus the child's name in the tab's session
 * store — the «Bestill igjen» card on `/min-side`.
 *
 * The rules are the machine's and are proved in `wizard-machine.test.ts`; what
 * is proved here is that the address bar reaches the machine, that the half of
 * the catalogue the machine cannot see (`bookableOnline`, the fetched stylist
 * list) is applied by the shell, and that the visitor lands where the link
 * pointed with nothing to do but pick a time.
 */
describe('BookingWizard prefill from a «Bestill igjen» link', () => {
  it('opens on step 2 when the link names a service', async () => {
    location.search = `?service=${GUTTEKLIPP.id}`;
    stubApi();
    renderWizard();

    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('lands on step 3 with the stylist chosen and the child named, once the list vouches for them', async () => {
    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stashRebookWho('Jonas');
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard();

    // Step 2 until the stylists land — the shell cannot vouch for Sara before
    // it has been told who Sara is.
    await screen.findByRole('heading', { name: 'Når passer det?' });
    // `findByText`, not `getByText`: the stylist and the hour are one screen, so
    // «Når passer det?» is on it from the moment the service is in the basket —
    // it no longer marks the arrival of the stylist list, and the summary bar
    // naming Sara is the first thing that does.
    expect(
      await screen.findByText(`Gutteklipp · Sara · Velg tid · 490${NBSP}kr`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
  });

  it("takes the child's name from the session store once, and never from the URL", async () => {
    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}&who=Pasted`;
    stashRebookWho('Jonas');
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard();

    await screen.findByRole('heading', { name: 'Når passer det?' });
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Hvem skal klippes?')).toHaveValue('Jonas');
    // Read once: nothing is left for a later, unrelated visit in this tab.
    expect(takeRebookWho()).toBeNull();
  });

  it('ignores a stylist who cannot do the service, and asks on step 2 as usual', async () => {
    location.search = `?service=${GUTTEKLIPP.id}&stylist=${MARCUS.id}`;
    stubApi({ resources: { resources: [SARA, { ...MARCUS, serviceIds: [JENTEKLIPP.id] }] } });
    renderWizard();

    // Wait for the list, so the assertion is about a stylist REFUSED and not
    // one that merely has not arrived yet.
    await screen.findByRole('radio', { name: /Sara/ });
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('ignores a stylist the salon no longer has', async () => {
    location.search = `?service=${GUTTEKLIPP.id}&stylist=res-left-last-year`;
    stubApi();
    renderWizard();

    await screen.findByRole('radio', { name: /Sara/ });
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
  });

  it('degrades to the ordinary wizard on a service id the catalogue does not have', async () => {
    location.search = '?service=svc-renamed&stylist=res-sara';
    stashRebookWho('Jonas');
    stubApi();
    renderWizard();

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('will not put a telephone-only service in the basket, whatever the link says', async () => {
    // Step 1 renders a service the salon takes by telephone as «Ring oss for
    // denne» rather than as a card, and a link must not do what a tap cannot.
    const BY_PHONE: BookingServiceDto = { ...GUTTEKLIPP, id: 'svc-tel', bookableOnline: false };
    location.search = `?service=${BY_PHONE.id}`;
    stubApi();
    renderWizard({ services: [GUTTEKLIPP, BY_PHONE] });

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('does not re-read the link once the visitor has started over', async () => {
    location.search = `?service=${GUTTEKLIPP.id}&stylist=${SARA.id}`;
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard();

    await screen.findByRole('heading', { name: 'Når passer det?' });
    // Back to step 1 through the dots and pick something else: the link is
    // spent, and the wizard is the visitor's from here on.
    await user.click(screen.getByRole('button', { name: 'Hva' }));
    await chooseOneChild(user);
    await user.click(screen.getByRole('button', { name: /Jenteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await screen.findByRole('radio', { name: /Sara/ });

    expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});

/**
 * The three steps the design draws, walked end to end.
 *
 * The order IS the feature here: «Hva og hvem», then the stylist and the hour
 * on one screen, then «Bekreft». There is no login step between the hour and
 * the form any more — the login is a sheet offered on the first and last
 * screens. The header names the step the parent is on, and every segment
 * behind it is a way back.
 */
describe('BookingWizard step order', () => {
  const OPEN_AT_ONE = { slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } };

  it('walks Hvem → Hva → Frisør og tid → Bekreft', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByText('Steg 1 av 4 · Hvem')).toBeInTheDocument();
    await chooseOneChild(user);
    expect(screen.getByText('Steg 2 av 4 · Hva')).toBeInTheDocument();

    await pickGutteklipp(user);
    expect(screen.getByText('Steg 3 av 4 · Frisør og tid')).toBeInTheDocument();
    // One screen, both questions — the frames call it «Frisør og tid».
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument()
    );

    // The hour is the last question before the form: one tap, no login between.
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByText('Steg 4 av 4 · Bekreft')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nesten ferdig. Hvem er du?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fortsett uten å logge inn' })).toBeNull();
  });

  it('goes back a step at a time on the arrow, and further on the segments', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    await user.click(screen.getByRole('button', { name: 'Tilbake til Frisør og tid' }));
    expect(screen.getByText('Steg 3 av 4 · Frisør og tid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hva' }));
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tilbake til Hvem' }));
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    // The chair that was chosen is still chosen.
    expect(screen.getByRole('radio', { name: '1 barn' })).toHaveAttribute('aria-checked', 'true');
    // Nothing precedes step 1, so there is no arrow to press.
    expect(screen.queryByRole('button', { name: /^Tilbake til/ })).toBeNull();
  });

  it('will not let a segment skip a step that has not been answered', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    // An empty wizard: everything past step 1 is closed.
    expect(screen.getByRole('button', { name: 'Hva' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Frisør og tid' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bekreft' })).toBeDisabled();

    await pickGutteklipp(user);
    // The hour is what settles step 2, so «Bekreft» stays shut until one is taken.
    expect(screen.getByRole('button', { name: 'Bekreft' })).toBeDisabled();

    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    // Four segments, four steps.
    expect(
      within(screen.getByRole('list', { name: 'Fremdrift' })).getAllByRole('button')
    ).toHaveLength(4);
  });
});

/**
 * A parent who arrives holding a Min side cookie.
 *
 * The page reads the profile on the server and hands down `guardian`; what the
 * wizard owes them is that step 3 stops asking and step 4 arrives filled in —
 * and that a parent who has typed something of their own keeps it.
 */
describe('BookingWizard with a logged-in parent', () => {
  const KARI = {
    firstName: 'Kari',
    lastName: 'Nordmann',
    email: 'kari@example.com',
    phone: '+47 400 00 000',
    family: [{ name: 'Jonas', birthYear: 2018 }],
  };

  const OPEN_AT_ONE = { slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } };

  /** Step 1 for a known parent: tick the child's card, then «Neste». */
  async function tickJonas(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
  }

  it('offers no login, and fills «Bekreft» in from the profile', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ guardian: KARI });

    // Already known: nothing to offer on the first screen…
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    // …nor on the form.
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();

    // National digits, because the field renders its own «+47» beside them.
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    expect(screen.getByLabelText('Ditt navn')).toHaveValue('Kari Nordmann');
    expect(screen.getByLabelText('E-post')).toHaveValue('kari@example.com');
  });

  it('offers the children on the profile as cards on step 1, and books the one ticked', async () => {
    const { bodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ guardian: { ...KARI, family: [{ ...KARI.family[0], personId: 'p-jonas' }] } });

    // No count chips for a known parent: their children, and themselves.
    expect(screen.queryByRole('radio', { name: '1 barn' })).toBeNull();
    const card = screen.getByRole('checkbox', { name: /Jonas/ });
    // Born 2018, no month: seven or eight on 2 September 2026.
    expect(card.closest('label')).toHaveTextContent('7–8 år');
    expect(card).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Meg selv \(voksen\)/ })).toBeInTheDocument();
    // Nothing ticked, nothing to go on with.
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();

    await user.click(card);
    expect(card).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    // Step 1 said who: «Bekreft» says it back and asks nothing about the child.
    expect(screen.queryByLabelText('Hvem skal klippes?')).toBeNull();
    expect(screen.getByRole('list', { name: 'Hvem som skal klippes' })).toHaveTextContent(
      'Gutteklipp for Jonas'
    );

    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const submitted = bodies[0] as {
      items: Array<{ bookedForName?: string; bookedForBirthYear?: number }>;
    };
    // By id — the number in the form is Kari's own, so Medal will find her and
    // her child — and by name and year as well, as every booking has been.
    expect(submitted.items[0]).toMatchObject({
      bookedForName: 'Jonas',
      bookedForBirthYear: 2018,
      bookedForPersonId: 'p-jonas',
    });
  });

  it('drops the child’s id when the number in the form is no longer the parent’s', async () => {
    const { bodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ guardian: { ...KARI, family: [{ ...KARI.family[0], personId: 'p-jonas' }] } });

    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    // Booking for Jonas under grandma's number: Medal would find grandma.
    await user.clear(screen.getByLabelText('Mobilnummer'));
    await user.type(screen.getByLabelText('Mobilnummer'), '99887766');
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const item = (bodies[0] as { items: Array<Record<string, unknown>> }).items[0];
    expect(item).not.toHaveProperty('bookedForPersonId');
    expect(item).toMatchObject({ bookedForName: 'Jonas', bookedForBirthYear: 2018 });
  });

  /**
   * A shared device. One parent's session lapses mid-booking, a second logs in
   * on step 3 — and a rule that only filled BLANKS would send the second
   * parent's booking off under the first one's name, number and address.
   */
  it('replaces the details of a parent who has been replaced', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    const { rerender } = renderWizard({ guardian: KARI });
    const wizard = (guardian: typeof KARI | null) => (
      <BookingWizard
        services={[GUTTEKLIPP, JENTEKLIPP, HULL_I_ORENE]}
        phone="22 33 44 55"
        rangeStart={NOW}
        rangeDays={7}
        guardian={guardian}
      />
    );

    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByLabelText('Ditt navn')).toHaveValue('Kari Nordmann');

    // Kari's session lapses, and Ola logs in on the same tab.
    rerender(wizard(null));
    rerender(
      wizard({
        firstName: 'Ola',
        lastName: 'Hansen',
        email: 'ola@example.com',
        phone: '+47 900 00 000',
        family: [],
      })
    );

    expect(screen.getByLabelText('Ditt navn')).toHaveValue('Ola Hansen');
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('90000000');
    expect(screen.getByLabelText('E-post')).toHaveValue('ola@example.com');
  });

  it('adds a child from step 1 in Medal, and ticks them once they exist', async () => {
    const { personBodies } = stubApi({
      ...OPEN_AT_ONE,
      persons: {
        status: 201,
        body: {
          ok: true,
          child: { name: 'Mia', birthYear: 2021, birthMonth: 4, personId: 'p-mia' },
        },
      },
    });
    const user = userEvent.setup();
    renderWizard({ guardian: KARI });

    await user.click(screen.getByRole('button', { name: 'Legg til barn' }));
    const sheet = await screen.findByRole('dialog', { name: 'Legg til barn' });
    await user.type(within(sheet).getByLabelText('Navn'), 'Mia');
    await user.selectOptions(within(sheet).getByLabelText('Fødselsår'), '2021');
    await user.selectOptions(within(sheet).getByLabelText('Fødselsmåned (valgfritt)'), '4');
    await user.type(within(sheet).getByLabelText('Notat til frisøren (valgfritt)'), 'Første klipp');
    await user.click(within(sheet).getByRole('button', { name: 'Legg til' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(personBodies).toEqual([
      { name: 'Mia', birthYear: 2021, birthMonth: 4, notes: 'Første klipp' },
    ]);
    // Born April 2021: five on 2 September 2026, exactly — the month is known.
    const card = screen.getByRole('checkbox', { name: /Mia/ });
    expect(card.closest('label')).toHaveTextContent('5 år');
    expect(card).toBeChecked();
    expect(screen.getByRole('button', { name: 'Neste' })).toBeEnabled();
  });

  it('keeps the sheet open with the reason when Medal could not add the child', async () => {
    stubApi({
      ...OPEN_AT_ONE,
      persons: {
        status: 400,
        body: { ok: false, reason: 'invalid', message: 'Dette barnet er allerede lagt inn.' },
      },
    });
    const user = userEvent.setup();
    renderWizard({ guardian: KARI });

    await user.click(screen.getByRole('button', { name: 'Legg til barn' }));
    const sheet = await screen.findByRole('dialog', { name: 'Legg til barn' });
    await user.type(within(sheet).getByLabelText('Navn'), 'Jonas');
    await user.selectOptions(within(sheet).getByLabelText('Fødselsår'), '2018');
    await user.click(within(sheet).getByRole('button', { name: 'Legg til' }));

    expect(
      await within(sheet).findByText('Dette barnet er allerede lagt inn.')
    ).toBeInTheDocument();
    // Still open, still holding what was typed: nothing was added.
    expect(screen.getByRole('dialog', { name: 'Legg til barn' })).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Navn')).toHaveValue('Jonas');
  });

  it('books the parent themselves as a grown-up, with no child fields on «Bekreft»', async () => {
    stubApi({ slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } });
    const user = userEvent.setup();
    renderWizard({ guardian: KARI });

    await user.click(screen.getByRole('checkbox', { name: /Meg selv \(voksen\)/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    expect(screen.queryByLabelText('Hvem skal klippes?')).toBeNull();
    expect(screen.getByRole('list', { name: 'Hvem som skal klippes' })).toHaveTextContent(
      'Gutteklipp for deg'
    );
  });

  it('offers a way on — not a dead end — when «Meg selv» cannot join the children', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ guardian: KARI });

    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('checkbox', { name: /Meg selv \(voksen\)/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));

    // Medal takes an adult cut one per booking: it cannot ride with Jonas'.
    expect(
      await screen.findByText(
        'Meg selv kan ikke bookes sammen med barna – voksenklipp er en egen time.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Ta bort Meg selv fra denne timen' }));
    // Jonas alone: the one-tap service list, and on to the time.
    await pickGutteklipp(user);
    expect(await screen.findByRole('button', { name: '13:00' })).toBeInTheDocument();
  });

  it('starts a ticked child on «Samme som sist» — their last haircut, one tap', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({
      guardian: {
        ...KARI,
        family: [
          {
            name: 'Jonas',
            birthYear: 2018,
            personId: 'p-jonas',
            lastVisit: {
              serviceId: GUTTEKLIPP.id,
              serviceName: 'Gutteklipp',
              resourceId: SARA.id,
              startTs: Date.parse('2026-08-12T10:00:00+02:00'),
            },
          },
        ],
      },
    });

    // The card says when, and what.
    expect(screen.getByRole('checkbox', { name: /Jonas/ }).closest('label')).toHaveTextContent(
      /7–8 år · Sist: Gutteklipp, /
    );
    await tickJonas(user);

    const same = screen.getByRole('button', { name: /Samme som sist/ });
    expect(same).toHaveTextContent('Gutteklipp');
    // Prefilled: already the answer, so «Neste» is open without a tap.
    expect(same).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Neste' })).toBeEnabled();
    expect(screen.getByText('Velg noe annet')).toBeInTheDocument();

    await user.click(same);
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
  });

  it('prefills each child of a family from their own last visit', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    const visit = (serviceId: string) => ({
      serviceId,
      serviceName: null,
      resourceId: null,
      startTs: Date.parse('2026-08-12T10:00:00+02:00'),
    });
    renderWizard({
      guardian: {
        ...KARI,
        family: [
          { name: 'Jonas', birthYear: 2018, personId: 'p-jonas', lastVisit: visit(GUTTEKLIPP.id) },
          { name: 'Emma', birthYear: 2020, personId: 'p-emma', lastVisit: visit(JENTEKLIPP.id) },
        ],
      },
    });

    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('checkbox', { name: /Emma/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });

    const [jonas, emma] = screen.getAllByRole('button', { name: /Samme som sist/ });
    expect(jonas).toHaveTextContent('Gutteklipp');
    expect(emma).toHaveTextContent('Jenteklipp');
    expect(screen.getByText(/2 tjenester/)).toBeInTheDocument();

    // «Velg noe annet» opens that child's menu, and only theirs.
    await user.click(screen.getAllByRole('button', { name: 'Velg noe annet' })[1]);
    await user.click(
      within(screen.getByRole('list', { name: /Tjenester for Emma/ })).getByRole('button', {
        name: /Gutteklipp/,
      })
    );
    expect(emma).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
  });

  it('seats the saved child a «Bestill for Jonas» tap on Min side named', async () => {
    location.search = `?service=${GUTTEKLIPP.id}`;
    stashRebookWho('Jonas');
    const { bodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ guardian: { ...KARI, family: [{ ...KARI.family[0], personId: 'p-jonas' }] } });

    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    // Seated by id, so «Bekreft» says who rather than asking.
    expect(screen.getByRole('list', { name: 'Hvem som skal klippes' })).toHaveTextContent(
      'Gutteklipp for Jonas'
    );
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    expect((bodies[0] as { items: unknown[] }).items[0]).toMatchObject({ bookedForName: 'Jonas' });
  });

  it('swaps «Samme som sist» for a child who has outgrown it, and moves what is not for their age below a divider', async () => {
    const BARNEHAGEKLIPP = { ...GUTTEKLIPP, id: 'svc-bhg', name: 'Barnehageklipp', ageMaxYears: 6 };
    const BARNEKLIPP = { ...GUTTEKLIPP, id: 'svc-barn', name: 'Barneklipp', ageMinYears: 7 };
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({
      services: [BARNEHAGEKLIPP, BARNEKLIPP, HULL_I_ORENE],
      guardian: {
        ...KARI,
        family: [
          {
            name: 'Jonas',
            // Born March 2019: seven on 2 September 2026, exactly.
            birthYear: 2019,
            birthMonth: 3,
            personId: 'p-jonas',
            lastVisit: {
              serviceId: BARNEHAGEKLIPP.id,
              serviceName: 'Barnehageklipp',
              resourceId: null,
              startTs: Date.parse('2026-02-12T10:00:00+01:00'),
            },
          },
        ],
      },
    });

    expect(screen.getByRole('checkbox', { name: /Jonas/ }).closest('label')).toHaveTextContent(
      '7 år'
    );
    await tickJonas(user);

    const same = screen.getByRole('button', { name: /Samme som sist/ });
    expect(same).toHaveTextContent('Barneklipp');
    expect(same).not.toHaveTextContent('Barnehageklipp');
    expect(
      screen.getByText('Sist: Barnehageklipp. Jonas har vokst fra den, så vi foreslår Barneklipp.')
    ).toBeInTheDocument();
    // Suggested against, never refused: below the divider, still one tap.
    const unlikely = screen.getByRole('list', { name: "Passer vanligvis ikke for Jonas' alder" });
    expect(within(unlikely).getByRole('button', { name: /^Barnehageklipp/ })).toBeInTheDocument();
    expect(within(unlikely).queryByRole('button', { name: /^Barneklipp/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Hull i ørene/ })).toBeInTheDocument();
    await user.click(within(unlikely).getByRole('button', { name: /^Barnehageklipp/ }));
    expect(await screen.findByText(/Barnehageklipp/, { selector: 'p, span' })).toBeInTheDocument();
  });

  it('takes three at most, and says so', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({
      guardian: {
        ...KARI,
        family: ['Jonas', 'Emma', 'Theo', 'Ida'].map((name, index) => ({
          name,
          birthYear: 2016 + index,
          personId: `p-${name}`,
        })),
      },
    });

    for (const name of ['Jonas', 'Emma', 'Theo']) {
      await user.click(screen.getByRole('checkbox', { name: new RegExp(name) }));
    }

    // Inert and announced, but still in the tab order.
    const ida = screen.getByRole('checkbox', { name: /Ida/ });
    expect(ida).toHaveAttribute('aria-disabled', 'true');
    expect(ida).toHaveAccessibleDescription('Vi tar opptil tre i samme booking.');
    await user.click(ida);
    expect(ida).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Meg selv/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('button', { name: /Legg til barn/ })).toBeDisabled();
    expect(screen.getByText('Vi tar opptil tre i samme booking.')).toBeInTheDocument();
  });

  it('never overwrites a number the parent typed themselves', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    const { rerender } = renderWizard();

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '99887766');

    rerender(
      <BookingWizard
        services={[GUTTEKLIPP, JENTEKLIPP, HULL_I_ORENE]}
        phone="22 33 44 55"
        rangeStart={NOW}
        rangeDays={7}
        guardian={KARI}
      />
    );

    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('99887766');
    // The blank fields are still filled in: «fills blanks, never overwrites».
    expect(screen.getByLabelText('Ditt navn')).toHaveValue('Kari Nordmann');
  });
});

/**
 * The login sheet, from the wizard's side.
 *
 * Offered on the first screen and on «Bekreft», never between the hour and the
 * form. What the wizard owes a parent who takes it is the same as it owes one
 * who ARRIVED logged in — the fields and the children filled in — without a
 * `router.refresh()` re-rendering the whole booking page to learn who they
 * are: the verify route hands the parent back, and the wizard keeps them.
 */
describe('BookingWizard logging in from the sheet', () => {
  const KARI = {
    firstName: 'Kari',
    lastName: 'Nordmann',
    email: 'kari@example.com',
    phone: '+47 400 00 000',
    family: [{ name: 'Jonas', birthYear: 2018 }],
  };
  /** Openings at 13:00, and a code check that answers with Kari. */
  const OPEN_AT_ONE = {
    slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] },
    verify: { status: 200, body: { ok: true, guardian: KARI } },
  };

  beforeEach(() => {
    actions.startLoginAction.mockReset().mockResolvedValue({ data: { status: 'sent' } });
    actions.startVippsLoginAction.mockReset().mockResolvedValue(null);
    router.refresh.mockClear();
    router.push.mockClear();
  });

  /** Open the sheet from its row, ask for a code, and paste it. */
  async function logInThroughSheet(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Logg inn' });
    await user.type(within(dialog).getByLabelText('E-post'), 'kari@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Send kode' }));
    const code = await screen.findByLabelText('Engangskode');
    await user.click(code);
    await user.paste('492155');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }

  it('offers the sheet on the first screen and on «Bekreft», and not on the hour', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByText(/Har du konto\?/)).toBeInTheDocument();
    await pickGutteklipp(user);
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    expect(screen.getByText(/Har du konto\?/)).toBeInTheDocument();
  });

  it('sends a Vipps login back to the wizard to be resumed', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Logg inn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Logg inn' });

    expect(within(dialog).getByRole('button', { name: 'Fortsett med Vipps' })).toBeInTheDocument();
    expect(dialog.querySelector('input[name="next"]')).toHaveValue('/bestill?resume=1');
  });

  /**
   * A guest's answer, then a login: the count chips' seats are not ones the
   * parent's step 1 can draw, so they go and the children are asked for —
   * instead of «Neste» going on with two chairs nobody can see or untick.
   */
  it.each([
    [
      'a tapped chip',
      '',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole('radio', { name: '2 barn' }));
        await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
      },
    ],
    ['a party link’s ?antall=', '?kategori=barn&antall=2', async () => {}],
  ] as const)('swaps %s for the parent’s children on logging in', async (_case, search, answer) => {
    stubApi(OPEN_AT_ONE);
    location.search = search;
    const user = userEvent.setup();
    renderWizard();
    await answer(user);

    await user.click(screen.getByRole('button', { name: 'Tilbake til Hvem' }));
    await logInThroughSheet(user);

    expect(screen.queryByRole('radio', { name: '2 barn' })).toBeNull();
    const jonas = await screen.findByRole('checkbox', { name: /Jonas/ });
    expect(jonas).not.toBeChecked();
    expect(screen.queryByText('Vi tar opptil tre i samme booking.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();

    await user.click(jonas);
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
    // One child, by name — not «Barn 1», «Barn 2» and Jonas.
    expect(screen.queryByRole('list', { name: /Tjenester for Barn/ })).toBeNull();
  });

  /** A deep link the parent has not answered yet comes back from Vipps too. */
  it('sends the deep link along with the Vipps round trip', async () => {
    stubApi(OPEN_AT_ONE);
    location.search = '?kategori=barn&frisor=sara&antall=2';
    const user = userEvent.setup();
    renderWizard();

    // `antall` answered step 1 («2 barn»); the login is offered there.
    await user.click(screen.getByRole('button', { name: 'Tilbake til Hvem' }));
    expect(screen.getByRole('radio', { name: '2 barn' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Logg inn' });

    expect(dialog.querySelector('input[name="next"]')).toHaveValue(
      '/bestill?resume=1&kategori=barn&frisor=sara&antall=2'
    );
  });

  it('fills «Bekreft» in place — fields and children — without a refresh', async () => {
    const { verifyBodies, urls } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    // Mounted, and silent, before anybody has logged in.
    const status = screen.getByRole('status', { name: '' });
    expect(status).toBeEmptyDOMElement();

    await logInThroughSheet(user);

    // Checked by the route handler, not a server action: an action that sets a
    // cookie makes Next re-fetch this whole page, which is what this avoids.
    expect(verifyBodies).toEqual([{ email: 'kari@example.com', code: '492155' }]);
    expect(urls.filter((url) => url.includes('/api/portal/login/verify'))).toHaveLength(1);
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    expect(screen.getByLabelText('Ditt navn')).toHaveValue('Kari Nordmann');
    expect(screen.getByLabelText('E-post')).toHaveValue('kari@example.com');
    expect(screen.getByRole('button', { name: 'Jonas' })).toBeInTheDocument();
    // The same node, filled in — not a new one that arrived pre-filled.
    await waitFor(() => expect(status).toHaveTextContent('Du er logget inn som Kari Nordmann.'));
    // Still the same screen, and focus on its heading rather than on <body> —
    // including once the sheet's exit is over.
    expect(screen.getByRole('heading', { name: 'Nesten ferdig!' })).toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('heading', { name: 'Nesten ferdig!' })).toHaveFocus();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps a number the parent had already typed', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.type(screen.getByLabelText('Mobilnummer'), '99887766');

    await logInThroughSheet(user);

    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('99887766');
    expect(screen.getByLabelText('Ditt navn')).toHaveValue('Kari Nordmann');
  });

  it('remembers a login taken on the first screen by the time the form arrives', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard();

    await logInThroughSheet(user);
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toHaveFocus();
    // The chips became the parent's own children, in place.
    expect(screen.queryByRole('radio', { name: '1 barn' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));

    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  /** A good code whose profile read failed afterwards: logged in, nothing to
   * prefill — and not offered the login it has just taken. */
  it('says a parent is logged in even when there was nobody to prefill', async () => {
    stubApi({ ...OPEN_AT_ONE, verify: { status: 200, body: { ok: true, guardian: null } } });
    const user = userEvent.setup();
    renderWizard();

    await logInThroughSheet(user);

    expect(screen.getByText('Du er logget inn.')).toBeInTheDocument();
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

/**
 * The far end of a Vipps login started from the login sheet.
 *
 * Vipps is a whole navigation — Medal, then Vipps, then back through
 * `/min-side/vipps` — and the booking the parent had half built lives in a
 * `useReducer` that does not survive it. `draft-store.ts` does, and `?resume=1`
 * is the one thing that authorises reading it: a draft left by an abandoned
 * login must not rebuild itself under the next parent to open `/bestill` in the
 * same tab.
 */
describe('BookingWizard resuming after a Vipps login', () => {
  const OPEN_AT_ONE = { slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] } };
  const KARI = {
    firstName: 'Kari',
    lastName: null,
    email: 'kari@example.com',
    phone: '40000000',
    family: [],
  };

  it('opens on the Vipps confirm code over the rebuilt booking, and cleans the address bar', async () => {
    const { verifyBodies } = stubApi({
      ...OPEN_AT_ONE,
      vippsVerify: { status: 200, body: { ok: true, guardian: KARI } },
    });
    const user = userEvent.setup();
    await buildAndLeave(user);

    const back = `?resume=1&vipps=confirm_email&to=${encodeURIComponent('k•••@g•••.com')}`;
    location.search = back;
    window.history.replaceState(null, '', `/bestill${back}`);
    renderWizard();

    const dialog = await screen.findByRole('dialog', { name: 'Sjekk e-posten din' });
    expect(within(dialog).getByText('Vi sendte en kode til k•••@g•••.com.')).toBeInTheDocument();
    // Read once and gone: the marker and the masked address are not left in
    // the history entry, the resume marker is.
    expect(window.location.search).toBe('?resume=1');

    await user.click(within(dialog).getByLabelText('Engangskode'));
    await user.paste('492155');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The code alone — the link is in a cookie the route reads.
    expect(verifyBodies).toEqual([{ code: '492155' }]);
    await onDetails();
    expect(screen.getByLabelText('E-post')).toHaveValue('kari@example.com');
    window.history.replaceState(null, '', '/');
  });

  /** Build a booking as far as «Bekreft» — where the sheet's Vipps button is
   * — then throw the component away. */
  async function buildAndLeave(user: ReturnType<typeof userEvent.setup>) {
    const { unmount } = renderWizard();
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('radio', { name: /^Sara/ }));
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    unmount();
  }

  it('comes back on «Bekreft» with the booking rebuilt and the parent recognised', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    await buildAndLeave(user);

    location.search = '?resume=1';
    renderWizard({ guardian: KARI });

    await onDetails();
    // The hour survived the trip — «Bekreft» is only reachable holding one.
    expect(screen.getByText('Steg 4 av 4 · Bekreft')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
  });

  it('carries the stylist back too, so the booking is the one that was built', async () => {
    const { bodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    await buildAndLeave(user);

    location.search = '?resume=1';
    renderWizard({ guardian: KARI });

    await onDetails();
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });

    const submitted = bodies[0] as { items: Array<{ resourceId?: string; startTs: number }> };
    expect(submitted.items[0]).toMatchObject({ resourceId: SARA.id, startTs: osloTs(2, 13) });
  });

  it('rebuilds nothing without the marker, however fresh the draft is', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    await buildAndLeave(user);

    // The same tab, the same draft, no `?resume=1`: an ordinary visit to
    // `/bestill` opens on step 1.
    renderWizard();

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  /**
   * The stylist can leave in the half hour a Vipps login takes, and the create
   * route cannot say so in a way step 4 can act on — it answers a resource it
   * does not recognise with `invalidInput`, which reads as «se over feltene»
   * over a form the parent filled in perfectly. So the restored stylist is
   * checked against the list once it lands.
   */
  it('drops a restored slot whose stylist has left the salon', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    await buildAndLeave(user);

    location.search = '?resume=1';
    // Sara is gone; only Marcus is on the roster now.
    stubApi({ ...OPEN_AT_ONE, resources: { resources: [MARCUS] } });
    renderWizard({ guardian: KARI });

    // Back on step 2, with the hour dropped and «Første ledige» selected —
    // rather than on «Bekreft» holding a booking that cannot be submitted.
    expect(await screen.findByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Første ledige/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    );
    expect(screen.getByRole('button', { name: 'Bekreft' })).toBeDisabled();
  });

  it('keeps a restored slot when the stylist is still on the roster', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    await buildAndLeave(user);

    location.search = '?resume=1';
    renderWizard({ guardian: KARI });

    await onDetails();
  });

  it('rebuilds nothing from a draft naming a service the salon no longer takes online', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    await buildAndLeave(user);

    location.search = '?resume=1';
    // The same catalogue, minus the one the draft names. Nothing is trusted
    // beyond what step 1 would let a parent tap today.
    render(
      <BookingWizard services={[JENTEKLIPP]} phone="22 33 44 55" rangeStart={NOW} rangeDays={7} />
    );

    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });
});

/**
 * The marketing links' deep links: `?kategori=`, `?tjeneste=`, `?frisor=`,
 * `?antall=`. All applied in the first render — the server-render test below is
 * what proves no effect is involved.
 */
describe('BookingWizard deep links', () => {
  const DAMEKLIPP: BookingServiceDto = {
    ...GUTTEKLIPP,
    id: 'svc-dame',
    name: 'Klipp dame',
    category: 'dame',
    maxPerBooking: 1,
  };
  const SERVICES = [GUTTEKLIPP, JENTEKLIPP, DAMEKLIPP];
  const SEEDED = { services: SERVICES, initialResources: [SARA, MARCUS] };

  it('opens the named category on step 2, once step 1 is answered', async () => {
    location.search = '?kategori=dame';
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    // The link says what, not who: step 1 is still asked.
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Voksen' }));
    expect(await screen.findByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dame' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Barn' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignores an unknown category', async () => {
    location.search = '?kategori=zzz';
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);
    await chooseOneChild(user);
    expect(screen.getByRole('button', { name: 'Barn' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('picks the service by slug and advances to step 2', () => {
    location.search = '?tjeneste=klipp-dame';
    stubApi();
    renderWizard(SEEDED);
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
  });

  describe('for a parent who is already logged in', () => {
    const KARI = {
      firstName: 'Kari',
      lastName: 'Nordmann',
      email: 'kari@example.com',
      phone: '+47 400 00 000',
      family: [{ name: 'Jonas', birthYear: 2018, personId: 'p-jonas' }],
    };

    it('asks for the children instead of seating ?antall=’s guest chairs', async () => {
      location.search = '?kategori=barn&antall=2';
      stubApi();
      renderWizard({ ...SEEDED, guardian: KARI });

      expect(
        await screen.findByRole('heading', { name: 'Hvem skal klippes?' })
      ).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /Jonas/ })).not.toBeChecked();
      expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();
    });

    it.each([
      ['?service=', `?service=svc-gutt&antall=2`],
      ['?tjeneste=', '?tjeneste=gutteklipp&antall=2'],
    ])(
      'lands a %s party link on «Hvem skal klippes?», with the service held for the children',
      async (_case, search) => {
        location.search = search;
        stubApi();
        const user = userEvent.setup();
        renderWizard({
          ...SEEDED,
          guardian: {
            ...KARI,
            family: [...KARI.family, { name: 'Emma', birthYear: 2020, personId: 'p-emma' }],
          },
        });

        // Step 1, in the first render: no guest chairs, nobody ticked.
        expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: '2 barn' })).toBeNull();
        expect(screen.getByRole('checkbox', { name: /Jonas/ })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Neste' })).toBeDisabled();

        await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
        await user.click(screen.getByRole('checkbox', { name: /Emma/ }));
        await user.click(screen.getByRole('button', { name: 'Neste' }));

        // The link's service, already the answer for both children.
        await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
        for (const child of [/Tjenester for Jonas/, /Tjenester for Emma/]) {
          expect(
            within(screen.getByRole('list', { name: child })).getByRole('button', {
              name: /Gutteklipp/,
            })
          ).toHaveAttribute('aria-pressed', 'true');
        }
        expect(screen.queryByRole('list', { name: /Tjenester for Barn/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Neste' })).toBeEnabled();
      }
    );
  });

  it('ignores an unknown service', () => {
    location.search = '?tjeneste=finnes-ikke';
    stubApi();
    renderWizard(SEEDED);
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('preselects the stylist from the seeded list, in the first render', () => {
    location.search = '?tjeneste=gutteklipp&frisor=sara';
    stubApi();
    renderWizard(SEEDED);
    expect(screen.getByText(/Gutteklipp · Sara/)).toBeInTheDocument();
  });

  it('carries a stylist through the first service tap when the link named no service', async () => {
    location.search = '?frisor=Marcus';
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    await chooseOneChild(user);
    await user.click(screen.getByRole('button', { name: /Gutteklipp/ }));
    expect(await screen.findByText(/Gutteklipp · Marcus/)).toBeInTheDocument();
  });

  it('ignores a stylist who cannot do the tapped service', async () => {
    location.search = '?frisor=Marcus';
    stubApi();
    const user = userEvent.setup();
    renderWizard({
      ...SEEDED,
      initialResources: [{ ...MARCUS, serviceIds: [DAMEKLIPP.id] }, SARA],
    });

    await chooseOneChild(user);
    await user.click(screen.getByRole('button', { name: /Gutteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    expect(screen.queryByText(/Gutteklipp · Marcus/)).not.toBeInTheDocument();
  });

  it('keeps ?frisor= through the first tap when the stylists have not loaded yet', async () => {
    location.search = '?frisor=Marcus';
    stubApi();
    const user = userEvent.setup();
    renderWizard({ services: SERVICES });

    await chooseOneChild(user);
    await user.click(screen.getByRole('button', { name: /Gutteklipp/ }));
    expect(await screen.findByText(/Gutteklipp · Marcus/)).toBeInTheDocument();
  });

  it('answers step 1 with the children a party link asked for', async () => {
    location.search = '?kategori=barn&antall=2';
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    // «2 barn» is already the answer: the wizard opens on «Hva skal gjøres?»,
    // one list per child, in the first render.
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('list', { name: 'Tjenester for Barn 1' })).getByRole('button', {
        name: /Gutteklipp/,
      })
    );
    await user.click(
      within(screen.getByRole('list', { name: 'Tjenester for Barn 2' })).getByRole('button', {
        name: /Jenteklipp/,
      })
    );
    expect(await screen.findByText(/2 tjenester/)).toBeInTheDocument();
  });

  it.each([
    ['«Bestill for barn»', '?kategori=barn'],
    ['?hvem=barn', '?hvem=barn'],
  ])('answers step 1 with one child for %s', (_case, search) => {
    location.search = search;
    stubApi();
    renderWizard(SEEDED);

    // One child is the answer: no «Hvem skal klippes?» tap, straight to the
    // services — the home card's path is Bestill → service → time.
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hvem skal klippes?' })).toBeNull();
  });

  it('answers step 1 with one grown-up for ?hvem=voksen', () => {
    location.search = '?hvem=voksen';
    stubApi();
    renderWizard(SEEDED);
    expect(screen.getByRole('heading', { name: 'Hva skal gjøres?' })).toBeInTheDocument();
  });

  it('seats the grown-up, not a guest child, for ?hvem=voksen with a service', async () => {
    location.search = `?hvem=voksen&tjeneste=${DAMEKLIPP.id}`;
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    // Straight to the stylists, and step 1 remembers who: «Voksen», not «1 barn».
    expect(screen.getByRole('heading', { name: 'Hvem vil du gå til?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hvem' }));
    expect(await screen.findByRole('radio', { name: 'Voksen' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('comes back from Vipps seated as the parent left, not as the link said', async () => {
    // Arrived on «Bestill for voksen», changed to a child, then went to Vipps.
    stashDraft({
      items: [
        { serviceId: GUTTEKLIPP.id, bookedForName: null, bookedForBirthYear: null, adult: false },
      ],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1&hvem=voksen';
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    await user.click(screen.getByRole('button', { name: 'Hvem' }));
    expect(await screen.findByRole('radio', { name: '1 barn' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('still asks who is coming on a bare visit', () => {
    location.search = '';
    stubApi();
    renderWizard(SEEDED);
    expect(screen.getByRole('heading', { name: 'Hvem skal klippes?' })).toBeInTheDocument();
  });

  it('applies a party link’s stylist once the family reaches the stylist step', async () => {
    location.search = '?antall=2&frisor=sara';
    stubApi();
    const user = userEvent.setup();
    renderWizard(SEEDED);

    for (const [list, service] of [
      ['Tjenester for Barn 1', /Gutteklipp/],
      ['Tjenester for Barn 2', /Jenteklipp/],
    ] as const) {
      await user.click(
        within(screen.getByRole('list', { name: list })).getByRole('button', { name: service })
      );
    }
    await user.click(screen.getByRole('button', { name: 'Neste' }));

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /^Sara/ })).toHaveAttribute('aria-checked', 'true')
    );
  });

  it('clamps the party to the service limit', () => {
    location.search = '?tjeneste=gutteklipp&antall=9';
    stubApi();
    renderWizard(SEEDED);
    expect(screen.getByText(/3 tjenester/)).toBeInTheDocument();
  });

  it('renders the same first frame on the server as on the client', () => {
    location.search = '?tjeneste=gutteklipp&frisor=sara&antall=2';
    stubApi();
    const html = renderToString(
      <BookingWizard services={SERVICES} initialResources={[SARA, MARCUS]} rangeStart={NOW} />
    );
    // Step 2 with Sara pressed and two children in the basket — from the
    // server's HTML alone, where no effect has run.
    expect(html).toContain('Hvem vil du gå til?');
    expect(html).toMatch(/aria-checked="true"(?:(?!role="radio").)*?>Sara</);
    expect(html).toContain('2 tjenester');
  });
});

describe('step motion', () => {
  it('draws the step it arrives on at once, and animates only the steps the parent moves to', async () => {
    stubApi();
    const user = userEvent.setup();
    const { container } = renderWizard();

    const first = container.querySelector('[data-booking-step="who"]');
    expect(first).not.toBeNull();
    expect(first).not.toHaveAttribute('data-animate');

    await chooseOneChild(user);
    const next = container.querySelector('[data-booking-step="service"]');
    expect(next).toHaveAttribute('data-animate');
  });

  it('does not animate a booking restored from a draft — that is arrival, not a move', async () => {
    stashDraft({
      items: [{ serviceId: GUTTEKLIPP.id, bookedForName: null, bookedForBirthYear: null }],
      resourceId: null,
      partyMode: 'sequential',
      startTs: null,
      resolvedResourceId: null,
      partyResourceIds: null,
    });
    location.search = '?resume=1';
    stubApi();
    const { container } = renderWizard();

    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });
    const restored = container.querySelector('[data-booking-step="when"]');
    expect(restored).not.toBeNull();
    expect(restored).not.toHaveAttribute('data-animate');
  });
});

/**
 * `config.account.required`: every booking is made by a logged-in
 * parent. «Bekreft» for a parent who is not logged in is the login — Vipps or
 * e-mail, two equal buttons — and the form only once they are, with the
 * address they logged in with locked.
 */
describe('BookingWizard with account.required', () => {
  const KARI = {
    firstName: 'Kari',
    lastName: 'Nordmann',
    email: 'kari@example.com',
    phone: '+47 400 00 000',
    family: [{ name: 'Jonas', birthYear: 2018 }],
  };
  const OPEN_AT_ONE = {
    slots: { [GUTTEKLIPP.id]: [slot(2, 13, SARA.id)] },
    verify: { status: 200, body: { ok: true, guardian: KARI } },
  };

  beforeEach(() => {
    actions.startLoginAction.mockReset().mockResolvedValue({ data: { status: 'sent' } });
    actions.startVippsLoginAction.mockReset().mockResolvedValue(null);
    router.refresh.mockClear();
    router.push.mockClear();
  });

  /** «Bekreft» as a guest: the gate, not the form. */
  async function onGate(user: ReturnType<typeof userEvent.setup>) {
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await screen.findByRole('heading', { name: 'Nesten ferdig' });
  }

  /** The gate's second button, an address, «Send kode», and the code. */
  async function logInByEmail(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Fortsett med e-post' }));
    await user.type(screen.getByLabelText('E-post'), 'kari@example.com');
    await user.click(screen.getByRole('button', { name: 'Send kode' }));
    const code = await screen.findByLabelText('Engangskode');
    await user.click(code);
    await user.paste('492155');
    await onDetails();
  }

  /** Step 1 for a known parent: tick the child's card, then «Neste». */
  async function tickJonas(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: /Jonas/ }));
    await user.click(screen.getByRole('button', { name: 'Neste' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });
  }

  it('turns «Bekreft» into Vipps or e-mail for a parent who is not logged in', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ accountRequired: true });

    // No «Har du konto?» on the first screen: the login comes at the end.
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    await onGate(user);

    expect(
      screen.getByText(
        'Logg inn for å bekrefte — vi lager kontoen hvis du er ny. Timen holdes for deg mens du logger inn.'
      )
    ).toBeInTheDocument();
    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text === 'Fortsett med Vipps' || text === 'Fortsett med e-post');
    expect(buttons).toEqual(['Fortsett med Vipps', 'Fortsett med e-post']);
    // Not the form, not its button, and no other login row.
    expect(screen.queryByLabelText('Mobilnummer')).toBeNull();
    expect(screen.queryByRole('button', { name: /Bekreft time/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Neste' })).toBeNull();
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    // Still on «Bekreft», holding the hour.
    expect(screen.getByText('Steg 4 av 4 · Bekreft')).toBeInTheDocument();
  });

  it('shows the booking the login is for on the gate', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ accountRequired: true });
    await onGate(user);

    const gate = screen.getByRole('region', { name: 'Nesten ferdig' });
    expect(within(gate).getByText(/Gutteklipp/)).toBeInTheDocument();
    expect(within(gate).getByText(/13:00/)).toBeInTheDocument();
  });

  it('sends a Vipps login from the gate back to «Bekreft»', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    const { container } = renderWizard({ accountRequired: true });
    await onGate(user);

    expect(container.querySelector('input[name="next"]')).toHaveValue('/bestill?resume=1');
  });

  it('logs in by e-mail in place and shows the form, filled in, with the address locked', async () => {
    const { verifyBodies } = stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ accountRequired: true });
    await onGate(user);

    await logInByEmail(user);

    expect(actions.startLoginAction).toHaveBeenCalledWith({ email: 'kari@example.com' });
    expect(verifyBodies).toEqual([{ email: 'kari@example.com', code: '492155' }]);
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
    const email = screen.getByLabelText('E-post');
    expect(email).toHaveValue('kari@example.com');
    expect(email).toHaveAttribute('readonly');
    expect(screen.getByText('E-posten du logget inn med')).toBeInTheDocument();
    expect(screen.getByText('Steg 4 av 4 · Bekreft')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nesten ferdig' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nesten ferdig!' })).toHaveFocus();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('shows a parent who arrived logged in the form straight away, the address locked', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ accountRequired: true, guardian: KARI });

    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    expect(screen.queryByRole('button', { name: 'Fortsett med e-post' })).toBeNull();
    expect(screen.getByLabelText('E-post')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
  });

  it('leaves the address editable without account.required', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    renderWizard({ guardian: KARI });

    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();

    expect(screen.getByLabelText('E-post')).not.toHaveAttribute('readonly');
    expect(screen.queryByText('E-posten du logget inn med')).toBeNull();
  });

  it('comes back from Vipps on the form, the booking rebuilt', async () => {
    stubApi(OPEN_AT_ONE);
    const user = userEvent.setup();
    const { unmount } = renderWizard({ accountRequired: true });
    await onGate(user);
    unmount();

    location.search = '?resume=1';
    renderWizard({ accountRequired: true, guardian: KARI });

    await onDetails();
    expect(screen.getByText('Steg 4 av 4 · Bekreft')).toBeInTheDocument();
    expect(screen.getByLabelText('E-post')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Mobilnummer')).toHaveValue('40000000');
  });

  it('takes a Vipps confirm code in the gate itself, not in a sheet over it', async () => {
    const { verifyBodies } = stubApi({
      ...OPEN_AT_ONE,
      vippsVerify: { status: 200, body: { ok: true, guardian: KARI } },
    });
    const user = userEvent.setup();
    const { unmount } = renderWizard({ accountRequired: true });
    await onGate(user);
    unmount();

    const back = `?resume=1&vipps=confirm_email&to=${encodeURIComponent('k•••@g•••.com')}`;
    location.search = back;
    window.history.replaceState(null, '', `/bestill${back}`);
    renderWizard({ accountRequired: true });

    expect(await screen.findByText('Vi sendte en kode til k•••@g•••.com.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByLabelText('Engangskode'));
    await user.paste('492155');

    await onDetails();
    expect(verifyBodies).toEqual([{ code: '492155' }]);
    expect(screen.getByLabelText('E-post')).toHaveAttribute('readonly');
    window.history.replaceState(null, '', '/');
  });

  it('shows the gate again, the hour kept, when the session ran out before «Bekreft time»', async () => {
    stubApi({
      ...OPEN_AT_ONE,
      createStatus: 401,
      create: { error: 'accountRequired', message: 'Log in to book' },
    });
    const user = userEvent.setup();
    renderWizard({ accountRequired: true, guardian: KARI });
    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    const heading = await screen.findByRole('heading', { name: 'Nesten ferdig' });
    // No error over it: the gate is the whole answer, focused, and saying why.
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Du ble logget ut. Logg inn igjen — timen din er holdt.'
    );
    expect(screen.getByText('Steg 4 av 4 · Bekreft')).toBeInTheDocument();

    // Logged in again, the same booking goes through.
    const { bodies } = stubApi(OPEN_AT_ONE);
    await logInByEmail(user);
    // The notice went with the gate; nothing says «signed out» over the form.
    expect(screen.queryByText(/Du ble logget ut/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));
    await screen.findByRole('heading', { name: 'Timen er bekreftet! 🎉' });
    const submitted = bodies.find((body) => 'items' in (body as object)) as {
      items: Array<{ startTs: number }>;
    };
    expect(submitted.items[0]).toMatchObject({ startTs: osloTs(2, 13) });
  });

  it('says something when the session ran out and there is no login to offer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bodies } = stubApi({
      ...OPEN_AT_ONE,
      createStatus: 401,
      create: { error: 'accountRequired', message: 'Log in to book' },
    });
    const user = userEvent.setup();
    renderWizard({ accountRequired: true, guardian: KARI, noActions: true });
    // The site wired no login actions: said once, in development.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/account\.required/);

    await tickJonas(user);
    await pickGutteklipp(user);
    await user.click(await screen.findByRole('button', { name: '13:00' }));
    await onDetails();
    await user.click(screen.getByRole('checkbox', { name: /Jeg forstår/ }));
    await user.click(screen.getByRole('button', { name: /Bekreft time/ }));

    // Not a «Bekreft» that does nothing: the generic upstream error, on the form.
    expect(await screen.findByRole('alert')).toHaveTextContent(/timeboken svarte ikke/);
    expect(screen.queryByRole('heading', { name: 'Nesten ferdig' })).toBeNull();
    expect(screen.getByRole('button', { name: /Bekreft time/ })).toBeInTheDocument();
    expect(bodies.filter((body) => 'items' in (body as object))).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
