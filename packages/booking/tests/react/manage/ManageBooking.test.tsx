import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingManageDto, BookingServiceDto } from '../../../src/core/types';
import { ManageBooking } from '../../../src/react/ManageBooking';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

/**
 * Every date and hour on this page belongs to the salon, and this suite normally
 * runs in Oslo — where a component that asked `Date` what day it was would print
 * exactly the right string and no assertion here would notice until a parent
 * opened the link from a holiday.
 */
pinAForeignViewerClock();

/**
 * Prices carry a non-breaking space, so they are read exactly: Testing
 * Library's default normalizer collapses `\s`, which in JavaScript includes
 * U+00A0, and would quietly accept «490 kr» breaking in half at the bottom of a
 * narrow phone. See `SummaryBar.test.tsx`.
 */
const exactly = (text: string) => text;
const NBSP = '\u00A0';

const HOUR = 3_600_000;
const WINDOW_HOURS = 24;

/** Monday 5 October 2026, 15:00 in Oslo. Written as UTC because that is the one
 * construction the runner's own zone cannot move; Oslo is UTC+02:00 that week. */
const NOW = Date.UTC(2026, 9, 5, 13);

/** An Oslo wall-clock instant in October 2026, still inside CEST. */
const osloOctober = (day: number, hour: number, minute = 0) =>
  Date.parse(
    `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(
      minute
    ).padStart(2, '0')}:00+02:00`
  );

