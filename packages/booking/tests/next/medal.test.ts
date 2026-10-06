import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMedalSeam, MedalApiError, MedalConfigError } from '../../src/next/medal';
import { redactSession } from '../../src/next/redact';

/**
 * The seam reads its key and origin per call; read from the environment here,
 * so `vi.stubEnv` drives it exactly as it drove the module it was moved from.
 */
const { createBooking, getManage, listAvailability, listSchedule, listServices, rescheduleManage } =
  createMedalSeam({
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  });

/**
 * The seam is now backed by `@medalsocial/sdk`, which also goes through
 * `globalThis.fetch` — so these tests still stub `fetch` and assert on the wire,
 * which is the contract the ten consumers actually depend on. What they must NOT
 * do is assert on the SDK's internals (header casing, retry cadence); where the
 * old hand-rolled client and the SDK differ on those, the test reads through
 * `Headers` or picks a status the SDK does not retry.
 */

/** A token of the shape Medal issues. */
const SESSION = 's'.repeat(43);

type FetchMock = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

function stubFetch(body: unknown, status = 200): FetchMock {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json(body, { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The SDK hands `fetch` a `Headers` instance, not a plain object. */
function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

describe('medal-client', () => {
  // Nothing here restored anything, so `MEDAL_API_ENDPOINT` used to leak from
  // the one test that sets it into every test declared after it. The `fetch`
  // stub leaks the same way, and that is the worse of the two: a test that
  // forgot to stub it would inherit the previous mock and pass for the wrong
  // reason.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refuses to run without an API key rather than calling Medal anonymously', async () => {
    vi.stubEnv('MEDAL_API_KEY', '');
    const fetchMock = stubFetch({ data: [] });
    await expect(listServices()).rejects.toBeInstanceOf(MedalConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an unreplaced "pending" placeholder as missing configuration', async () => {
    // Infisical seeds new folders with placeholder secrets, so a real
    // deployment can hold a syntactically present key that Medal will reject.
    // Catching it here turns a confusing 401 into an obvious config error.
    vi.stubEnv('MEDAL_API_KEY', 'pending-provisioning');
    const fetchMock = stubFetch({ data: [] });
    await expect(listServices()).rejects.toBeInstanceOf(MedalConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the key as a bearer token and never in the query string', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    vi.stubEnv('MEDAL_API_ENDPOINT', 'https://api.example.com');
    const fetchMock = stubFetch({ data: [] });

    await listServices();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/bookings/services');
    expect(header(init, 'authorization')).toBe('Bearer sk_test');
    expect(url).not.toContain('sk_test');
  });

  it('passes the caller’s idempotency key on create so a retried tap cannot double-book', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: { bookings: [], contact_id: 'c' } });

    await createBooking(
      { items: [{ service_id: 'svc', start_ts: 1 }], contact: { phone: '40000000' } },
      'idem-123'
    );

    const [, init] = fetchMock.mock.calls[0];
    // The caller's key, not one the SDK minted: the wizard derives it from its
    // own submission nonce so a retry across ITS OWN requests replays too.
    expect(header(init, 'idempotency-key')).toBe('idem-123');
  });

  /**
   * The salon's whole reason for paying for this site is that bookings arrive
   * through it. If the engine files them as `api` — the same provenance a
   * Zapier integration gets — then "how many bookings did the website bring
   * in" is a question nobody can answer.
   */
  it("declares created_via 'web' so the salon's own site is not filed as an integration", async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: { bookings: [], contact_id: 'c' } });

    await createBooking(
      { items: [{ service_id: 'svc', start_ts: 1 }], contact: { phone: '40000000' } },
      'idem-123'
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).created_via).toBe('web');
  });

  it('does not let a caller override the provenance to something it is not', async () => {
    // Provenance is a fact about THIS deployment, not a per-call option.
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: { bookings: [], contact_id: 'c' } });

    await createBooking(
      {
        items: [{ service_id: 'svc', start_ts: 1 }],
        contact: { phone: '40000000' },
        // @ts-expect-error created_via is not part of CreateBookingBody — the
        // module sets it, callers do not.
        created_via: 'api',
      },
      'idem-123'
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).created_via).toBe('web');
  });

  it('forwards a portal session on create as X-Portal-Session, and none without one', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: { bookings: [], contact_id: 'c' } });
    const body = { items: [{ service_id: 'svc', start_ts: 1 }], contact: { phone: '40000000' } };

    await createBooking(body, 'idem-1', { portalSession: SESSION });
    await createBooking(body, 'idem-2');

    expect(header(fetchMock.mock.calls[0][1], 'x-portal-session')).toBe(SESSION);
    expect(header(fetchMock.mock.calls[0][1], 'idempotency-key')).toBe('idem-1');
    expect(header(fetchMock.mock.calls[1][1], 'x-portal-session')).toBeNull();
  });

  it('scrubs the portal session out of what create throws, keeping the error’s identity', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    stubFetch({ error: { code: 'BAD', message: `no session ${SESSION} here` } }, 400);

    const thrown = await createBooking(
      { items: [{ service_id: 'svc', start_ts: 1 }], contact: { phone: '40000000' } },
      'idem-1',
      { portalSession: SESSION }
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(MedalApiError);
    expect((thrown as MedalApiError).status).toBe(400);
    expect(String((thrown as Error).message)).not.toContain(SESSION);
    expect(String((thrown as Error).stack)).not.toContain(SESSION);
  });

  it('rethrows a create failure untouched when no session went with it', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    stubFetch({ error: { code: 'BAD', message: 'plain' } }, 400);

    await expect(
      createBooking(
        { items: [{ service_id: 'svc', start_ts: 1 }], contact: { phone: '40000000' } },
        'idem-1'
      )
    ).rejects.toBeInstanceOf(MedalApiError);
  });

  it('reschedules on new_start_ts, the field the engine actually requires', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: { success: true, booking_id: 'b2' } });

    await rescheduleManage('tok', Date.UTC(2026, 8, 2, 11), 'idem-456');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://io.medalsocial.com/api/v1/bookings/manage/tok/reschedule');
    expect(JSON.parse(init.body as string)).toEqual({
      new_start_ts: '2026-09-02T11:00:00.000Z',
    });
    expect(header(init, 'idempotency-key')).toBe('idem-456');
  });

  it('asks for the schedule with ISO bounds and the same params as availability', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: [] });

    await listSchedule({
      serviceId: 'svc',
      resourceId: 'res',
      fromTs: Date.UTC(2026, 8, 1),
      toTs: Date.UTC(2026, 8, 8),
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/bookings/schedule');
    expect(url.searchParams.get('service_id')).toBe('svc');
    expect(url.searchParams.get('resource_id')).toBe('res');
    expect(url.searchParams.get('from_ts')).toBe('2026-09-01T00:00:00.000Z');
    expect(url.searchParams.get('to_ts')).toBe('2026-09-08T00:00:00.000Z');
  });

  it('surfaces the engine error code so callers can write copy from it', async () => {
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    stubFetch({ error: { code: 'CONFLICT', message: 'SLOT_TAKEN: gone' } }, 409);

    // `toMatchObject` alone would pass for a plain Error carrying the same own
    // properties, and every consumer narrows these by `instanceof` — so assert
    // the class, not just the shape.
    const rejection = listAvailability({ serviceId: 's', fromTs: 0, toTs: 1 });
    await expect(rejection).rejects.toBeInstanceOf(MedalApiError);
    await expect(rejection).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    await expect(rejection).rejects.toMatchObject({ name: 'MedalApiError' });
  });

  it('falls back to the HTTP-actions origin, not the dashboard, when none is configured', async () => {
    // `app.medalsocial.com` is the dashboard and `io.medalsocial.com` is where
    // `/api/v1/...` is actually served. The dashboard answers the same path
    // with a 200 HTML "Page not found", so the wrong origin fails as a JSON
    // parse error a couple of layers away and reads like a Medal outage.
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const fetchMock = stubFetch({ data: [] });

    await listServices();

    expect(fetchMock.mock.calls[0][0]).toBe('https://io.medalsocial.com/api/v1/bookings/services');
  });

  it('treats a 200 that is not JSON as a failure rather than an empty result', async () => {
    // Reachable by typo alone: a `MEDAL_API_ENDPOINT` aimed at a host that
    // answers with an HTML page. The SDK hands that body back as-is, so
    // without this the `undefined` travels into whichever route tried to
    // `.map` over it and surfaces there, in a file with nothing wrong in it.
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    vi.stubGlobal(
      'fetch',
      async () => new Response('<!doctype html><title>Not the API</title>', { status: 200 })
    );

    const rejection = listServices();
    await expect(rejection).rejects.toBeInstanceOf(MedalApiError);
    await expect(rejection).rejects.toThrow(/non-JSON body/);
  });

  it('keeps the manage token out of the error message', async () => {
    // A manage token is a bearer credential for one booking — it is enough to
    // cancel or move that appointment — and it travels in the path. Quoting
    // the path verbatim would publish it to a log stream that outlives the
    // booking. A 404 rather than a 500: the SDK retries 5xx with backoff, and
    // the property under test holds for every status.
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    stubFetch({}, 404);

    const thrown = await getManage('mt_live_supersecret').catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(MedalApiError);
    const { message } = thrown as MedalApiError;
    expect(message).not.toContain('supersecret');
  });

  it('fills the engine’s own fallbacks for a deleted catalogue row, and refuses a booking with no status', async () => {
    // The engine documents «Unknown service» / «Unknown resource» for a row
    // whose service or stylist has since been deleted, and never emits a null
    // status. The seam's `MedalManageSummary` is typed on that word, so this
    // is where the word is made true — not asserted.
    vi.stubEnv('MEDAL_API_KEY', 'sk_test');
    const base = {
      booking_id: 'b1',
      status: 'confirmed',
      start_ts: '2026-09-03T09:00:00.000Z',
      end_ts: '2026-09-03T09:30:00.000Z',
      service_name: null,
      resource_name: null,
      can_cancel: true,
      can_reschedule: true,
    };
    stubFetch({ data: base });
    const summary = await getManage('tok');
    expect(summary.service_name).toBe('Unknown service');
    expect(summary.resource_name).toBe('Unknown resource');

    stubFetch({ data: { ...base, status: null } });
    await expect(getManage('tok')).rejects.toMatchObject({ code: 'MALFORMED_SUMMARY' });
  });

  it('re-keys the client when the environment changes rather than pinning the first key', async () => {
    // A long-lived isolate must not keep sending a key that a later request's
    // environment no longer holds — and these tests swap the env per case.
    const fetchMock = stubFetch({ data: [] });
    vi.stubEnv('MEDAL_API_KEY', 'sk_first');
    await listServices();
    vi.stubEnv('MEDAL_API_KEY', 'sk_second');
    await listServices();

    expect(header(fetchMock.mock.calls[0][1], 'authorization')).toBe('Bearer sk_first');
    expect(header(fetchMock.mock.calls[1][1], 'authorization')).toBe('Bearer sk_second');
  });
});

