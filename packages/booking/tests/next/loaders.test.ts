import { MedalApiError } from '@medalsocial/sdk';
import { describe, expect, it, vi } from 'vitest';
import { loadBookingPage, loadManagePage, loadPortalPage } from '../../src/next/loaders';
import { PortalSessionExpiredError } from '../../src/next/portal/medal-portal';
import { testLogger, testRuntime } from '../support/next-runtime';
import { PARITY_CONFIG } from '../support/parity-config';

/**
 * The three page loaders: the branches each page used to take inline — the
 * handoff, the unavailable timebook, the unknown and the unreachable booking,
 * the dead portal session — as tagged answers.
 */

const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

const SEED = {
  services: [{ id: 'svc-1' }],
  resources: [],
  slots: {},
  schedules: {},
  nextAvailable: {},
  generatedAt: 1,
  fromTs: 1,
  toTs: 2,
};

function bookingRuntime(overrides: Record<string, unknown> = {}, options = {}) {
  const loadBookingSeed = vi.fn(async () => SEED);
  const readPortalSession = vi.fn(async (): Promise<string | null> => null);
  const guardianFromSession = vi.fn(async () => ({ firstName: 'Kari' }));
  const timing = vi.fn();
  const logger = testLogger();
  const rt = testRuntime(
    {
      seed: { loadBookingSeed, RANGE_DAYS: 7 } as never,
      session: { readPortalSession } as never,
      guardianFromSession: guardianFromSession as never,
      ...overrides,
    },
    { timing, logger, ...options }
  );
  return { rt, loadBookingSeed, readPortalSession, guardianFromSession, timing, logger };
}

