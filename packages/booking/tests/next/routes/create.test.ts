import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `after` runs its callback once the response has gone out, and there is no
 * response and no request scope here — the handler is called directly. Standing
 * in for it keeps the rest of `next/server` real (the route builds a
 * `NextResponse`) while letting these tests watch the detached work happen.
 */
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((work: () => unknown) => void work()) };
});

import { after } from 'next/server';
import { createClock } from '../../../src/core/clock';
import { marketingConsent } from '../../../src/core/consent';
import { MedalApiError, MedalConfigError } from '../../../src/next/medal';
import { PortalSessionExpiredError } from '../../../src/next/portal/medal-portal';
import { createRoute } from '../../../src/next/routes/create';
import { testLogger, testRuntime } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

/** The Medal seam's two writes. */
const createBooking = vi.fn();
const recordConsent = vi.fn();

/** The slot cache. What it does with the ids is the catalogue tests'. */
const expireSlots = vi.fn();
const cachedAvailability = vi.fn();

/** The portal session and the profile behind it — the phone rule's two reads. */
const portal = {
  readPortalSession: vi.fn<() => Promise<string | null>>(async () => null),
  getMe: vi.fn(),
};

/** This colo's booking seeds; what it deletes is the seed tests'. */
const expireBookingSeeds = vi.fn();

const rt = testRuntime(
  {
    medal: { createBooking, recordConsent } as never,
    catalogue: { expireSlots, cachedAvailability } as never,
    seed: { expireBookingSeeds } as never,
    session: { readPortalSession: portal.readPortalSession } as never,
    portal: { getMe: portal.getMe } as never,
  },
  { logger: testLogger() }
);

const POST = (request: Request) => createRoute(rt, request);

/** The sentence the site's marketing box shows (the parity config's). */
const MARKETING_CONSENT_TEXT = marketingConsent(PARITY_CONFIG)?.text;

/** The business's own window, on the business's clock. */
const salonWindow = createClock(PARITY_CONFIG).window;

