import { MedalApiError } from '@medalsocial/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The SDK's `portal` namespace, faked at the one place the seam reaches it.
 *
 * The Medal seam is faked rather than `fetch`, unlike
 * `medal-client.test.ts`: `medal.portal.*` does not exist in the SDK this app
 * has installed (it lands in 1.8.0), so there is no real client to drive over
 * a stubbed wire. What IS real is `MedalApiError` — imported from the SDK
 * itself, not stood in for — because every mapping in the seam is an
 * `instanceof` against that class, and a stand-in that drifted from it would
 * pass here and fail against a real 401.
 */
const mockPortal = {
  login: { start: vi.fn(), verify: vi.fn() },
  logout: vi.fn(),
  me: vi.fn(),
  updateMe: vi.fn(),
  myBookings: vi.fn(),
  exportMyData: vi.fn(),
  deleteMe: vi.fn(),
};

const requireMedal = vi.fn(() => ({ portal: mockPortal }));

import type { PortalBooking, PortalExport, PortalProfile } from '@medalsocial/sdk';
import { MedalConfigError, type MedalSeam } from '../../../src/next/medal';
import {
  createPortalSeam,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
} from '../../../src/next/portal/medal-portal';
import { PARITY_CONFIG } from '../../support/parity-config';

/** The fake seam stands where the source mocked its client module. */
const seam = {
  requireMedal,
  requireMedalWithTimeout: vi.fn(),
  requireMedalConfig: vi.fn(),
} as unknown as MedalSeam;

const { deleteMe, exportMyData, getMe, getMyBookings, logout, startLogin, updateMe, verifyLogin } =
  createPortalSeam(seam, { config: PARITY_CONFIG });

/** 43 characters of base64url — the shape Medal mints. */
// Built, not written out: a 43-char base64url literal reads as a leaked credential to
// secret scanners (DeepSource), and this one is synthetic.
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

/** A family as a Medal that predates SP10 sends it: names and years, no ids. */
const legacyFamily = (...members: { name: string; birth_year: number }[]) =>
  members as PortalProfile['family'];

const PROFILE: PortalProfile = {
  contact_id: 'ct-1',
  email: 'kari@example.com',
  first_name: 'Kari',
  last_name: null,
  phone: '40000000',
  family: legacyFamily({ name: 'Ola', birth_year: 2018 }),
  persons: [],
  labels: { person: 'Barn', persons: 'Barn' },
  marketing_consent: false,
  created_at: 1,
};

function booking(overrides: Partial<PortalBooking> = {}): PortalBooking {
  return {
    booking_id: 'bk-1',
    status: 'confirmed',
    start_ts: 10,
    end_ts: 20,
    start_ts_iso: new Date(10).toISOString(),
    end_ts_iso: new Date(20).toISOString(),
    service_id: 'svc',
    service_name: 'Barneklipp',
    resource_id: null,
    resource_name: null,
    booked_for_name: 'Ola',
    booked_for_person_id: null,
    booked_for_birth_year: null,
    booked_for_birth_month: null,
    amount_ore: 39000,
    payment_mode: 'none',
    payment_status: 'none',
    notes: null,
    manage_token: 'manage-token-abc', // skipcq: SCT-A000 — test fixture, not a credential
    can_manage: true,
    ...overrides,
  };
}

function apiError(status: number, code: string, message = `${code} from Medal`): MedalApiError {
  return new MedalApiError(status, code, message);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMedal.mockImplementation(() => ({ portal: mockPortal }));
});

describe('startLogin', () => {
  it('asks Medal to send a code, defaulting the locale to Norwegian', async () => {
    mockPortal.login.start.mockResolvedValue({ data: { status: 'sent' } });

    await startLogin('kari@example.com');

    expect(mockPortal.login.start).toHaveBeenCalledWith({
      email: 'kari@example.com',
      locale: 'no',
    });
  });

  it('turns a 429 into PortalThrottledError so the action can answer quietly', async () => {
    mockPortal.login.start.mockRejectedValue(apiError(429, 'RATE_LIMITED'));

    await expect(startLogin('kari@example.com')).rejects.toBeInstanceOf(PortalThrottledError);
  });

  it('rethrows anything else', async () => {
    mockPortal.login.start.mockRejectedValue(apiError(502, 'UPSTREAM'));

    await expect(startLogin('kari@example.com')).rejects.toMatchObject({ status: 502 });
  });
});

