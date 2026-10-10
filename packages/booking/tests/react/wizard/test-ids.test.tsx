/**
 * Stable data-testid attributes on the wizard steps and key controls — the
 * hooks synthetic monitoring and promote gates use.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingServiceDto, BookingSlotDto } from '../../../src/core/types';
import { BOOKING_TEST_IDS } from '../../../src/react/wizard/test-ids';
import { BookingWizard } from '../../support/legacy-wizard';
import { pinAForeignViewerClock } from '../../support/viewer-clock';

const location = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

function stubApi(slots: BookingSlotDto[] = [{ startTs: osloTs(2, 13), resourceId: SARA.id }]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const { pathname } = new URL(String(input), 'https://example.test');
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (pathname.startsWith('/api/booking/resources')) {
        return json({ resources: [SARA], nextAvailableTs: {} });
      }
      if (pathname.startsWith('/api/booking/availability')) return json({ slots });
      if (pathname.startsWith('/api/booking/schedule')) return json({ days: OPEN_WEEK });
      throw new Error(`unexpected fetch: ${pathname}`);
    })
  );
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  window.sessionStorage.clear();
  location.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('wizard data-testid hooks', () => {
  it('marks the who and service steps and each service option', async () => {
    stubApi();
    const user = userEvent.setup();
    render(
      <BookingWizard services={[GUTTEKLIPP]} phone="22 33 44 55" rangeStart={NOW} rangeDays={7} />
    );

    expect(screen.getByTestId(BOOKING_TEST_IDS.stepWho)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await screen.findByRole('heading', { name: 'Hva skal gjøres?' });

    expect(screen.getByTestId(BOOKING_TEST_IDS.stepService)).toBeInTheDocument();
    const option = screen.getByTestId(BOOKING_TEST_IDS.serviceOption);
    expect(option).toHaveAttribute('data-service-id', GUTTEKLIPP.id);
    expect(within(option).getByRole('button', { name: /Gutteklipp/ })).toBeInTheDocument();
  });

  it('marks stylist options, day chips, slots, and the empty-day card', async () => {
    // Today has a slot; another open day in the strip has none → empty state.
    stubApi([{ startTs: osloTs(2, 13), resourceId: SARA.id }]);
    const user = userEvent.setup();
    render(
      <BookingWizard services={[GUTTEKLIPP]} phone="22 33 44 55" rangeStart={NOW} rangeDays={7} />
    );

    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await user.click(await screen.findByRole('button', { name: /Gutteklipp/ }));
    await screen.findByRole('heading', { name: 'Hvem vil du gå til?' });

    expect(screen.getByTestId(BOOKING_TEST_IDS.stepStylist)).toBeInTheDocument();
    const stylists = screen.getAllByTestId(BOOKING_TEST_IDS.stylistOption);
    expect(stylists.length).toBeGreaterThanOrEqual(2);
    expect(stylists.some((el) => el.getAttribute('data-resource-id') === 'first')).toBe(true);
    expect(stylists.some((el) => el.getAttribute('data-resource-id') === SARA.id)).toBe(true);

    await screen.findByRole('heading', { name: 'Når passer det?' });
    expect(screen.getByTestId(BOOKING_TEST_IDS.stepCalendar)).toBeInTheDocument();

    const days = screen.getAllByTestId(BOOKING_TEST_IDS.day);
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(days[0]).toHaveAttribute('data-day-ts');

    const slot = await screen.findByTestId(BOOKING_TEST_IDS.slot);
    expect(slot).toHaveAttribute('data-start-ts', String(osloTs(2, 13)));

    // Tap a later open day with no openings → empty card.
    const tomorrowChip = days.find((el) => el.getAttribute('data-day-ts') === String(osloTs(3, 0)));
    expect(tomorrowChip).toBeTruthy();
    await user.click(within(tomorrowChip as HTMLElement).getByRole('button'));
    await waitFor(() => {
      expect(screen.getByTestId(BOOKING_TEST_IDS.slotsEmpty)).toBeInTheDocument();
    });
  });

  it('marks the slots-error state when availability cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const { pathname } = new URL(String(input), 'https://example.test');
        const json = (body: unknown, status = 200) => ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
        });
        if (pathname.startsWith('/api/booking/resources')) {
          return json({ resources: [SARA], nextAvailableTs: {} });
        }
        if (pathname.startsWith('/api/booking/availability')) {
          return json({ error: 'upstreamError' }, 502);
        }
        if (pathname.startsWith('/api/booking/schedule')) return json({ days: OPEN_WEEK });
        throw new Error(`unexpected fetch: ${pathname}`);
      })
    );
    const user = userEvent.setup();
    render(
      <BookingWizard services={[GUTTEKLIPP]} phone="22 33 44 55" rangeStart={NOW} rangeDays={7} />
    );

    await user.click(screen.getByRole('radio', { name: '1 barn' }));
    await user.click(await screen.findByRole('button', { name: /Gutteklipp/ }));
    await waitFor(() => {
      expect(screen.getByTestId(BOOKING_TEST_IDS.slotsError)).toBeInTheDocument();
    });
    expect(screen.getByTestId(BOOKING_TEST_IDS.slotsError)).toHaveTextContent(
      /Vi får ikke hentet ledige tider/
    );
  });
});
