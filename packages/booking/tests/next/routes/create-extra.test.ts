import { beforeEach, describe, expect, it, vi } from 'vitest';

/** `after` needs a request scope; here it runs the work at once. */
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((work: () => unknown) => void work()) };
});

import { createRoute } from '../../../src/next/routes/create';
import { testLogger, testRuntime } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The branches `create.test.ts` does not reach: malformed bodies the wizard
 * never sends, an unmapped throw, a site with no marketing box, and the phone
 * rule's quieter answers.
 */

const createBooking = vi.fn();
const recordConsent = vi.fn();
const readPortalSession = vi.fn();
const getMe = vi.fn();
const logger = testLogger();

const expireSlots = vi.fn();
const overrides = {
  medal: { createBooking, recordConsent } as never,
  catalogue: { expireSlots, cachedAvailability: vi.fn() } as never,
  seed: { expireBookingSeeds: vi.fn() } as never,
  session: { readPortalSession } as never,
  portal: { getMe } as never,
};
const rt = testRuntime(overrides, { logger });

function request(body: unknown): Request {
  return new Request('https://salong.example/api/booking/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const PERSON_REQUEST = {
  items: [{ serviceId: 'svc', startTs: 1, bookedForName: 'Jonas', bookedForPersonId: 'p-jonas' }],
  contact: { phone: '40000000' },
  consentTerms: true,
};

const PROFILE = {
  phone: '+47 400 00 000',
  family: [
    { personId: null, name: 'Guest' },
    { personId: 'p-jonas', name: 'Jonas' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  createBooking.mockResolvedValue({ bookings: [{ id: 'bk_1', manage_token: 'mt_1' }] });
  recordConsent.mockResolvedValue({});
  readPortalSession.mockResolvedValue('session-token');
  getMe.mockResolvedValue(PROFILE);
});

describe('createRoute — malformed bodies', () => {
  it('refuses a JSON body that is not an object', async () => {
    for (const body of [null, 5, 'text']) {
      const response = await createRoute(rt, request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'invalidInput',
        message: 'body must be a JSON object',
      });
    }
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('refuses a body over the ceiling before parsing it, and never asks Medal', async () => {
    const response = await createRoute(
      rt,
      request({ ...PERSON_REQUEST, notes: 'x'.repeat(33 * 1024) })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalidInput',
      message: 'body is too large',
    });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('counts the ceiling in bytes, not characters', async () => {
    // 12k three-byte characters: 36 KiB on the wire, 12k code units decoded.
    const response = await createRoute(
      rt,
      request({ ...PERSON_REQUEST, notes: '\u20ac'.repeat(12 * 1024) })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('body is too large');
  });

  it('refuses a body that is not JSON', async () => {
    const response = await createRoute(
      rt,
      new Request('https://salong.example/api/booking/create', { method: 'POST', body: '{' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('body must be valid JSON');
  });

  it('names the line whose service is blank', async () => {
    const response = await createRoute(
      rt,
      request({
        items: [{ serviceId: '  ', startTs: 1 }],
        contact: { phone: '40000000' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('items.0.serviceId is required');
    expect(createBooking).not.toHaveBeenCalled();
  });
});

describe('createRoute — failures', () => {
  it('answers 502 and logs a throw it has no mapping for', async () => {
    createBooking.mockRejectedValueOnce(new TypeError('fetch failed'));

    const response = await createRoute(rt, request(PERSON_REQUEST));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstreamError' });
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'Booking create failed');
  });
});

describe('createRoute — a site with no marketing box', () => {
  it('files no consent even for a ticked box', async () => {
    const noBox = testRuntime(overrides, {
      logger,
      config: { ...PARITY_CONFIG, consent: { ...PARITY_CONFIG.consent, marketing: null } },
    });

    const response = await createRoute(
      noBox,
      request({
        items: [{ serviceId: 'svc', startTs: 1 }],
        contact: { phone: '40000000', email: 'parent@example.com' },
        consentTerms: true,
        consentMarketing: true,
      })
    );

    expect(response.status).toBe(201);
    expect(recordConsent).not.toHaveBeenCalled();
  });
});

describe('createRoute — the phone rule', () => {
  it('skips a family member with no id and still forwards the parent’s own child', async () => {
    await createRoute(rt, request(PERSON_REQUEST));

    expect(createBooking.mock.calls[0][0].items[0]).toMatchObject({
      booked_for_person_id: 'p-jonas',
    });
  });

  it('sends names only when the profile has no phone to compare', async () => {
    getMe.mockResolvedValueOnce({ ...PROFILE, phone: null });

    const response = await createRoute(rt, request(PERSON_REQUEST));

    expect(response.status).toBe(201);
    expect(createBooking.mock.calls[0][0].items[0]).not.toHaveProperty('booked_for_person_id');
  });

  it('ignores an id that is not shaped like one, asking Medal nothing', async () => {
    await createRoute(
      rt,
      request({
        ...PERSON_REQUEST,
        items: [{ ...PERSON_REQUEST.items[0], bookedForPersonId: 'a b' }],
      })
    );

    expect(readPortalSession).not.toHaveBeenCalled();
    expect(createBooking.mock.calls[0][0].items[0]).not.toHaveProperty('booked_for_person_id');
  });
});

describe('createRoute — an answer that is not one booking per line', () => {
  const TWO = {
    items: [
      { serviceId: 'svc', startTs: 1, bookedForName: 'Jonas' },
      { serviceId: 'svc', startTs: 2, bookedForName: 'Ida' },
    ],
    contact: { phone: '40000000', email: 'kari@example.test' },
    consentTerms: true,
    consentMarketing: true,
  };

  it.each([
    ['no bookings', { bookings: [] }],
    ['no bookings array', {}],
    ['one booking for two lines', { bookings: [{ id: 'bk_1', manage_token: 'mt_1' }] }],
    [
      'three bookings for two lines',
      { bookings: [{ id: 'bk_1' }, { id: 'bk_2' }, { id: 'bk_3' }] },
    ],
    ['a booking with no id', { bookings: [{ id: 'bk_1' }, { id: '' }] }],
    ['a booking whose id is not a string', { bookings: [{ id: 'bk_1' }, { id: 7 }] }],
  ])(
    'answers %s as the generic create failure, files no consent, still expires the caches',
    async (_name, result) => {
      createBooking.mockResolvedValueOnce(result);
      const response = await createRoute(rt, request(TWO));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'upstreamError' });
      expect(recordConsent).not.toHaveBeenCalled();
      expect(expireSlots).toHaveBeenCalledWith(['svc', 'svc']);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ expected: 2 }),
        'Booking create answered without one booking per line'
      );
    }
  );
});