function request(body: unknown): Request {
  return new Request('https://salong.example/api/booking/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** The shape the wizard submits when a parent fills in everything asked of them. */
function validRequest(): Request {
  return request({
    items: [{ serviceId: 'svc', startTs: 1, bookedForName: 'Jonas' }],
    contact: { phone: '40000000', name: 'Kari' },
    consentTerms: true,
  });
}

/** The first argument `createBooking` was called with — the Medal-shaped body. */
function submittedBody() {
  return vi.mocked(createBooking).mock.calls[0][0];
}

/** The `Idempotency-Key` derived for the nth call. */
function keyOf(call: number): string {
  return vi.mocked(createBooking).mock.calls[call][1];
}

/**
 * The nonce the wizard mints once when step 4 comes up and resends unchanged on
 * every retry of that submission. A UUID because that is what `crypto.randomUUID`
 * gives it; nothing here depends on the shape.
 */
const NONCE = '9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

/** The same submission the wizard would send twice if the first POST stalled. */
function nonceRequest(overrides: Record<string, unknown> = {}): Request {
  return request({
    items: [{ serviceId: 'svc', startTs: 1, bookedForName: 'Jonas' }],
    contact: { phone: '40000000', name: 'Kari' },
    consentTerms: true,
    submissionNonce: NONCE,
    ...overrides,
  });
}

/** A submission with the marketing box ticked and somewhere to send the mail. */
function optedInRequest(overrides: Record<string, unknown> = {}): Request {
  return request({
    items: [{ serviceId: 'svc', startTs: 1 }],
    contact: { phone: '40000000', email: 'kari@example.no' },
    consentTerms: true,
    consentMarketing: true,
    ...overrides,
  });
}

beforeEach(() => {
  // `after` is a module-level `vi.fn`, so its call log outlives the test that
  // filled it unless it is emptied here.
  vi.mocked(after).mockClear();
  vi.mocked(expireSlots).mockClear();
  vi.mocked(expireBookingSeeds).mockClear();
  vi.mocked(createBooking).mockReset();
  vi.mocked(recordConsent).mockReset();
  vi.mocked(recordConsent).mockResolvedValue({});
  // One booking per line, as Medal answers a whole create.
  vi.mocked(createBooking).mockImplementation(async (body: { items: unknown[] }) => ({
    bookings: body.items.map((_, index) => ({
      id: `bk_${index + 1}`,
      manage_token: `mt_live_${index + 1}`,
    })),
  }));
});

describe('POST /api/booking/create', () => {
  /**
   * The bug this route shipped with, stated as a test.
   *
   * `crypto.randomUUID()` inside the handler is a fresh key for every POST, so
   * the second tap on «Bekreft time» was a second booking — the exact thing an
   * `Idempotency-Key` exists to prevent, and the thing the comment above it
   * claimed it was doing.
   */
  it('derives the same key for a retry of the same submission, so a double-tap books once', async () => {
    await POST(nonceRequest());
    await POST(nonceRequest());

    expect(createBooking).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));

    // A hash, not the nonce relayed. Taking the client's value as the key would
    // be a cross-customer leak: Medal's idempotency store is workspace-scoped,
    // so a second visitor arriving on a colliding key is handed the first one's
    // cached response — manage token included, which is a live credential for
    // somebody else's appointment.
    expect(keyOf(0)).not.toBe(NONCE);
    expect(keyOf(0)).toMatch(/^[0-9a-f]{64}$/);
    // And it never reaches Medal: it identifies an attempt, and the create body
    // has nowhere to put one.
    expect('submissionNonce' in submittedBody()).toBe(false);
  });

  it('refuses an address that cannot receive anything, before booking', () => {
    // The engine takes `email` as `.trim().max(320)` with no shape check and no
    // `min`, so `kari@` is a 200 as far as it is concerned: the appointment is
    // made and its confirmation and calendar invitation go nowhere. Step 4
    // checks the same shape at the field; this is the boundary saying it again,
    // because the route is reachable without the wizard.
    return POST(nonceRequest({ contact: { phone: '40000000', email: 'kari@' } })).then(
      async (response) => {
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe('invalidInput');
        expect(createBooking).not.toHaveBeenCalled();
      }
    );
  });

  it('still books when no address was given, because the field is optional', async () => {
    const response = await POST(nonceRequest({ contact: { phone: '40000000', email: '  ' } }));

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalled();
    // Blank is `undefined`, not `''` — `JSON.stringify` drops the key on the
    // wire, and the engine's `.min(1)` fields refuse an empty string.
    expect(submittedBody().contact.email).toBeUndefined();
  });

  it('derives a different key for a different body, so two families are two bookings', async () => {
    await POST(nonceRequest());
    // Same nonce, deliberately: this is the collision the body is mixed in to
    // survive. Two visitors who somehow shared a nonce still differ in the one
    // field the engine dedupes families on.
    await POST(nonceRequest({ contact: { phone: '40000001', name: 'Ola' } }));

    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('derives a different key for a different attempt at the same booking', async () => {
    await POST(nonceRequest());
    await POST(nonceRequest({ submissionNonce: 'a-second-visit-to-step-four' }));

    // The only assertion here that fails if the nonce stops being mixed in.
    // Hashing the body alone passes every other test in this group — and would
    // then refuse the parent who books a second identical visit rather than
    // booking it.
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('derives the key from the canonical body, not from the bytes that arrived', async () => {
    await POST(nonceRequest());
    // The same submission with the whitespace a form leaves behind. It maps to
    // the same booking — `toMedalBody` trims it away — so it had better map to
    // the same key, or a retry from a browser that re-serialised the form books
    // twice.
    await POST(nonceRequest({ contact: { phone: ' 40000000 ', name: ' Kari ' } }));

    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('still books without a nonce, one key per request', async () => {
    // An older wizard, or anything that is not the wizard. It loses the
    // guarantee, not the appointment: refusing it would turn a missing nicety
    // into an outage.
    const response = await POST(validRequest());
    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(keyOf(0)).not.toHaveLength(0);

    await POST(validRequest());
    expect(keyOf(1)).not.toBe(keyOf(0));

    // A nonce of pure whitespace is not a nonce. It falls back the same way
    // rather than hashing every such caller onto one shared key — which would
    // be the leak again, with an empty string as the collision.
    await POST(nonceRequest({ submissionNonce: '   ' }));
    await POST(nonceRequest({ submissionNonce: '   ' }));
    expect(keyOf(3)).not.toBe(keyOf(2));
  });

  /**
   * The single highest-value test here.
   *
   * The wizard seeds `contact.name`, `contact.email`, `notes` and
   * `bookedForName` to `''`, because an empty text input has no other value.
   * The engine takes `name` and `booked_for_name` as
   * `z.string().trim().min(1).optional()` — where `''` is a 400, not a shrug —
   * while `email` next to them has no `min` at all and lets it through. Two
   * adjacent optional fields, opposite answers to the same input.
   *
   * So a parent who skips «Ditt navn» or leaves «Hvem skal klippes?» blank
   * would fail to book at all, and the error would name a field they
   * deliberately left empty. `medal-client.ts` deliberately does not coalesce —
   * its comments say the decision belongs here — so here is the only place this
   * can be caught.
   *
   * `bookedForBirthYear` is the same bug in a different type: an emptied number
   * input serialises as `null`, and `z.number().optional()` refuses null.
   */
  it('sends undefined, never a blank, for every optional field the wizard seeds empty', async () => {
    await POST(
      request({
        items: [
          {
            serviceId: 'svc',
            startTs: 1,
            bookedForName: '   ',
            bookedForBirthYear: null,
          },
        ],
        contact: { phone: '40000000', name: '', email: '  ' },
        notes: '',
        consentTerms: true,
      })
    );

    const body = submittedBody();
    expect(body.contact.name).toBeUndefined();
    expect(body.contact.email).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect(body.items[0].booked_for_name).toBeUndefined();
    expect(body.items[0].booked_for_birth_year).toBeUndefined();
    // The one field that must survive: it is the booking's identity key.
    expect(body.contact.phone).toBe('40000000');
  });

  it('omits resource_id for «Første ledige» rather than sending null', async () => {
    // `resolvedResourceId` is `string | null`, and null is the ORDINARY value —
    // it is the default choice on step 2 and the one the salon prefers. The
    // engine takes `resource_id` as `z.string().trim().min(1).optional()`,
    // which refuses null, so relaying it would break the common path and leave
    // only the "I want Nadia" bookings working.
    await POST(
      request({
        items: [{ serviceId: 'svc', startTs: 1, resourceId: null }],
        contact: { phone: '40000000' },
        consentTerms: true,
      })
    );

    expect(submittedBody().items[0].resource_id).toBeUndefined();
  });

  it('passes through the values a parent did fill in', async () => {
    await POST(
      request({
        items: [
          {
            serviceId: 'svc',
            startTs: 1700,
            resourceId: 'r1',
            bookedForName: ' Jonas ',
            bookedForBirthYear: 2017,
          },
        ],
        contact: { phone: ' 40000000 ', name: ' Kari ', email: ' kari@example.no ' },
        notes: ' Redd for saks ',
        consentTerms: true,
      })
    );

    expect(submittedBody()).toEqual({
      items: [
        {
          service_id: 'svc',
          resource_id: 'r1',
          start_ts: 1700,
          booked_for_name: 'Jonas',
          booked_for_birth_year: 2017,
        },
      ],
      contact: { phone: '40000000', name: 'Kari', email: 'kari@example.no' },
      notes: 'Redd for saks',
    });
  });

  /**
   * J2's rule, and the one the report puts above every other: one request
   * carrying both children.
   *
   * The engine groups multi-item submissions under a `partySequenceId` and
   * creates them in a single mutation, so either both bookings exist or neither
   * does. A route that looped and posted once per child would throw that away —
   * the second POST can fail on a slot the first one just took — and a parent
   * would be told both children were booked when one of them was not.
   */
  it('books a whole family in one request, all-or-nothing', async () => {
    vi.mocked(createBooking).mockResolvedValue({
      bookings: [
        { id: 'bk_jonas', manage_token: 'mt_live_jonas' },
        { id: 'bk_emma', manage_token: 'mt_live_emma' },
      ],
    });

    const response = await POST(
      request({
        items: [
          {
            serviceId: 'svc-gutteklipp',
            resourceId: 'res-marcus',
            startTs: 1700,
            bookedForName: 'Jonas',
          },
          {
            serviceId: 'svc-jenteklipp',
            resourceId: 'res-sara',
            startTs: 1700,
            bookedForName: 'Emma',
          },
        ],
        contact: { phone: '40000000', name: 'Kari' },
        consentTerms: true,
      })
    );

    expect(createBooking).toHaveBeenCalledTimes(1);
    // In basket order, each with its own stylist: a parallel party is two
    // children with two different people at the same minute, and collapsing
    // them onto one id books one of them into a chair that is taken.
    expect(submittedBody().items).toEqual([
      {
        service_id: 'svc-gutteklipp',
        resource_id: 'res-marcus',
        start_ts: 1700,
        booked_for_name: 'Jonas',
        booked_for_birth_year: undefined,
      },
      {
        service_id: 'svc-jenteklipp',
        resource_id: 'res-sara',
        start_ts: 1700,
        booked_for_name: 'Emma',
        booked_for_birth_year: undefined,
      },
    ]);
    // Both manage tokens travel back: each child's appointment is separately
    // moveable, which is what J4/J5's «hele besøket eller bare én?» rests on.
    expect((await response.json()).bookings).toEqual([
      { id: 'bk_jonas', manageToken: 'mt_live_jonas' },
      { id: 'bk_emma', manageToken: 'mt_live_emma' },
    ]);
  });

  /** Every line is checked, not just the first: a party whose second child has
   * no start time is a malformed submission, and answering it locally names the
   * line rather than relaying a wire path the parent has never seen. */
  it('refuses a party whose second child is malformed, before Medal is called', async () => {
    const response = await POST(
      request({
        items: [
          { serviceId: 'svc-gutteklipp', startTs: 1700 },
          { serviceId: 'svc-jenteklipp', startTs: null },
        ],
        contact: { phone: '40000000' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('refuses a submission without the terms consent, before Medal is called', async () => {
    const response = await POST(
      request({
        items: [{ serviceId: 'svc', startTs: 1 }],
        contact: { phone: '40000000' },
        consentTerms: false,
      })
    );

    expect(response.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('refuses a submission with no phone number, before Medal is called', async () => {
    // Phone is the CRM's dedupe key, so the engine requires it — but a blank
    // one is also what an abandoned form leaves behind.
    const response = await POST(
      request({
        items: [{ serviceId: 'svc', startTs: 1 }],
        contact: { phone: '   ' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('refuses an empty basket, before Medal is called', async () => {
    const response = await POST(
      request({ items: [], contact: { phone: '40000000' }, consentTerms: true })
    );

    expect(response.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('refuses a start time that is not a finite number', async () => {
    // `null` is the value a cleared slot serialises to, and `Number(null)` is
    // 0 — so a lenient parse would book a haircut in January 1970.
    const response = await POST(
      request({
        items: [{ serviceId: 'svc', startTs: null }],
        contact: { phone: '40000000' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(400);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('treats a body that is not JSON as bad input rather than an upstream failure', async () => {
    const response = await POST(
      new Request('https://salong.example/api/booking/create', { method: 'POST', body: 'not json' })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalidInput');
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('translates a taken slot into a code the wizard can act on', async () => {
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: the requested time is no longer available')
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('slotTaken');
  });

  it('keeps a non-slot conflict distinct, because the wizard answers them differently', async () => {
    // `slotTaken` sends the visitor back to step 3 with the neighbouring times
    // highlighted. Any other 409 — a duplicate submission, a party the engine
    // could not seat — has no slot to go back to.
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(409, 'CONFLICT', 'Idempotency-Key was used for a different request')
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('conflict');
  });

  it('maps the code the engine actually emits for a rejected body', async () => {
    // The engine signals `ErrorCode.INVALID_INPUT` internally, but
    // `withBookingApiErrors` routes it through `validationError`, so what
    // arrives on the wire is `422 VALIDATION_ERROR`. Matching only on
    // `INVALID_INPUT` would be a branch that never runs in production.
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(422, 'VALIDATION_ERROR', 'contact.phone is required')
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalidInput');
  });

  it('answers 503 unconfigured when the deployment has no API key', async () => {
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalConfigError('MEDAL_API_KEY is not configured')
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unconfigured' });
  });

  it('answers 502 for a failure it has no mapping for, leaking nothing', async () => {
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(500, 'INTERNAL_ERROR', 'workspace jd7exs… blew up')
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: 'upstreamError' });
    expect(JSON.stringify(body)).not.toContain('jd7exs');
  });

  /**
   * The marketing box has nowhere to go in the create body — `createBookingSchema`
   * has no consent field, and it should not: a consent is a dated record of a
   * sentence somebody agreed to, not a column on an appointment. So it is a
   * second call, and everything below is about it being the right one.
   */
  it('files the marketing consent as its own record, in the words the box used', async () => {
    await POST(optedInRequest());

    expect(recordConsent).toHaveBeenCalledWith({
      email: 'kari@example.no',
      consent_type: 'marketing_email',
      granted: true,
      source: 'booking',
      // The sentence that was on the screen, not a paraphrase of it: a consent
      // is only auditable if the wording survives with it.
      consent_text: MARKETING_CONSENT_TEXT,
      version: expect.any(String),
    });
    // The create body itself must stay clean — the engine would reject it.
    expect('consentMarketing' in submittedBody()).toBe(false);
  });

  it('records nothing until the booking has actually happened', async () => {
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN')
    );

    await POST(optedInRequest());

    // A mailing-list entry for an appointment that never existed is a consent
    // the customer did not give.
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('never lets a failed consent write take the booking down with it', async () => {
    // The likeliest cause is mundane and permanent: this endpoint is scoped
    // `write:contacts`, and a MEDAL_API_KEY minted for bookings alone 403s here
    // on every single submission.
    vi.mocked(recordConsent).mockRejectedValueOnce(new MedalApiError(403, 'FORBIDDEN', 'no scope'));

    const response = await POST(optedInRequest());

    expect(response.status).toBe(201);
    expect((await response.json()).bookings).toHaveLength(1);
  });

  /**
   * The consent write used to be awaited between the booking and the 201, and
   * the fetch behind it has no timeout. A consent endpoint that stalls
   * therefore withheld a booking that had already been made: the browser's own
   * request times out, the visitor reloads, `DetailsStep` remounts and mints a
   * FRESH submission nonce — so the retry derives a different idempotency key
   * and books the child a second time.
   */
  it('hands back the booking without waiting for the consent write', async () => {
    // A stall, not a failure: the endpoint accepted the connection and never
    // answered, which is the case a try/catch does nothing about.
    vi.mocked(recordConsent).mockReturnValue(new Promise(() => {}));

    const response = await POST(optedInRequest());

    expect(response.status).toBe(201);
    expect((await response.json()).bookings).toHaveLength(1);
  });

  it('detaches the consent write through `after`, not by dropping it', async () => {
    // Floating the promise instead would be worse than awaiting it. On Workers
    // a promise nobody is holding when the response goes out is cancelled, so
    // the consent would be written on a fast connection and silently lost on a
    // slow one. `after` is the one primitive that keeps the isolate alive for it.
    await POST(optedInRequest());

    expect(after).toHaveBeenCalledTimes(1);
    expect(recordConsent).toHaveBeenCalledTimes(1);
  });

  it('does not record a consent for an address it does not have', async () => {
    await POST(optedInRequest({ contact: { phone: '40000000', email: '  ' } }));

    // Consent to be e-mailed, with nowhere to e-mail, is not a consent to
    // anything — and the record is keyed on the address.
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('does not touch the record for a box nobody ticked', async () => {
    await POST(optedInRequest({ consentMarketing: false }));

    // `granted: false` is a WITHDRAWAL. Writing one for every parent who left
    // the box alone would revoke the consent they gave the last time they
    // booked.
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('returns the ids and manage tokens in camelCase, and no start time', async () => {
    // The create response carries no `start_ts` — the confirmation screen
    // renders the time from the slot the visitor picked. Inventing one here
    // would give it a second, disagreeing source.
    vi.mocked(createBooking).mockResolvedValue({
      bookings: [
        { id: 'bk_1', manage_token: 'mt_live_1' },
        { id: 'bk_2', manage_token: 'mt_live_2' },
      ],
    });

    const response = await POST(
      request({
        items: [
          { serviceId: 'svc', startTs: 1, bookedForName: 'Jonas' },
          { serviceId: 'svc', startTs: 2, bookedForName: 'Ida' },
        ],
        contact: { phone: '40000000', name: 'Kari' },
        consentTerms: true,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      bookings: [
        { id: 'bk_1', manageToken: 'mt_live_1' },
        { id: 'bk_2', manageToken: 'mt_live_2' },
      ],
    });
  });
});

/**
 * Slots are cached for thirty seconds. A booking made here must not stay on
 * offer for that long — to this parent going back, or to the next one.
 */
describe('POST /api/booking/create — the slot cache', () => {
  it('expires the cached slots of every service in the booking once it is made', async () => {
    const response = await POST(
      request({
        items: [
          { serviceId: 'svc-gutt', startTs: 1, bookedForName: 'Jonas' },
          { serviceId: 'svc-jente', startTs: 1, bookedForName: 'Ida' },
        ],
        contact: { phone: '40000000', name: 'Kari' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(201);
    expect(expireSlots).toHaveBeenCalledWith(['svc-gutt', 'svc-jente']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-gutt', 'svc-jente']);
  });

  it('expires them when the slot turned out to be taken, since the cache offered it', async () => {
    vi.mocked(createBooking).mockRejectedValue(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: gone')
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(409);
    expect(expireSlots).toHaveBeenCalledWith(['svc']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc']);
  });

  it('leaves the cache alone when nothing was booked for another reason', async () => {
    vi.mocked(createBooking).mockRejectedValue(new MedalConfigError('no key'));

    await POST(validRequest());

    expect(expireSlots).not.toHaveBeenCalled();

    expect(expireBookingSeeds).not.toHaveBeenCalled();
  });
});

/**
 * A `slotTaken` answers with what is free NOW, read live past the cache, so the
 * wizard can redraw the time step without a follow-up request — and without any
 * public way for a visitor to skip the cache.
 */
describe('POST /api/booking/create — fresh slots with slotTaken', () => {
  const NOW = Date.parse('2026-09-02T10:07:40+02:00');
  const WINDOW = { fromTs: NOW - 60_000, toTs: Date.parse('2026-09-09T00:00:00+02:00') };

  function takenRequest(overrides: Record<string, unknown> = {}): Request {
    return request({
      items: [
        { serviceId: 'svc-gutt', startTs: 1, bookedForName: 'Jonas' },
        { serviceId: 'svc-jente', startTs: 1, bookedForName: 'Ida' },
      ],
      contact: { phone: '40000000', name: 'Kari' },
      consentTerms: true,
      window: WINDOW,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.mocked(cachedAvailability).mockReset();
    vi.mocked(createBooking).mockRejectedValue(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: gone')
    );
  });

  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  it('returns each service’s live openings over the wizard’s window, and still expires the tags', async () => {
    vi.mocked(cachedAvailability).mockImplementation(async ({ serviceId }) =>
      serviceId === 'svc-gutt'
        ? [{ start_ts: '2026-09-02T12:30:00.000Z', end_ts: null, resource_id: 'r1' }]
        : []
    );

    const response = await POST(takenRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'slotTaken',
      freshSlots: {
        'svc-gutt': [{ startTs: Date.UTC(2026, 8, 2, 12, 30), resourceId: 'r1' }],
        'svc-jente': [],
      },
    });
    expect(cachedAvailability).toHaveBeenCalledWith(
      { serviceId: 'svc-gutt', ...WINDOW },
      { fresh: true }
    );
    expect(cachedAvailability).toHaveBeenCalledWith(
      { serviceId: 'svc-jente', ...WINDOW },
      { fresh: true }
    );
    expect(expireSlots).toHaveBeenCalledWith(['svc-gutt', 'svc-jente']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-gutt', 'svc-jente']);
  });

  it('reads each service once, however many children share it', async () => {
    vi.mocked(cachedAvailability).mockResolvedValue([]);

    await POST(
      takenRequest({
        items: [
          { serviceId: 'svc-gutt', startTs: 1, bookedForName: 'Jonas' },
          { serviceId: 'svc-gutt', startTs: 1, bookedForName: 'Ola' },
        ],
      })
    );

    expect(cachedAvailability).toHaveBeenCalledTimes(1);
  });

  it('falls back to the salon’s seven-day window when the body has none, or a bad one', async () => {
    vi.mocked(cachedAvailability).mockResolvedValue([]);
    const fallback = salonWindow(NOW, 7);

    for (const window of [
      undefined,
      { fromTs: 'x', toTs: 1 },
      { fromTs: 0, toTs: 63 * 86_400_000 },
    ]) {
      vi.mocked(cachedAvailability).mockClear();
      await POST(takenRequest({ window }));
      expect(cachedAvailability).toHaveBeenCalledWith(
        { serviceId: 'svc-gutt', fromTs: fallback.fromTs, toTs: fallback.toTs },
        { fresh: true }
      );
    }
  });

  it('leaves out a service whose live read failed, and still answers slotTaken', async () => {
    vi.mocked(cachedAvailability).mockImplementation(async ({ serviceId }) => {
      if (serviceId === 'svc-gutt') throw new Error('slow');
      return [];
    });

    const response = await POST(takenRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'slotTaken', freshSlots: { 'svc-jente': [] } });
  });

  it('reads nothing for any other failure', async () => {
    vi.mocked(createBooking).mockRejectedValue(new MedalApiError(409, 'CONFLICT', 'DUPLICATE'));

    const response = await POST(takenRequest());

    expect(await response.json()).toEqual({ error: 'conflict' });
    expect(cachedAvailability).not.toHaveBeenCalled();
  });
});

/**
 * SP10's phone rule. Medal resolves a booking's contact by the PHONE first,
 * and a child's id is only valid on the contact who owns them — so an id is
 * forwarded only under a Min side session whose parent has THAT number and
 * THAT child. Anything else books by name, as before.
 */
describe('POST /api/booking/create — booked_for_person_id', () => {
  const PROFILE = {
    contactId: 'ct-1',
    email: 'kari@example.com',
    firstName: 'Kari',
    lastName: null,
    phone: '+47 400 00 000',
    family: [
      {
        personId: 'p-jonas',
        name: 'Jonas',
        birthYear: 2018,
        birthMonth: null,
        notes: null,
        preferredResourceId: null,
      },
    ],
    personDetails: true,
    marketingConsent: false,
  };

  function personRequest(personId: string, phone = '40000000'): Request {
    return request({
      items: [
        {
          serviceId: 'svc',
          startTs: 1,
          bookedForName: 'Jonas',
          bookedForBirthYear: 2018,
          bookedForPersonId: personId,
        },
        { serviceId: 'svc', startTs: 2, bookedForName: 'Gjest' },
      ],
      contact: { phone, name: 'Kari' },
      consentTerms: true,
    });
  }

  beforeEach(() => {
    portal.readPortalSession.mockReset();
    portal.readPortalSession.mockResolvedValue('session-token');
    portal.getMe.mockReset();
    portal.getMe.mockResolvedValue(PROFILE);
  });

  it('forwards the id of the parent’s own child under the parent’s own number, and keeps the name', async () => {
    const response = await POST(personRequest('p-jonas'));

    expect(response.status).toBe(201);
    expect(portal.getMe).toHaveBeenCalledWith('session-token');
    expect(submittedBody().items).toEqual([
      expect.objectContaining({
        booked_for_person_id: 'p-jonas',
        booked_for_name: 'Jonas',
        booked_for_birth_year: 2018,
      }),
      expect.not.objectContaining({ booked_for_person_id: expect.anything() }),
    ]);
  });

  it('sends names only when the number submitted is somebody else’s', async () => {
    await POST(personRequest('p-jonas', '99887766'));

    expect(submittedBody().items[0]).not.toHaveProperty('booked_for_person_id');
    expect(submittedBody().items[0]).toMatchObject({ booked_for_name: 'Jonas' });
  });

  it('sends names only without a session, or for a child who is not this parent’s', async () => {
    portal.readPortalSession.mockResolvedValueOnce(null);
    await POST(personRequest('p-jonas'));
    expect(submittedBody().items[0]).not.toHaveProperty('booked_for_person_id');

    vi.mocked(createBooking).mockClear();
    await POST(personRequest('p-someone-else'));
    expect(submittedBody().items[0]).not.toHaveProperty('booked_for_person_id');
  });

  /** The same submission, as the wizard resends it: one nonce. */
  const withNonce = (personId = 'p-jonas', phone = '40000000') =>
    request({
      items: [
        {
          serviceId: 'svc',
          startTs: 1,
          bookedForName: 'Jonas',
          bookedForBirthYear: 2018,
          bookedForPersonId: personId,
        },
      ],
      contact: { phone, name: 'Kari' },
      consentTerms: true,
      submissionNonce: '9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    });

  /**
   * Medal compares the body's hash under a key: a retry whose body differs is
   * a 409, not a replay. So a check that could not be made books nothing and
   * asks for the retry, which runs the same check.
   */
  it('answers 503 «retry» and books nothing when the profile cannot be read', async () => {
    portal.getMe.mockRejectedValueOnce(new Error('down'));

    const response = await POST(withNonce());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'upstreamError', retryable: true });
    expect(createBooking).not.toHaveBeenCalled();

    // The retry reads the profile, forwards the id — under the key the first
    // attempt would have used.
    const retry = await POST(withNonce());
    expect(retry.status).toBe(201);
    expect(submittedBody().items[0]).toHaveProperty('booked_for_person_id', 'p-jonas');
  });

  it('sends names, and the same body under the same key on every retry, when the ids are not the parent’s', async () => {
    await POST(withNonce('p-someone-else'));
    await POST(withNonce('p-someone-else'));
    await POST(withNonce('p-jonas', '99887766'));
    await POST(withNonce('p-jonas', '99887766'));

    const calls = vi.mocked(createBooking).mock.calls;
    for (const [body] of calls) expect(body.items[0]).not.toHaveProperty('booked_for_person_id');
    expect(calls[1][0]).toEqual(calls[0][0]);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(calls[3][0]).toEqual(calls[2][0]);
    expect(keyOf(3)).toBe(keyOf(2));
  });

  it('treats a session Medal no longer honours as nobody logged in: names, not a retry', async () => {
    portal.getMe.mockRejectedValue(new PortalSessionExpiredError());

    const response = await POST(withNonce());

    expect(response.status).toBe(201);
    expect(submittedBody().items[0]).not.toHaveProperty('booked_for_person_id');
  });

  it.each(['IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_IN_PROGRESS'])(
    'answers «already have it — check your e-mail» for %s, and logs it',
    async (code) => {
      const { logger } = rt;
      vi.mocked(createBooking).mockRejectedValueOnce(new MedalApiError(409, code, 'key in use'));

      const response = await POST(withNonce());

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'inProgress' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        'Booking create hit an idempotency key already in use'
      );
    }
  );

  it('asks Medal nothing extra for a booking with no ids in it', async () => {
    // The cookie is read (it decides `X-Portal-Session`), but that is the
    // browser's own request — no round trip to Medal before the booking.
    await POST(validRequest());
    expect(portal.getMe).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalledTimes(1);
  });
});

/**
 * Vipps-first accounts: under `account.required` only a logged-in parent books,
 * and whenever a parent IS logged in their session goes to Medal with the
 * booking (`X-Portal-Session`), so it lands on their own contact.
 */
describe('POST /api/booking/create — the portal session', () => {
  const SESSION = 'a'.repeat(43);
  const OTHER_SESSION = 'b'.repeat(43);

  const required = testRuntime(
    {
      medal: { createBooking, recordConsent } as never,
      catalogue: { expireSlots, cachedAvailability } as never,
      seed: { expireBookingSeeds } as never,
      session: { readPortalSession: portal.readPortalSession } as never,
      portal: { getMe: portal.getMe } as never,
    },
    {
      logger: testLogger(),
      config: {
        ...PARITY_CONFIG,
        portal: { ...PARITY_CONFIG.portal, enabled: true },
        account: { required: true },
      },
    }
  );
  const POST_REQUIRED = (req: Request) => createRoute(required, req);

  beforeEach(() => {
    portal.readPortalSession.mockReset();
    portal.readPortalSession.mockResolvedValue(null);
    portal.getMe.mockReset();
  });

  it('refuses 401 accountRequired without a session when an account is required, booking nothing', async () => {
    const response = await POST_REQUIRED(validRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'accountRequired', message: 'Log in to book' });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('forwards the session to Medal when an account is required and the parent is logged in', async () => {
    portal.readPortalSession.mockResolvedValue(SESSION);

    const response = await POST_REQUIRED(validRequest());

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      portalSession: SESSION,
    });
  });

  it('books a visit of several services under account.required: extras and session together', async () => {
    const visit = () =>
      request({
        items: [
          {
            serviceId: 'svc-cut',
            extraServiceIds: ['svc-wash', 'svc-style'],
            startTs: 1,
            bookedForName: 'Jonas',
          },
        ],
        contact: { phone: '40000000', name: 'Kari' },
        consentTerms: true,
        submissionNonce: NONCE,
      });

    // Nobody logged in: the gate's 401, whatever the visit holds.
    const refused = await POST_REQUIRED(visit());
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'accountRequired', message: 'Log in to book' });
    expect(createBooking).not.toHaveBeenCalled();

    // Logged in: the body carries the extras and the session goes beside it.
    portal.readPortalSession.mockResolvedValue(SESSION);
    const response = await POST_REQUIRED(visit());

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledTimes(1);
    const [body, , options] = vi.mocked(createBooking).mock.calls[0];
    expect(body.items[0]).toMatchObject({
      service_id: 'svc-cut',
      extra_service_ids: ['svc-wash', 'svc-style'],
    });
    expect(options).toEqual({ portalSession: SESSION });
    expect(expireSlots).toHaveBeenCalledWith(['svc-cut', 'svc-wash', 'svc-style']);
  });

  it('forwards a logged-in parent’s session even when no account is required', async () => {
    portal.readPortalSession.mockResolvedValue(SESSION);

    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      portalSession: SESSION,
    });
  });

  it('books without a session exactly as before when none is required', async () => {
    const response = await POST(validRequest());

    expect(response.status).toBe(201);
    expect(vi.mocked(createBooking).mock.calls[0]).toHaveLength(2);
  });

  it('never lets two parents share an idempotency key for the same submission', async () => {
    portal.readPortalSession.mockResolvedValueOnce(SESSION);
    await POST(nonceRequest());
    portal.readPortalSession.mockResolvedValueOnce(OTHER_SESSION);
    await POST(nonceRequest());
    await POST(nonceRequest());
    portal.readPortalSession.mockResolvedValueOnce(SESSION);
    await POST(nonceRequest());

    expect(keyOf(0)).not.toBe(keyOf(1));
    expect(keyOf(0)).not.toBe(keyOf(2));
    expect(keyOf(1)).not.toBe(keyOf(2));
    // The same parent retrying the same submission still replays.
    expect(keyOf(3)).toBe(keyOf(0));
  });

  it('answers 503 «retry» when the session cookie cannot be read, booking nothing', async () => {
    portal.readPortalSession.mockRejectedValueOnce(new Error('no request scope'));

    const response = await POST(validRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'upstreamError', retryable: true });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('treats a session Medal no longer honours as no session: 401 when an account is required', async () => {
    portal.readPortalSession.mockResolvedValue(SESSION);
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(401, 'PORTAL_SESSION_INVALID', 'session expired')
    );

    const response = await POST_REQUIRED(validRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'accountRequired', message: 'Log in to book' });
    expect(createBooking).toHaveBeenCalledTimes(1);
  });

  it('books anonymously, under the anonymous key, when Medal refuses a dead session and none is required', async () => {
    portal.readPortalSession.mockResolvedValue(SESSION);
    vi.mocked(createBooking).mockRejectedValueOnce(
      new MedalApiError(401, 'PORTAL_SESSION_INVALID', 'session expired')
    );

    const response = await POST(nonceRequest());

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createBooking).mock.calls[1]).toHaveLength(2);
    expect(keyOf(1)).not.toBe(keyOf(0));

    // The anonymous key is the one a logged-out visitor's submission derives.
    portal.readPortalSession.mockResolvedValue(null);
    await POST(nonceRequest());
    expect(keyOf(2)).toBe(keyOf(1));
  });

  it('refuses 401 under account.required when the phone-rule check finds the session dead', async () => {
    portal.readPortalSession.mockResolvedValue(SESSION);
    portal.getMe.mockRejectedValue(new PortalSessionExpiredError());

    const response = await POST_REQUIRED(
      request({
        items: [{ serviceId: 'svc', startTs: 1, bookedForName: 'Jonas', bookedForPersonId: 'p1' }],
        contact: { phone: '40000000', name: 'Kari' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(401);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('does not forward a session the phone-rule check found dead when none is required', async () => {
    portal.readPortalSession.mockResolvedValue(SESSION);
    portal.getMe.mockRejectedValue(new PortalSessionExpiredError());

    const response = await POST(
      request({
        items: [{ serviceId: 'svc', startTs: 1, bookedForName: 'Jonas', bookedForPersonId: 'p1' }],
        contact: { phone: '40000000', name: 'Kari' },
        consentTerms: true,
      })
    );

    expect(response.status).toBe(201);
    expect(vi.mocked(createBooking).mock.calls[0]).toHaveLength(2);
  });
});

/**
 * One person, several services, ONE visit: the line carries the rest of the
 * visit after its first service, and everything the route does per service —
 * expiry, the live re-read, the key — has to see all of them.
 */
describe('POST /api/booking/create — a visit of several services', () => {
  /** The wizard's window, passed explicitly, so no clock is involved. */
  const WINDOW = {
    fromTs: Date.parse('2026-09-02T10:06:40+02:00'),
    toTs: Date.parse('2026-09-09T00:00:00+02:00'),
  };

  function visitRequest(
    extraServiceIds: unknown,
    overrides: Record<string, unknown> = {}
  ): Request {
    return request({
      items: [{ serviceId: 'svc-cut', extraServiceIds, startTs: 1, bookedForName: 'Jonas' }],
      contact: { phone: '40000000', name: 'Kari' },
      consentTerms: true,
      submissionNonce: NONCE,
      window: WINDOW,
      ...overrides,
    });
  }

  it('sends the extras as extra_service_ids, trimmed, right after service_id', async () => {
    const response = await POST(visitRequest([' svc-wash ', 'svc-style']));

    expect(response.status).toBe(201);
    const [item] = submittedBody().items;
    expect(item.extra_service_ids).toEqual(['svc-wash', 'svc-style']);
    expect(Object.keys(item).slice(0, 2)).toEqual(['service_id', 'extra_service_ids']);
  });

  it('sends no extra_service_ids for a one-service line, whatever empty it arrived as', async () => {
    for (const extras of [undefined, null, []]) {
      vi.mocked(createBooking).mockClear();
      await POST(visitRequest(extras));
      expect(Object.keys(submittedBody().items[0])).not.toContain('extra_service_ids');
    }
  });

  it('keeps a one-service line’s idempotency key what it was before visits existed', async () => {
    await POST(visitRequest(undefined));
    await POST(visitRequest([]));
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('derives a different key when the visit’s extras differ', async () => {
    await POST(visitRequest(undefined));
    await POST(visitRequest(['svc-wash']));
    await POST(visitRequest(['svc-style']));
    await POST(visitRequest(['svc-wash']));

    expect(new Set([keyOf(0), keyOf(1), keyOf(2)]).size).toBe(3);
    expect(keyOf(3)).toBe(keyOf(1));
  });

  it('refuses a malformed visit before Medal is asked', async () => {
    const cases: Array<[unknown, string]> = [
      ['svc-wash', 'items.0.extraServiceIds must be a list of service ids'],
      [['svc-wash', ''], 'items.0.extraServiceIds must be a list of service ids'],
      [['svc-wash', 7], 'items.0.extraServiceIds must be a list of service ids'],
      [['a', 'b', 'c', 'd'], 'items.0.extraServiceIds must name at most 3 services'],
      [['svc-wash', ' svc-wash'], 'items.0.extraServiceIds names a service twice'],
      [['svc-cut'], 'items.0.extraServiceIds repeats serviceId'],
    ];
    for (const [extras, message] of cases) {
      const response = await POST(visitRequest(extras));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalidInput', message });
    }
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('expires the slots of every service in the visit once it is booked', async () => {
    await POST(visitRequest(['svc-wash', 'svc-style']));

    expect(expireSlots).toHaveBeenCalledWith(['svc-cut', 'svc-wash', 'svc-style']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-cut', 'svc-wash', 'svc-style']);
  });

  it('answers a taken slot with live openings keyed by visit, read for the whole visit', async () => {
    vi.mocked(cachedAvailability).mockReset();
    vi.mocked(cachedAvailability).mockImplementation(async ({ extraServiceIds }) =>
      extraServiceIds
        ? [{ start_ts: '2026-09-02T12:30:00.000Z', end_ts: null, resource_id: 'r1' }]
        : []
    );
    vi.mocked(createBooking).mockRejectedValue(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: gone')
    );

    const response = await POST(
      visitRequest(undefined, {
        items: [
          { serviceId: 'svc-cut', extraServiceIds: ['svc-wash'], startTs: 1 },
          { serviceId: 'svc-cut', extraServiceIds: ['svc-wash'], startTs: 1 },
          { serviceId: 'svc-cut', startTs: 1 },
        ],
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'slotTaken',
      freshSlots: {
        'svc-cut+svc-wash': [{ startTs: Date.UTC(2026, 8, 2, 12, 30), resourceId: 'r1' }],
        'svc-cut': [],
      },
    });
    // Each visit once, however many people share it.
    expect(cachedAvailability).toHaveBeenCalledTimes(2);
    expect(cachedAvailability).toHaveBeenCalledWith(
      { serviceId: 'svc-cut', extraServiceIds: ['svc-wash'], ...WINDOW },
      { fresh: true }
    );
    expect(cachedAvailability).toHaveBeenCalledWith(
      { serviceId: 'svc-cut', ...WINDOW },
      { fresh: true }
    );
    expect(expireSlots).toHaveBeenCalledWith([
      'svc-cut',
      'svc-wash',
      'svc-cut',
      'svc-wash',
      'svc-cut',
    ]);
  });
});