describe('loadBookingPage', () => {
  it('hands off before anything is read, when the site says so', async () => {
    const { rt, loadBookingSeed, readPortalSession } = bookingRuntime();
    const result = await loadBookingPage(rt, { handoffUrl: 'https://booking.example/salong' });
    expect(result).toEqual({ kind: 'redirect', href: 'https://booking.example/salong' });
    expect(loadBookingSeed).not.toHaveBeenCalled();
    expect(readPortalSession).not.toHaveBeenCalled();
  });

  it('takes the config’s handoff when the page passes none, and none when it passes null', async () => {
    const config = { ...PARITY_CONFIG, handoffUrl: 'https://booking.example/' };
    const { rt } = bookingRuntime({}, { config });
    expect(await loadBookingPage(rt)).toEqual({
      kind: 'redirect',
      href: 'https://booking.example/',
    });
    expect((await loadBookingPage(rt, { handoffUrl: null })).kind).toBe('ready');
  });

  it('seeds for the service the link names — the book-again key first', async () => {
    const { rt, loadBookingSeed } = bookingRuntime();
    await loadBookingPage(rt, { searchParams: { service: 'svc-2', tjeneste: 'svc-3' } });
    expect(loadBookingSeed).toHaveBeenLastCalledWith('svc-2');
    await loadBookingPage(rt, { searchParams: { service: ' ', tjeneste: 'svc-3' } });
    expect(loadBookingSeed).toHaveBeenLastCalledWith('svc-3');
    await loadBookingPage(rt, { searchParams: { tjeneste: ['a', 'b'] } });
    expect(loadBookingSeed).toHaveBeenLastCalledWith(undefined);
  });

  it('is ready with the seed, no guardian, the config, the contact and the window', async () => {
    const { rt, timing } = bookingRuntime();
    const result = await loadBookingPage(rt);
    expect(result).toEqual({
      kind: 'ready',
      seed: SEED,
      guardian: null,
      config: PARITY_CONFIG,
      contact: { phone: '22 33 44 55', address: 'Torget 1, 0001 Oslo' },
      rangeDays: 7,
    });
    expect(timing).toHaveBeenCalledWith('guardian', expect.any(Number), expect.any(Object));
  });

  it('reads the guardian alongside the seed for a visitor holding a session', async () => {
    const { rt, readPortalSession, guardianFromSession } = bookingRuntime();
    readPortalSession.mockResolvedValue(SESSION);
    const result = await loadBookingPage(rt, { contact: { phone: null, address: null } });
    expect(guardianFromSession).toHaveBeenCalledWith(SESSION);
    expect(result).toMatchObject({ guardian: { firstName: 'Kari' }, contact: { phone: null } });
  });

  it('is unavailable — with the contact — when the catalogue cannot be read or is empty', async () => {
    const { rt, loadBookingSeed, logger } = bookingRuntime();
    loadBookingSeed.mockRejectedValueOnce(new Error('Medal is down'));
    expect(await loadBookingPage(rt)).toEqual({
      kind: 'unavailable',
      contact: { phone: '22 33 44 55', address: 'Torget 1, 0001 Oslo' },
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not read the service catalogue for the booking page'
    );
    loadBookingSeed.mockResolvedValueOnce({ ...SEED, services: [] });
    expect((await loadBookingPage(rt)).kind).toBe('unavailable');
  });
});

const SUMMARY = {
  booking_id: 'b-1',
  status: 'confirmed',
  rescheduled_from_id: null,
  start_ts: '2026-09-10T08:00:00.000Z',
  end_ts: '2026-09-10T08:30:00.000Z',
  service_id: 'svc-1',
  service_name: 'Klipp',
  resource_id: null,
  resource_name: 'Første ledige',
  booked_for_name: null,
  party_sequence_id: null,
  amount_ore: 40_000,
  cancel_window_hours: 24,
  reschedule_window_hours: 24,
  can_cancel: true,
  can_reschedule: true,
};

const SERVICE = {
  id: 'svc-1',
  name: 'Klipp',
  description: null,
  category: 'barn',
  duration_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  price_ore: 40_000,
  bookable_online: true,
  max_per_booking: 3,
  weekend_surcharge_pct: 10,
};

function manageRuntime() {
  const getManage = vi.fn(async (): Promise<unknown> => SUMMARY);
  const listServices = vi.fn(async (): Promise<unknown[]> => [SERVICE]);
  const logger = testLogger();
  const rt = testRuntime({ medal: { getManage, listServices } as never }, { logger });
  return { rt, getManage, listServices, logger };
}

describe('loadManagePage', () => {
  it('is ready with the booking, its service and paths — never the token itself', async () => {
    const { rt } = manageRuntime();
    const result = await loadManagePage(rt, 'tok/en');
    expect(result).toMatchObject({
      kind: 'ready',
      booking: { bookingId: 'b-1', startTs: Date.parse(SUMMARY.start_ts), canCancel: true },
      service: { id: 'svc-1', weekendSurchargePct: 10 },
      actionPath: '/api/booking/manage/tok%2Fen',
      selfManagePath: '/bestill/administrer/tok%2Fen',
      bookingHref: '/bestill',
    });
  });

  it('points «book again» at the handoff while the manage page itself stays', async () => {
    const { rt } = manageRuntime();
    const result = await loadManagePage(rt, 'tok', { handoffUrl: 'https://booking.example/' });
    expect(result).toMatchObject({ kind: 'ready', bookingHref: 'https://booking.example/' });
  });

  it('is unknown — quietly — for a token Medal does not know, or a booking with no time', async () => {
    const { rt, getManage, logger } = manageRuntime();
    getManage.mockRejectedValueOnce(new MedalApiError(404, 'NOT_FOUND', 'gone'));
    expect(await loadManagePage(rt, 'tok')).toEqual({
      kind: 'unknown',
      bookingHref: '/bestill',
      contact: { phone: '22 33 44 55', address: 'Torget 1, 0001 Oslo' },
    });
    expect(logger.error).not.toHaveBeenCalled();
    getManage.mockResolvedValueOnce({ ...SUMMARY, start_ts: null });
    expect((await loadManagePage(rt, 'tok')).kind).toBe('unknown');
  });

  it('is unreachable — retry this page — for anything else, and logs it', async () => {
    const { rt, getManage, logger } = manageRuntime();
    getManage.mockRejectedValueOnce(new MedalApiError(502, 'UPSTREAM', 'down'));
    expect(await loadManagePage(rt, 'tok')).toMatchObject({
      kind: 'unreachable',
      retryHref: '/bestill/administrer/tok',
    });
    getManage.mockRejectedValueOnce(new Error('fetch failed'));
    expect((await loadManagePage(rt, 'tok')).kind).toBe('unreachable');
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('shows the booking without a service when the catalogue has none or cannot be read', async () => {
    const { rt, getManage, listServices, logger } = manageRuntime();
    listServices.mockResolvedValueOnce([]);
    expect(await loadManagePage(rt, 'tok')).toMatchObject({ kind: 'ready', service: null });
    listServices.mockRejectedValueOnce(new Error('down'));
    expect(await loadManagePage(rt, 'tok')).toMatchObject({ kind: 'ready', service: null });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not read the service catalogue for the manage page'
    );
    getManage.mockResolvedValueOnce({ ...SUMMARY, service_id: null });
    expect(await loadManagePage(rt, 'tok')).toMatchObject({ kind: 'ready', service: null });
  });
});

const PROFILE = { firstName: 'Kari', family: [] };
const BOOKINGS = { upcoming: [], past: [] };

function portalRuntime(options = {}) {
  const readPortalSession = vi.fn(async (): Promise<string | null> => SESSION);
  const getMe = vi.fn(async (): Promise<unknown> => PROFILE);
  const getMyBookings = vi.fn(async (): Promise<unknown> => BOOKINGS);
  const cachedResources = vi.fn(
    async (): Promise<unknown[]> => [
      { id: 'r2', name: 'Ola', photo_url: null, bio: null, service_ids: [], sort_order: 2 },
      {
        id: 'r1',
        name: 'Mia (Salong Demo)',
        photo_url: null,
        bio: null,
        service_ids: [],
        sort_order: 1,
      },
      { id: 'r3', name: ' ', photo_url: null, bio: null, service_ids: [], sort_order: 0 },
    ]
  );
  const readVippsLinkFlash = vi.fn(async () => null);
  const logger = testLogger();
  const rt = testRuntime(
    {
      session: { readPortalSession } as never,
      portal: { getMe, getMyBookings } as never,
      catalogue: { cachedResources } as never,
      flash: { readVippsLinkFlash } as never,
    },
    { logger, ...options }
  );
  return { rt, readPortalSession, getMe, getMyBookings, cachedResources, logger };
}

describe('loadPortalPage', () => {
  it('is ready with the profile, the bookings and the stylists in the business’s order', async () => {
    const { rt } = portalRuntime();
    expect(await loadPortalPage(rt)).toEqual({
      kind: 'ready',
      profile: PROFILE,
      bookings: BOOKINGS,
      stylists: [
        { id: 'r1', name: 'Mia' },
        { id: 'r2', name: 'Ola' },
      ],
      vippsFlash: null,
      bookingHref: '/bestill',
      contact: { phone: '22 33 44 55', address: 'Torget 1, 0001 Oslo' },
    });
  });

  it('is disabled when the portal is off, by config, by the site’s switch, or by having no path', async () => {
    expect(
      (await loadPortalPage(portalRuntime({ portal: { enabled: async () => false } }).rt)).kind
    ).toBe('disabled');
    const off = { ...PARITY_CONFIG, portal: { ...PARITY_CONFIG.portal, enabled: false } };
    expect((await loadPortalPage(portalRuntime({ config: off }).rt)).kind).toBe('disabled');
    const none = { ...PARITY_CONFIG, paths: { ...PARITY_CONFIG.paths, portal: null } };
    expect((await loadPortalPage(portalRuntime({ config: none }).rt)).kind).toBe('disabled');
  });

  it('sends a visitor with no session to the login', async () => {
    const { rt, readPortalSession, getMe } = portalRuntime();
    readPortalSession.mockResolvedValueOnce(null);
    expect(await loadPortalPage(rt)).toEqual({ kind: 'redirect', href: '/min-side/logg-inn' });
    expect(getMe).not.toHaveBeenCalled();
  });

  it('sends a dead session to the clearing route, even when the other read failed differently', async () => {
    const { rt, getMe, getMyBookings } = portalRuntime();
    getMe.mockRejectedValueOnce(new Error('502'));
    getMyBookings.mockRejectedValueOnce(new PortalSessionExpiredError());
    expect(await loadPortalPage(rt)).toEqual({
      kind: 'redirect',
      href: '/api/portal/session/expired',
    });
  });

  it('is unreachable when either read failed for another reason, and logs each', async () => {
    const { rt, getMe, getMyBookings, logger } = portalRuntime();
    getMe.mockRejectedValueOnce(new Error('one'));
    expect((await loadPortalPage(rt)).kind).toBe('unreachable');
    getMyBookings.mockRejectedValueOnce(new Error('two'));
    expect((await loadPortalPage(rt)).kind).toBe('unreachable');
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('shows no stylists when they cannot be read', async () => {
    const { rt, cachedResources, logger } = portalRuntime();
    cachedResources.mockRejectedValueOnce(new Error('down'));
    expect(await loadPortalPage(rt)).toMatchObject({ kind: 'ready', stylists: [] });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not read the stylists for the portal'
    );
  });
});
