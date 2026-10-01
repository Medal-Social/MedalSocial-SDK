import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedalApiError, MedalConfigError } from '../../../src/next/medal';
import { manageRoute, manageSummaryRoute } from '../../../src/next/routes/manage';
import { testLogger, testRuntime } from '../../support/next-runtime';

/**
 * The branches `manage.test.ts` does not reach, and the summary route
 * (`GET <api>/manage/<token>`), which the source site did not have.
 */

const TOKEN = 'mt_live_2f8a9c1b4d6e';

const cancelManage = vi.fn();
const rescheduleManage = vi.fn();
const getManage = vi.fn();
const expireSlots = vi.fn();
const expireBookingSeeds = vi.fn();
const logger = testLogger();

const rt = testRuntime(
  {
    medal: { cancelManage, rescheduleManage, getManage } as never,
    catalogue: { expireSlots } as never,
    seed: { expireBookingSeeds } as never,
  },
  { logger }
);

function post(body: unknown, token = TOKEN) {
  return manageRoute(
    rt,
    new Request(`https://salong.example/api/booking/manage/${token}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    token
  );
}

function get(token = TOKEN) {
  return manageSummaryRoute(
    rt,
    new Request(`https://salong.example/api/booking/manage/${token}`),
    token
  );
}

const SUMMARY = {
  booking_id: 'bk_1',
  status: 'confirmed',
  rescheduled_from_id: null,
  start_ts: '2026-09-02T09:00:00.000Z',
  end_ts: '2026-09-02T09:30:00.000Z',
  service_id: 'svc',
  service_name: 'Cut',
  resource_id: 'r1',
  resource_name: 'Stylist',
  booked_for_name: null,
  party_sequence_id: null,
  amount_ore: 49_000,
  cancel_window_hours: 24,
  reschedule_window_hours: 24,
  can_cancel: true,
  can_reschedule: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  cancelManage.mockResolvedValue({});
  rescheduleManage.mockResolvedValue({});
  getManage.mockResolvedValue(SUMMARY);
});

describe('manageRoute — guards', () => {
  it('refuses an empty token without asking Medal', async () => {
    const response = await post({ action: 'cancel' }, '');

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('token is required');
    expect(cancelManage).not.toHaveBeenCalled();
    expect(getManage).not.toHaveBeenCalled();
  });

  it('refuses a body over the ceiling before parsing it, and never asks Medal', async () => {
    const response = await post({ action: 'cancel', reason: 'x'.repeat(5 * 1024) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalidInput',
      message: 'body is too large',
    });
    expect(cancelManage).not.toHaveBeenCalled();
  });

  it('takes a body just under the ceiling', async () => {
    cancelManage.mockResolvedValueOnce(undefined);
    const response = await post({ action: 'cancel', reason: 'x'.repeat(3 * 1024) });
    expect(response.status).toBe(200);
  });

  it('refuses a JSON body that is not an object', async () => {
    for (const body of [null, 7]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe('body must be a JSON object');
    }
  });
});

describe('manageRoute — failures', () => {
  it('answers 503 unconfigured and logs it, naming the action only', async () => {
    cancelManage.mockRejectedValueOnce(new MedalConfigError('no key'));

    const response = await post({ action: 'cancel' });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unconfigured' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel' }),
      'Booking API is not configured'
    );
  });

  it.each(['VALIDATION_ERROR', 'INVALID_INPUT'])('maps %s to invalidInput', async (code) => {
    rescheduleManage.mockRejectedValueOnce(new MedalApiError(422, code, 'bad'));

    const response = await post({ action: 'reschedule', startTs: 1 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalidInput' });
  });

  it('answers 502 for a throw that is not a Medal error, and leaves the cache alone', async () => {
    rescheduleManage.mockRejectedValueOnce(new TypeError('fetch failed'));

    const response = await post({ action: 'reschedule', startTs: 1 });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstreamError' });
    expect(expireSlots).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reschedule' }),
      'Booking manage action failed'
    );
  });

  it('answers 502 for an unmapped Medal error', async () => {
    cancelManage.mockRejectedValueOnce(new MedalApiError(500, 'INTERNAL', 'boom'));

    expect((await post({ action: 'cancel' })).status).toBe(502);
  });
});

describe('manageRoute — the slot cache', () => {
  it('expires nothing when the booking names no service', async () => {
    getManage.mockResolvedValue({ ...SUMMARY, service_id: undefined });

    const response = await post({ action: 'cancel' });

    expect(response.status).toBe(200);
    expect(expireSlots).not.toHaveBeenCalled();
    expect(expireBookingSeeds).not.toHaveBeenCalled();
  });
});

describe('manageSummaryRoute', () => {
  const NO_STORE = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  const headersOf = (response: Response) => ({
    'cache-control': response.headers.get('Cache-Control'),
    'referrer-policy': response.headers.get('Referrer-Policy'),
  });

  it('refuses an empty token without asking Medal', async () => {
    const response = await get('');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalidInput', message: 'token is required' });
    expect(getManage).not.toHaveBeenCalled();
  });

  it('answers the booking as the manage page renders it, never stored', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(getManage).toHaveBeenCalledWith(TOKEN);
    expect(headersOf(response)).toEqual(NO_STORE);
    const body = await response.json();
    expect(body.booking).toMatchObject({
      bookingId: 'bk_1',
      startTs: Date.UTC(2026, 8, 2, 9),
      endTs: Date.UTC(2026, 8, 2, 9, 30),
      serviceId: 'svc',
      canCancel: true,
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('is the same 404 for a booking whose time cannot be read', async () => {
    getManage.mockResolvedValueOnce({ ...SUMMARY, start_ts: null });

    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'notFound' });
    expect(headersOf(response)).toEqual(NO_STORE);
  });

  it('is the same 404 for a token Medal does not know', async () => {
    getManage.mockRejectedValueOnce(new MedalApiError(404, 'NOT_FOUND', 'Booking not found'));

    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'notFound' });
    expect(headersOf(response)).toEqual(NO_STORE);
  });

  it('answers 502, never stored and token-free, for any other failure', async () => {
    for (const error of [
      new MedalApiError(500, 'INTERNAL', `blew up for ${TOKEN}`),
      new TypeError('fetch failed'),
    ]) {
      getManage.mockRejectedValueOnce(error);
      const response = await get();
      expect(response.status).toBe(502);
      expect(headersOf(response)).toEqual(NO_STORE);
      expect(await response.text()).not.toContain(TOKEN);
    }
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.anything(), action: 'read' },
      'Booking manage action failed'
    );
  });

  it('answers 503 unconfigured, never stored, without a key', async () => {
    getManage.mockRejectedValueOnce(new MedalConfigError('no key'));

    const response = await get();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unconfigured' });
    expect(headersOf(response)).toEqual(NO_STORE);
  });
});