describe('verifyLogin', () => {
  it('hands back the token and expiry, and nothing else from the session body', async () => {
    mockPortal.login.verify.mockResolvedValue({
      data: {
        session_token: SESSION,
        expires_at: 1234,
        contact: { contact_id: 'ct-1', first_name: 'Kari' },
      },
    });

    await expect(verifyLogin('kari@example.com', '123456')).resolves.toEqual({
      sessionToken: SESSION,
      expiresAt: 1234,
    });
    expect(mockPortal.login.verify).toHaveBeenCalledWith({
      email: 'kari@example.com',
      code: '123456',
    });
  });

  it('answers null — not an error — to a wrong code', async () => {
    mockPortal.login.verify.mockRejectedValue(apiError(401, 'PORTAL_CODE_INVALID'));

    await expect(verifyLogin('kari@example.com', '000000')).resolves.toBeNull();
  });

  it('turns a 429 into PortalThrottledError', async () => {
    mockPortal.login.verify.mockRejectedValue(apiError(429, 'RATE_LIMITED'));

    await expect(verifyLogin('kari@example.com', '000000')).rejects.toBeInstanceOf(
      PortalThrottledError
    );
  });

  it('rethrows a 401 that is not about the code', async () => {
    mockPortal.login.verify.mockRejectedValue(apiError(401, 'UNAUTHORIZED'));

    await expect(verifyLogin('kari@example.com', '000000')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('logout', () => {
  it('revokes the session on Medal', async () => {
    mockPortal.logout.mockResolvedValue(undefined);

    await logout(SESSION);

    expect(mockPortal.logout).toHaveBeenCalledWith(SESSION);
  });

  it.each(['PORTAL_SESSION_REQUIRED', 'PORTAL_SESSION_INVALID', 'UNAUTHORIZED'])(
    'swallows a 401 %s — an already-dead session is the end state wanted',
    async (code) => {
      mockPortal.logout.mockRejectedValue(apiError(401, code));

      await expect(logout(SESSION)).resolves.toBeUndefined();
    }
  );

  it('does not swallow a 5xx — the session may still be live upstream', async () => {
    mockPortal.logout.mockRejectedValue(apiError(503, 'UNAVAILABLE'));

    await expect(logout(SESSION)).rejects.toMatchObject({ status: 503 });
  });
});

describe('getMe', () => {
  it('returns the profile DTO', async () => {
    mockPortal.me.mockResolvedValue({ data: PROFILE });

    await expect(getMe(SESSION)).resolves.toEqual({
      contactId: 'ct-1',
      email: 'kari@example.com',
      firstName: 'Kari',
      lastName: null,
      phone: '40000000',
      family: [
        {
          personId: null,
          name: 'Ola',
          birthYear: 2018,
          birthMonth: null,
          notes: null,
          preferredResourceId: null,
        },
      ],
      personDetails: false,
      marketingConsent: false,
      labels: { person: 'Barn', persons: 'Barn' },
    });
    expect(mockPortal.me).toHaveBeenCalledWith(SESSION);
  });

  it.each(['PORTAL_SESSION_REQUIRED', 'PORTAL_SESSION_INVALID'])(
    'maps a 401 %s to PortalSessionExpiredError',
    async (code) => {
      mockPortal.me.mockRejectedValue(apiError(401, code));

      await expect(getMe(SESSION)).rejects.toBeInstanceOf(PortalSessionExpiredError);
    }
  );

  it('does not map a 401 with an unrelated code — that is not a dead session', async () => {
    mockPortal.me.mockRejectedValue(apiError(401, 'UNAUTHORIZED'));

    const error = await getMe(SESSION).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MedalApiError);
    expect(error).not.toBeInstanceOf(PortalSessionExpiredError);
  });

  it('does not map a PORTAL_SESSION_* code on a non-401 status', async () => {
    mockPortal.me.mockRejectedValue(apiError(500, 'PORTAL_SESSION_INVALID'));

    await expect(getMe(SESSION)).rejects.toMatchObject({ status: 500 });
  });

  it('turns a 200 with no JSON body into an error instead of returning undefined', async () => {
    mockPortal.me.mockResolvedValue(undefined);

    await expect(getMe(SESSION)).rejects.toMatchObject({ code: 'NON_JSON_BODY' });
  });

  it('lets a missing API key surface as MedalConfigError, untouched', async () => {
    requireMedal.mockImplementation(() => {
      throw new MedalConfigError('MEDAL_API_KEY is not configured');
    });

    await expect(getMe(SESSION)).rejects.toBeInstanceOf(MedalConfigError);
    expect(mockPortal.me).not.toHaveBeenCalled();
  });
});

describe('session redaction', () => {
  /**
   * The finding this block exists for. The SDK formats the failing request
   * into its error messages, and the session travels in a header of that
   * request; whatever reaches `next-safe-action`'s error handler is logged
   * verbatim. The seam is the last place the session is known by name, so it
   * is the last place it can be scrubbed.
   */
  it('scrubs the session out of a rethrown MedalApiError, keeping its class and status', async () => {
    mockPortal.me.mockRejectedValue(
      apiError(502, 'UPSTREAM', `GET /api/v1/portal/me with X-Portal-Session: ${SESSION} failed`)
    );

    const error = (await getMe(SESSION).catch((e: unknown) => e)) as MedalApiError;

    expect(error).toBeInstanceOf(MedalApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('UPSTREAM');
    expect(error.message).not.toContain(SESSION);
    expect(error.message).toContain('<session>');
    expect(error.stack ?? '').not.toContain(SESSION);
  });

  it('scrubs the session out of a plain Error too', async () => {
    mockPortal.myBookings.mockRejectedValue(new TypeError(`fetch failed for ${SESSION}`));

    const error = (await getMyBookings(SESSION).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).not.toContain(SESSION);
  });

  it('scrubs the session out of a validation message that goes on to the screen', async () => {
    mockPortal.updateMe.mockRejectedValue(
      apiError(400, 'VALIDATION_ERROR', `phone is invalid (session ${SESSION})`)
    );

    const error = (await updateMe(SESSION, { phone: 'x' }).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(PortalValidationError);
    expect(error.message).not.toContain(SESSION);
  });

  it('replaces a non-Error throw that carries the session rather than passing it on', async () => {
    mockPortal.deleteMe.mockRejectedValue(`boom ${SESSION}`);

    const error = await deleteMe(SESSION).catch((e: unknown) => e);

    expect(JSON.stringify(error)).not.toContain(SESSION);
    expect(String(error)).not.toContain(SESSION);
  });

  /**
   * `fetch failed` is what undici says on top; the request that failed is in
   * `cause`. A logger that prints the cause chain — Node's inspect, Pino,
   * Sentry — would print the session one level down while the top line read
   * clean.
   */
  it('scrubs the session out of the cause chain, three levels down, keeping the chain', async () => {
    const root = new Error(`connect ECONNREFUSED for session ${SESSION}`);
    const middle = new Error(`request failed (${SESSION})`, { cause: root });
    const top = new TypeError('fetch failed', { cause: middle });
    mockPortal.me.mockRejectedValue(top);

    const error = (await getMe(SESSION).catch((e: unknown) => e)) as Error;

    expect(error).toBe(top);
    expect(error.cause).toBe(middle);
    expect((error.cause as Error).message).toBe('request failed (<session>)');
    expect(((error.cause as Error).cause as Error).message).not.toContain(SESSION);
    expect(((error.cause as Error).cause as Error).stack ?? '').not.toContain(SESSION);
  });

  it('scrubs every error inside an AggregateError', async () => {
    const aggregate = new AggregateError(
      [new Error(`first ${SESSION}`), new Error(`second ${SESSION}`, { cause: `${SESSION}` })],
      `all failed for ${SESSION}`
    );
    mockPortal.myBookings.mockRejectedValue(aggregate);

    const error = (await getMyBookings(SESSION).catch((e: unknown) => e)) as AggregateError;

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe('all failed for <session>');
    expect(error.errors.map((inner: Error) => inner.message)).toEqual([
      'first <session>',
      'second <session>',
    ]);
    expect((error.errors[1] as Error).cause).toBe('<session>');
  });

  it('terminates on a cause that points back at itself', async () => {
    const loop = new Error(`looping ${SESSION}`);
    loop.cause = loop;
    mockPortal.deleteMe.mockRejectedValue(loop);

    const error = (await deleteMe(SESSION).catch((e: unknown) => e)) as Error;

    expect(error).toBe(loop);
    expect(error.message).toBe('looping <session>');
  });
});

describe('updateMe', () => {
  it('sends the patch and returns the refreshed DTO', async () => {
    mockPortal.updateMe.mockResolvedValue({ data: { ...PROFILE, first_name: 'Karianne' } });

    const dto = await updateMe(SESSION, { first_name: 'Karianne' });

    expect(mockPortal.updateMe).toHaveBeenCalledWith(SESSION, { first_name: 'Karianne' });
    expect(dto.firstName).toBe('Karianne');
  });

  it('turns a VALIDATION_ERROR into PortalValidationError carrying the server message', async () => {
    mockPortal.updateMe.mockRejectedValue(apiError(400, 'VALIDATION_ERROR', 'phone: too short'));

    const error = (await updateMe(SESSION, { phone: '1' }).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(PortalValidationError);
    expect(error.message).toBe('phone: too short');
  });

  it('maps a dead session before anything else', async () => {
    mockPortal.updateMe.mockRejectedValue(apiError(401, 'PORTAL_SESSION_INVALID'));

    await expect(updateMe(SESSION, {})).rejects.toBeInstanceOf(PortalSessionExpiredError);
  });
});

describe('getMyBookings', () => {
  it('projects both lists and keeps the manage token off the DTOs', async () => {
    mockPortal.myBookings.mockResolvedValue({
      data: {
        upcoming: [booking()],
        past: [booking({ booking_id: 'bk-0', status: 'completed', manage_token: null })],
      },
    });

    const result = await getMyBookings(SESSION);

    expect(result.upcoming).toEqual([
      expect.objectContaining({
        bookingId: 'bk-1',
        managePath: '/bestill/administrer/manage-token-abc',
      }),
    ]);
    expect(result.past).toEqual([expect.objectContaining({ bookingId: 'bk-0', managePath: null })]);
    expect(JSON.stringify(result)).not.toContain('manage_token');
    expect(JSON.stringify(result)).not.toContain('manageToken');
  });

  it('maps a dead session', async () => {
    mockPortal.myBookings.mockRejectedValue(apiError(401, 'PORTAL_SESSION_REQUIRED'));

    await expect(getMyBookings(SESSION)).rejects.toBeInstanceOf(PortalSessionExpiredError);
  });
});

describe('exportMyData', () => {
  const EXPORT: PortalExport = {
    exported_at: 99,
    contact: PROFILE,
    family: PROFILE.family,
    consents: [
      {
        consent_type: 'marketing_email',
        granted: true,
        granted_at: 5,
        revoked_at: null,
        granted_at_iso: new Date(5).toISOString(),
        revoked_at_iso: null,
        source: 'booking',
      },
    ],
    bookings: [booking(), booking({ booking_id: 'bk-2', manage_token: null })],
    relations: [],
  };

  it('returns the raw export — it is the customer’s own file', async () => {
    mockPortal.exportMyData.mockResolvedValue({ data: EXPORT });

    const result = await exportMyData(SESSION);

    expect(result.exported_at).toBe(99);
    expect(result.contact).toEqual(PROFILE);
    expect(result.consents).toEqual(EXPORT.consents);
    expect(result.bookings.map((b) => b.booking_id)).toEqual(['bk-1', 'bk-2']);
  });

  it('nulls every manage token in the file — a download is not a place for live credentials', async () => {
    mockPortal.exportMyData.mockResolvedValue({ data: EXPORT });

    const result = await exportMyData(SESSION);

    expect(result.bookings.every((b) => b.manage_token === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('manage-token-abc');
    // And does not mutate what the SDK handed over.
    expect(EXPORT.bookings[0].manage_token).toBe('manage-token-abc');
  });

  it('maps a dead session', async () => {
    mockPortal.exportMyData.mockRejectedValue(apiError(401, 'PORTAL_SESSION_INVALID'));

    await expect(exportMyData(SESSION)).rejects.toBeInstanceOf(PortalSessionExpiredError);
  });
});

describe('deleteMe', () => {
  it('deletes the contact', async () => {
    mockPortal.deleteMe.mockResolvedValue(undefined);

    await deleteMe(SESSION);

    expect(mockPortal.deleteMe).toHaveBeenCalledWith(SESSION);
  });

  it('maps a dead session', async () => {
    mockPortal.deleteMe.mockRejectedValue(apiError(401, 'PORTAL_SESSION_REQUIRED'));

    await expect(deleteMe(SESSION)).rejects.toBeInstanceOf(PortalSessionExpiredError);
  });
});