const GUTTEKLIPP: BookingServiceDto = {
  id: 'svc-gutteklipp',
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

/**
 * A booking that starts `inMs` from the frozen now.
 *
 * `canCancel` / `canReschedule` are computed here with the ENGINE's own
 * comparison — confirmed, and now at least the window before start, boundary
 * inclusive — because the page relays those two booleans rather than owning a
 * policy clock of its own. Hard-coding them to `true` would let a page that
 * ignored them pass; leaving them out would let a page that recomputed the
 * window from `startTs` pass. Modelling the server is the only form that can
 * honestly check either half.
 */
function bookingStartingIn(
  inMs: number,
  overrides: Partial<BookingManageDto> = {}
): BookingManageDto {
  const startTs = Date.now() + inMs;
  const status = overrides.status ?? 'confirmed';
  const open = status === 'confirmed' && Date.now() <= startTs - WINDOW_HOURS * HOUR;
  return {
    bookingId: 'bk_1',
    status,
    rescheduledFromId: null,
    startTs,
    endTs: startTs + 30 * 60_000,
    serviceId: 'svc-gutteklipp',
    serviceName: 'Gutteklipp',
    resourceId: 'res-sara',
    resourceName: 'Sara',
    bookedForName: 'Jonas',
    partySequenceId: null,
    amountOre: 49_000,
    cancelWindowHours: WINDOW_HOURS,
    rescheduleWindowHours: WINDOW_HOURS,
    canCancel: open,
    canReschedule: open,
    ...overrides,
  };
}

/**
 * Two Thursday openings and one Saturday one, all with the booked stylist — the
 * reschedule query locks the resource, so the engine only ever answers for Sara.
 * Deliberately NOT containing the appointment's own 15:00: the visitor's booking
 * is what makes that minute busy, so availability never returns it.
 */
const AVAILABILITY = [
  { startTs: osloOctober(8, 12), resourceId: 'res-sara' },
  { startTs: osloOctober(8, 16, 30), resourceId: 'res-sara' },
  { startTs: osloOctober(10, 12), resourceId: 'res-sara' },
  { startTs: osloOctober(10, 14), resourceId: 'res-sara' },
];

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const jsonFail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

let fetchMock: ReturnType<typeof vi.fn>;
/** What the next POST to the manage route answers with. Reassigned per test. */
let mutationResponse: unknown;

/**
 * `fetch` is stubbed rather than left to the runtime: the component owns its own
 * mutations — there is no `onCancel` prop to inject — and jsdom has no fetch, so
 * an unstubbed relative URL throws «Failed to parse URL» before any assertion
 * gets to run.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mutationResponse = jsonOk({ ok: true, manageToken: 'mt_test_new' });
  fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).startsWith('/api/booking/availability')) {
      return jsonOk({ slots: AVAILABILITY });
    }
    return mutationResponse;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The body of the last POST the component made, parsed. */
const lastPostBody = () => {
  const [, init] = fetchMock.mock.calls.at(-1) as [unknown, { body: string }];
  return JSON.parse(init.body);
};

/** Into step 3 and onto one of the day's chips. */
async function pickNewSlot(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
  fireEvent.click(await screen.findByRole('button', { name }));
}

/**
 * The source component, as the moved assertions knew it: the parity config and
 * label fixture, the source suite's site origin, and no phone or address unless
 * the test passes one (the source defaulted both to `null`; the package falls
 * back to `config.contact`).
 */
function ManagePage(props: ComponentProps<typeof ManageBooking>) {
  return (
    <ManageBooking
      config={PARITY_CONFIG}
      labels={TEST_LABELS}
      phone={null}
      address={null}
      siteUrl="https://test.example.com"
      {...props}
    />
  );
}

describe('ManagePage', () => {
  it('names the stylist the way step 2 did, not by the salon’s admin label', () => {
    render(
      <ManagePage booking={bookingStartingIn(72 * HOUR, { resourceName: 'sara (Salong Demo)' })} />
    );
    expect(
      screen.getByText(`tor. 8. okt. kl. 15:00 hos Sara · 490${NBSP}kr`, { normalizer: exactly })
    ).toBeInTheDocument();
  });

  it('shows the appointment the way the report writes it', () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);

    expect(screen.getByText('Jonas – Gutteklipp')).toBeInTheDocument();
    // Read exactly, so the non-breaking space inside «490 kr» is part of the
    // claim rather than something the normalizer smoothed over.
    expect(
      screen.getByText(`tor. 8. okt. kl. 15:00 hos Sara · 490${NBSP}kr`, { normalizer: exactly })
    ).toBeInTheDocument();
  });

  /**
   * The deadline is the one thing on this page that is derived rather than
   * relayed — the manage payload carries the window in hours and the start, and
   * no deadline of its own — so it is worth pinning to the minute.
   */
  it('says when free changes end, and how long that leaves', async () => {
    // 51 hours out, so the deadline is 27 hours away: the report's own «om 1 dag
    // og 3 timer».
    render(<ManagePage booking={bookingStartingIn(51 * HOUR)} />);

    expect(screen.getByText(/Gratis endring frem til tir\. 6\. okt\. kl\. 18:00/)).toBeVisible();
    expect(await screen.findByText(/\(om 1 dag og 3 timer\)/)).toBeVisible();
  });

  it('takes the rejected slot off the screen while it re-reads', async () => {
    // `loadSlots` clears only the failure flag, so without dropping the array
    // first the openings read BEFORE the clash stay rendered during the
    // refresh — with the rejected instant on them, tappable, and the nearest
    // thing to the time the visitor wanted. They confirm it again and lose
    // again.
    let releaseRefresh = () => {};
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let availabilityCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        if (pathname.startsWith('/api/booking/manage')) {
          return { ok: false, status: 409, json: async () => ({ error: 'slotTaken' }) };
        }
        availabilityCalls += 1;
        const body = {
          ok: true,
          status: 200,
          json: async () => ({ slots: [{ startTs: NOW + 73 * HOUR, resourceId: 'res-sara' }] }),
        };
        // Hold the SECOND read open, so the window this test is about stays
        // open long enough to look at.
        if (availabilityCalls === 2) await refreshHeld;
        return body;
      })
    );
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);

    await pickNewSlot(/16:00/);
    fireEvent.click(screen.getByRole('button', { name: 'Bekreft endring' }));

    // Back on the picker with the refresh still in flight: the chip that just
    // lost must not be sitting there waiting to be tapped again.
    await waitFor(() => expect(availabilityCalls).toBe(2));
    expect(screen.queryByRole('button', { name: /16:00/ })).toBeNull();

    releaseRefresh();
    expect(await screen.findByRole('button', { name: /16:00/ })).toBeInTheDocument();
  });

  it('retries the openings after a failed refresh, instead of sticking', async () => {
    // The state that traps the page: a refresh that fails AFTER a successful
    // load. `onMove` calls `loadSlots` when the chosen slot went first, so
    // `slotsFailed` goes true while the stale array is still there — and a
    // guard that only asks «have slots ever loaded?» never tries again.
    // «Endre tidspunkt» then shows the failure card until the page is reloaded.
    let availabilityCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, _init?: { body?: string }) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        if (pathname.startsWith('/api/booking/manage')) {
          // The move loses its slot — which is what makes the page refresh.
          return { ok: false, status: 409, json: async () => ({ error: 'slotTaken' }) };
        }
        availabilityCalls += 1;
        // The refresh that `onMove` triggers is the one that fails.
        if (availabilityCalls === 2) return { ok: false, status: 503, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ slots: [{ startTs: NOW + 73 * HOUR, resourceId: 'res-sara' }] }),
        };
      })
    );
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);

    await pickNewSlot(/16:00/);
    fireEvent.click(screen.getByRole('button', { name: 'Bekreft endring' }));

    // The move failed, the refresh failed with it, and the card is up.
    await screen.findByText(/Vi får ikke hentet ledige tider/);
    await waitFor(() => expect(availabilityCalls).toBe(2));

    // Out and back in: the guard has to try again rather than trust the stale
    // array it is still holding.
    fireEvent.click(screen.getByRole('button', { name: 'Tilbake' }));
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));

    await waitFor(() => expect(availabilityCalls).toBe(3));
    expect(await screen.findByRole('button', { name: /16:00/ })).toBeInTheDocument();
  });

  it('keeps the way back in inside the calendar entry', () => {
    // This file is a REQUEST once the booking has been moved: it UPDATES the
    // entry the confirmation created. A description carrying only the price
    // would therefore delete the manage URL out of the customer's calendar
    // while leaving the replacement nowhere — and a booking made without an
    // e-mail address has no other copy of it, because the engine mints the
    // token once and a move replaces it.
    render(
      <ManagePage
        booking={bookingStartingIn(72 * HOUR)}
        selfManagePath="/bestill/administrer/mt_test_1"
      />
    );

    const href =
      screen.getByRole('link', { name: 'Legg til i kalender' }).getAttribute('href') ?? '';
    const ics = decodeURIComponent(href.replace(/^data:text\/calendar;charset=utf-8,/, ''));

    expect(ics).toContain('Endre eller avbestill');
    expect(ics).toContain('/bestill/administrer/mt_test_1');
    // The price stays too — the line is an addition, not a replacement.
    expect(ics).toContain('betales i salongen');
  });

  it('swaps both actions for a phone number inside the 24-hour window', () => {
    render(<ManagePage booking={bookingStartingIn(2 * HOUR)} phone="22334455" />);
    expect(screen.queryByRole('button', { name: 'Endre tidspunkt' })).toBeNull();
    expect(screen.getByRole('link', { name: /Ring oss for å endre/ })).toHaveAttribute(
      'href',
      expect.stringContaining('tel:')
    );
  });

  it('also loses «Avbestill», and says what to do instead', () => {
    render(<ManagePage booking={bookingStartingIn(2 * HOUR)} phone="22 33 44 55" />);

    expect(screen.queryByRole('button', { name: 'Avbestill' })).toBeNull();
    // The spaces are typography; a phone dials digits.
    expect(screen.getByRole('link', { name: /Ring oss for å avbestille/ })).toHaveAttribute(
      'href',
      'tel:22334455'
    );
    expect(screen.getByText(/Mindre enn 24 timer igjen/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ring oss på 22 33 44 55' })).toBeInTheDocument();
  });

  /**
   * The number is a prop, and it is not provisioned yet. A `tel:` that dials
   * nothing is worse than plain text anywhere on this site, and worst here —
   * inside the window the telephone is the only remaining way to change the
   * appointment, so a dead link fails in the visitor's hand at the exact moment
   * they have been told they cannot do it themselves.
   */
  it('renders the same sentences unlinked when there is no number', () => {
    render(<ManagePage booking={bookingStartingIn(2 * HOUR)} phone={null} />);

    expect(screen.getByText(/Ring oss for å endre/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ring oss for å endre/ })).toBeNull();
    expect(
      screen.getByText('Mindre enn 24 timer igjen – ring oss, så finner vi en løsning.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ring oss/ })).toBeNull();
  });

  /**
   * The engine decides both windows and enforces them on the write; this page
   * agrees with it in advance rather than becoming a second source of truth. A
   * booking three days out whose `canCancel` the engine answered `false` must
   * lose the button even though the clock says there is plenty of time.
   */
  it('reads the engine’s verdict rather than the clock', () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR, { canCancel: false })} />);

    expect(screen.queryByRole('button', { name: 'Avbestill' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Endre tidspunkt' })).toBeInTheDocument();
  });

  it('offers a rebook link immediately after cancelling — cancellation is not churn', async () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    expect(await screen.findByRole('link', { name: 'Finn ny time' })).toBeTruthy();
  });

  it('asks the cancellation question with the window in it', () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));

    expect(
      screen.getByText(
        "Avbestille Jonas' time tor. 8. okt. kl. 15:00? Det er gratis frem til 24 t før."
      )
    ).toBeInTheDocument();
  });

  /** The chips are an offer. A reason that had to be given is a reason to keep
   * the appointment and simply not turn up. */
  it('sends no reason when no chip was tapped, and the chip when one was', async () => {
    const { unmount } = render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    await screen.findByRole('link', { name: 'Finn ny time' });
    expect(lastPostBody()).toEqual({ action: 'cancel' });
    unmount();

    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sykdom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    await screen.findByRole('link', { name: 'Finn ny time' });
    expect(lastPostBody()).toEqual({ action: 'cancel', reason: 'Sykdom' });
  });

  it('«Behold timen» leaves the booking alone', () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Behold timen' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Avbestill' })).toBeInTheDocument();
  });

  /**
   * A cancel carries no idempotency key — the engine has none for that route —
   * so a second one would 409 and tell the visitor their cancellation failed
   * immediately after it worked. The button is held down for the round trip.
   */
  it('posts one cancellation for a double-tapped confirm', async () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));

    const confirm = screen.getByRole('button', { name: 'Ja, avbestill' });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);

    await screen.findByRole('link', { name: 'Finn ny time' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Step 3 again, opened on the day the visitor already has, with the hour they
   * hold drawn among the openings — the availability list cannot contain it,
   * because their own booking is what makes that minute busy.
   */
  it('marks the current hour in step 3 and does not offer it as a move', async () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));

    const marker = await screen.findByRole('button', { name: /Nåværende time/ });
    expect(marker).toBeDisabled();
    expect(marker.textContent).toContain('15:00');

    // Locked to what was booked, which is why the confirmation can say «hos
    // Sara» without a second lookup.
    const availabilityUrl = String(fetchMock.mock.calls[0][0]);
    expect(availabilityUrl).toContain('service_id=svc-gutteklipp');
    expect(availabilityUrl).toContain('resource_id=res-sara');
  });

  /**
   * The new slot is deliberately on a DIFFERENT day from the old one. Moving
   * within Thursday would let a sentence that quoted the old date on both ends
   * read correctly, and the assertion would prove nothing about the half that
   * matters.
   */
  it('asks one question before moving, and names both ends of it', async () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'lør. 10.' }));
    fireEvent.click(screen.getByRole('button', { name: '12:00' }));

    expect(
      screen.getByText(
        "Flytte Jonas' time fra tor. 8. okt. 15:00 til lør. 10. okt. 12:00 hos Sara?"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bekreft endring' })).toBeInTheDocument();
  });

  /**
   * The surcharge note is a warning, so it appears only when there is something
   * to warn about: another hour on the same Thursday costs the same and gets no
   * line at all.
   */
  it('warns about the weekend price only when the new slot costs more', async () => {
    const { unmount } = render(
      <ManagePage booking={bookingStartingIn(72 * HOUR)} service={GUTTEKLIPP} />
    );
    await pickNewSlot(/^16:30$/);
    expect(screen.queryByText(/helgetillegg/)).toBeNull();
    unmount();

    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} service={GUTTEKLIPP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'lør. 10.' }));
    fireEvent.click(screen.getByRole('button', { name: '12:00' }));

    expect(
      screen.getByText(`Merk: lørdagspris 539${NBSP}kr (+10${NBSP}% helgetillegg)`, {
        normalizer: exactly,
      })
    ).toBeInTheDocument();
  });

  /**
   * The surcharge is already in the price of a Saturday appointment, so moving
   * it to another Saturday hour costs nothing extra — and a «Merk:» line there
   * would read as a charge the parent is about to incur twice. This is what the
   * price comparison is for; the weekday alone cannot tell the two apart.
   */
  it('says nothing about the surcharge when the booking was already on a Saturday', async () => {
    render(
      <ManagePage
        booking={bookingStartingIn(osloOctober(10, 12) - NOW, { amountOre: 53_900 })}
        service={GUTTEKLIPP}
      />
    );
    await pickNewSlot(/^14:00$/);

    expect(screen.getByText(/^Flytte Jonas' time fra lør\. 10\. okt\. 12:00/)).toBeInTheDocument();
    expect(screen.queryByText(/helgetillegg/)).toBeNull();
  });

  /**
   * The move cancels the row the visitor arrived on, so the token in their
   * address bar is dead from here — the only link that still works is the one
   * built from the token the engine just minted.
   */
  it('moves the appointment and links the new manage page', async () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    await pickNewSlot(/^12:00$/);
    fireEvent.click(screen.getByRole('button', { name: 'Bekreft endring' }));

    expect(await screen.findByText('Timen er flyttet til tor. 8. okt. kl. 12:00.')).toBeVisible();
    expect(lastPostBody()).toEqual({ action: 'reschedule', startTs: osloOctober(8, 12) });
    expect(screen.getByRole('link', { name: 'Se timen' })).toHaveAttribute(
      'href',
      '/bestill/administrer/mt_test_new'
    );
    // And the ADDRESS BAR, which is the copy that survives a refresh. This
    // screen holds the only one the engine will ever hand back — the
    // replacement token is minted once and omitted from an idempotent replay —
    // so reloading the URL the visitor arrived on would land them on the token
    // of the row this move cancelled, with the appointment unmanageable online
    // for good.
    expect(window.location.pathname).toBe('/bestill/administrer/mt_test_new');
  });

  /** The engine mints the replacement token exactly once and omits it from an
   * idempotent replay. No token means no link, not a link to «avbestilt». */
  it('does not invent a link when the move came back without a new token', async () => {
    mutationResponse = jsonOk({ ok: true });
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} phone="22334455" />);
    await pickNewSlot(/^12:00$/);
    fireEvent.click(screen.getByRole('button', { name: 'Bekreft endring' }));

    expect(await screen.findByText(/Timen er flyttet til/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Se timen' })).toBeNull();
    expect(screen.getByText(/Endringen er registrert/)).toBeInTheDocument();
  });

  /** A slot taken while the visitor read the confirmation is not an error to sit
   * on — step 3 is where the answer is. */
  it('sends the visitor back to step 3 when the new slot went first', async () => {
    mutationResponse = jsonFail(409, { error: 'slotTaken' });
    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    await pickNewSlot(/^12:00$/);
    fireEvent.click(screen.getByRole('button', { name: 'Bekreft endring' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Oi, den ble nettopp tatt');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Bekreft endring' })).toBeNull();
  });

  /**
   * A known token always resolves, including after the booking ended — the page
   * shows the state instead of a dead link and two buttons that would 409.
   */
  it('shows a cancelled booking’s state instead of two dead buttons', () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR, { status: 'cancelled' })} />);

    expect(screen.getByText('Denne timen er avbestilt.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Endre tidspunkt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avbestill' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Bestill ny time' })).toBeInTheDocument();
  });

  /**
   * A manage token authorises exactly one booking, so «Endre tidspunkt» on a
   * family visit cannot mean what it means for one child. The question comes
   * first, and nothing is asked of the engine until it has been answered.
   */
  it('asks a family whether the whole visit is moving', async () => {
    render(<ManagePage booking={bookingStartingIn(72 * HOUR, { partySequenceId: 'party_1' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));

    expect(
      screen.getByRole('heading', { name: 'Endre hele besøket, eller bare Jonas?' })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Bare Jonas' }));
    expect(await screen.findByRole('heading', { name: 'Når passer det?' })).toBeInTheDocument();
  });

  /**
   * The token is a live credential for this one booking. It reaches the
   * component as a PATH to post to and never as a value, so nothing rendered can
   * carry it into a referrer, a copied link, or a screenshot in a support
   * thread — and it is not in the availability query either, which is a URL
   * every proxy on the way logs.
   */
  it('never renders the manage token', async () => {
    const token = 'mt_test_never_rendered'; // skipcq: SCT-A000 -- a fixture, not a credential
    const { container } = render(
      <ManagePage
        booking={bookingStartingIn(72 * HOUR)}
        actionPath={`/api/booking/manage/${token}`}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Endre tidspunkt' }));
    await screen.findByRole('heading', { name: 'Når passer det?' });

    expect(container.innerHTML).not.toContain(token);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(token);
  });

  /**
   * The link to the portal is internal and root-relative — the manage route
   * sends `no-referrer`, and this is the one navigation off the page that is
   * neither a phone call nor the wizard, so it must stay on this origin. It is
   * at the foot of every view, including the one a cancellation ends on.
   */
  it('links to Min side, root-relative, from the overview and after a cancellation', async () => {
    const { unmount } = render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    const link = screen.getByRole('link', { name: 'Se alle timene dine på Min side' });
    expect(link).toHaveAttribute('href', '/min-side');
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    unmount();

    render(<ManagePage booking={bookingStartingIn(72 * HOUR)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avbestill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, avbestill' }));
    await screen.findByRole('link', { name: 'Finn ny time' });

    expect(screen.getByRole('link', { name: 'Se alle timene dine på Min side' })).toHaveAttribute(
      'href',
      '/min-side'
    );
  });
});
