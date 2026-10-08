import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMedalSeam,
  DEFAULT_MEDAL_ENDPOINT,
  looksLikePlaceholderKey,
  MedalApiError,
  MedalConfigError,
  unwrap,
} from '../../src/next/medal';

/**
 * The seam's parts the moved suite does not reach: a key passed as a plain
 * value, the client caches, the raw-route config, and the reads and writes
 * the site's other routes make.
 */

type FetchMock = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

function stubFetch(body: unknown, status = 200): FetchMock {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json(body, { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('looksLikePlaceholderKey', () => {
  it('flags the values secret stores seed folders with, in any case and padding', () => {
    for (const key of [
      'pending',
      'Pending-provisioning',
      'placeholder',
      'CHANGEME',
      'change-me',
      'todo: fill in',
      'replace-me',
      '<your key>',
      '  pending  ',
    ]) {
      expect(looksLikePlaceholderKey(key)).toBe(true);
    }
  });

  it('passes a real-looking key', () => {
    expect(looksLikePlaceholderKey('sk_live_abc')).toBe(false);
    expect(looksLikePlaceholderKey('mk_pendingish')).toBe(false);
  });
});

describe('unwrap', () => {
  it('hands back the data, and treats a missing response as a non-JSON body', () => {
    expect(unwrap({ data: [1] }, '/x')).toEqual([1]);
    expect(() => unwrap(undefined, '/x')).toThrow(MedalApiError);
    expect(() => unwrap(undefined, '/x')).toThrow('Medal returned a non-JSON body from /x');
  });
});

describe('createMedalSeam', () => {
  it('names its config error, so a Workers log says where to look', () => {
    expect(new MedalConfigError('x').name).toBe('MedalConfigError');
  });

  it('takes the key and origin as plain values', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_value', baseUrl: 'https://api.example.com' });
    const fetchMock = stubFetch({ data: [] });

    await seam.listResources();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/bookings/resources');
    expect(header(init, 'authorization')).toBe('Bearer sk_value');
  });

  it('answers null from getMedal, and throws from every require*, without a usable key', () => {
    for (const apiKey of [undefined, '', 'placeholder']) {
      const seam = createMedalSeam({ apiKey });
      expect(seam.getMedal()).toBeNull();
      expect(() => seam.requireMedal()).toThrow(MedalConfigError);
      expect(() => seam.requireMedalWithTimeout(1_000)).toThrow(MedalConfigError);
      expect(() => seam.requireMedalConfig()).toThrow(MedalConfigError);
    }
  });

  it('keeps one client while the key and origin hold, and re-keys when either moves', () => {
    let key = 'sk_a';
    let base: string | undefined = 'https://one.example.com';
    const seam = createMedalSeam({ apiKey: () => key, baseUrl: () => base });

    const first = seam.getMedal();
    expect(seam.getMedal()).toBe(first);
    expect(seam.requireMedal()).toBe(first);

    base = 'https://two.example.com';
    const second = seam.getMedal();
    expect(second).not.toBe(first);

    key = 'sk_b';
    expect(seam.getMedal()).not.toBe(second);
  });

  it('keeps one quick client per key, origin and timeout', () => {
    let key = 'sk_a';
    let base = 'https://one.example.com';
    const seam = createMedalSeam({ apiKey: () => key, baseUrl: () => base });

    const quick = seam.requireMedalWithTimeout(2_000);
    expect(seam.requireMedalWithTimeout(2_000)).toBe(quick);
    // Not the long-deadline client.
    expect(quick).not.toBe(seam.requireMedal());

    const slower = seam.requireMedalWithTimeout(5_000);
    expect(slower).not.toBe(quick);

    base = 'https://two.example.com';
    const moved = seam.requireMedalWithTimeout(5_000);
    expect(moved).not.toBe(slower);

    key = 'sk_b';
    expect(seam.requireMedalWithTimeout(5_000)).not.toBe(moved);
  });

  it('hands the raw routes the key and origin, the origin defaulting to the HTTP-actions host', () => {
    expect(createMedalSeam({ apiKey: 'sk_x' }).requireMedalConfig()).toEqual({
      key: 'sk_x',
      base: DEFAULT_MEDAL_ENDPOINT,
    });
    expect(
      createMedalSeam({ apiKey: 'sk_x', baseUrl: 'https://api.example.com' }).requireMedalConfig()
    ).toEqual({ key: 'sk_x', base: 'https://api.example.com' });
    expect(DEFAULT_MEDAL_ENDPOINT).toBe('https://io.medalsocial.com');
  });

  it('asks availability without a resource when none is named', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    const fetchMock = stubFetch({ data: [] });

    await seam.listAvailability({ serviceId: 'svc', fromTs: 0, toTs: 1 });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/bookings/availability');
    expect(url.searchParams.get('service_id')).toBe('svc');
    expect(url.searchParams.has('resource_id')).toBe(false);
  });

  it('asks for a whole visit with its extras comma-joined, on availability and schedule', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    const fetchMock = stubFetch({ data: [] });

    await seam.listAvailability({
      serviceId: 'svc-cut',
      extraServiceIds: ['svc-wash', 'svc-style'],
      fromTs: 0,
      toTs: 1,
    });
    await seam.listSchedule({
      serviceId: 'svc-cut',
      extraServiceIds: ['svc-wash'],
      fromTs: 0,
      toTs: 1,
    });

    const availability = new URL(fetchMock.mock.calls[0][0]);
    expect(availability.searchParams.get('service_id')).toBe('svc-cut');
    expect(availability.searchParams.get('extra_service_ids')).toBe('svc-wash,svc-style');
    const schedule = new URL(fetchMock.mock.calls[1][0]);
    expect(schedule.pathname).toBe('/api/v1/bookings/schedule');
    expect(schedule.searchParams.get('extra_service_ids')).toBe('svc-wash');
  });

  it('sends no extra_service_ids for a one-service read, empty list or none', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    const fetchMock = stubFetch({ data: [] });

    await seam.listAvailability({ serviceId: 'svc', extraServiceIds: [], fromTs: 0, toTs: 1 });
    await seam.listSchedule({ serviceId: 'svc', fromTs: 0, toTs: 1 });

    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(url).searchParams.has('extra_service_ids')).toBe(false);
    }
  });

  it('returns only the bookings from a create', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    stubFetch({ data: { bookings: [{ id: 'b1', manage_token: 'mt' }], contact_id: 'c' } });

    await expect(
      seam.createBooking(
        { items: [{ service_id: 'svc', start_ts: 1 }], contact: { phone: '40000000' } },
        'idem'
      )
    ).resolves.toEqual({ bookings: [{ id: 'b1', manage_token: 'mt' }] });
  });

  it('files the marketing consent on the GDPR route', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    const fetchMock = stubFetch({ data: { id: 'consent-1' } });

    const body = { consent_type: 'marketing_email' as const, granted: true, email: 'a@b.example' };
    await expect(seam.recordConsent(body as never)).resolves.toEqual({ id: 'consent-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v1/gdpr/consent');
    expect(JSON.parse(init.body as string)).toMatchObject({ consent_type: 'marketing_email' });
  });

  it('cancels with the reason and idempotency key when given', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    const fetchMock = stubFetch({ data: { success: true } });

    await expect(seam.cancelManage('tok', 'sick', 'idem-c')).resolves.toEqual({ success: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v1/bookings/manage/tok/cancel');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'sick' });
    expect(header(init, 'idempotency-key')).toBe('idem-c');
  });

  it('cancels without a reason or caller key when given none', async () => {
    const seam = createMedalSeam({ apiKey: 'sk_x' });
    const fetchMock = stubFetch({ data: { success: true } });

    await seam.cancelManage('tok');

    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v1/bookings/manage/tok/cancel');
    // No reason field at all, rather than `reason: undefined` the engine might read.
    expect(JSON.parse((init.body as string | undefined) ?? '{}')).toEqual({});
  });
});