describe("redactSession (the create route's forwarded session)", () => {
  const SECRET = 'x'.repeat(43);

  it('cuts the secret out of message, stack and the cause chain, in place', () => {
    const inner = new Error(`inner ${SECRET}`);
    const error = new Error(`outer ${SECRET}`, { cause: inner });

    expect(redactSession(error, SECRET)).toBe(error);
    expect(error.message).toBe('outer <session>');
    expect(error.stack).not.toContain(SECRET);
    expect(inner.message).toBe('inner <session>');
  });

  it('rewrites a string cause that holds the secret and keeps one that does not', () => {
    const leaking = new Error('x', { cause: `cause ${SECRET}` });
    redactSession(leaking, SECRET);
    expect(leaking.cause).toBe('cause <session>');

    const clean = new Error('x', { cause: 'harmless' });
    redactSession(clean, SECRET);
    expect(clean.cause).toBe('harmless');
  });

  it('replaces a bare string throw holding the secret, and passes anything else through', () => {
    const replaced = redactSession(`thrown ${SECRET}`, SECRET);
    expect(replaced).toBeInstanceOf(Error);
    expect((replaced as Error).message).toBe('thrown <session>');
    expect(redactSession('harmless', SECRET)).toBe('harmless');
    const other = { code: 1 };
    expect(redactSession(other, SECRET)).toBe(other);
  });

  it('leaves a getter-only message alone and still scrubs the rest', () => {
    const inner = new Error(`inner ${SECRET}`);
    const error = new Error('outer', { cause: inner });
    Object.defineProperty(error, 'message', { get: () => `fixed ${SECRET}` });
    error.stack = `Error: at ${SECRET}`;

    expect(() => redactSession(error, SECRET)).not.toThrow();
    expect(error.stack).toBe('Error: at <session>');
    expect(inner.message).toBe('inner <session>');
  });

  it('stops following a cause chain after three links', () => {
    const deepest = new Error(`deepest ${SECRET}`);
    let error: Error = deepest;
    for (let i = 0; i < 4; i++) error = new Error('link', { cause: error });

    redactSession(error, SECRET);

    expect(deepest.message).toContain(SECRET);
  });
});
