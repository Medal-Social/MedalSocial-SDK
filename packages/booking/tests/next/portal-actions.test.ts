import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The portal actions, driven the way the app's action wrappers drive them —
 * by calling the function with the parsed input — with the two things under
 * them faked: the cookie jar (`rt.session`) and the Medal seam (`rt.portal`).
 *
 * The seam's error CLASSES are the real ones: every branch in the actions is
 * an `instanceof` against `PortalSessionExpiredError` and friends, and a
 * stand-in class would let the mapping drift and the tests stay green.
 *
 * One assertion runs against every action, and it is the one this file exists
 * for: the session token — a bearer credential for the parent's whole account
 * — must never appear in what an action returns, because what an action
 * returns is serialised into the browser.
 *
 * Moved from a suite that drove next-safe-action wrappers. The scenarios and
 * expectations are the same; only the envelope differs: the plain functions
 * answer directly (no `result`), a schema refusal is
 * `{ ok: false, reason: 'invalid' }` (no `validationErrors`), and what the
 * action client would have turned into a `serverError` is a rejection — the
 * logging and the generic message are the app's action client's, not these.
 */

const session = vi.hoisted(() => ({
  readPortalSession: vi.fn<() => Promise<string | null>>(),
  writePortalSession: vi.fn<(token: string, expiresAt: number) => Promise<void>>(),
  clearPortalSession: vi.fn<() => Promise<void>>(),
  renewPortalSession: vi.fn<(token: string) => Promise<void>>(),
}));

/**
 * The «where does this login end» cookie (`core/portal/next-path.ts`), faked
 * for the same reason the session jar is: it calls `cookies()`, and these
 * tests drive the actions directly rather than through a request.
 */
const nextPath = vi.hoisted(() => ({
  writePortalNextPath: vi.fn<(path: string | null) => Promise<void>>(),
  takePortalNextPath: vi.fn<() => Promise<string | null>>(),
}));
/** SP10's browser binding: a fixed value, and the cookie write recorded. */
const binding = vi.hoisted(() => ({
  mintBrowserBinding: vi.fn(() => 'binding-0123456789-abcdefghijklmnopqrstuvwx'),
  writeBrowserBinding: vi.fn<(value: string) => Promise<void>>(async () => {}),
  clearBrowserBinding: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('../../src/core/portal/vipps-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/portal/vipps-link')>()),
  mintBrowserBinding: binding.mintBrowserBinding,
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);
const request = vi.hoisted(() => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/headers', () => request);
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    // Next.js redirect throws to halt the action.
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

import type { PortalExport } from '@medalsocial/sdk';
import type { PortalProfileDto } from '../../src/core/portal/dto';
import { createPortalActions } from '../../src/next/portal';
import {
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
  PortalVippsUnavailableError,
} from '../../src/next/portal/medal-portal';
import { testLogger, testRuntime } from '../support/next-runtime';

const startLogin = vi.fn();
const startVippsLogin = vi.fn();
const startVippsLink = vi.fn();
const logout = vi.fn();
const updateMe = vi.fn();
const exportMyData = vi.fn();
const deleteMe = vi.fn();
const createPerson = vi.fn();
const updatePerson = vi.fn();
const removePerson = vi.fn();

const logger = testLogger();
const rt = testRuntime(
  {
    session: session as never,
    nextPath: nextPath as never,
    vippsLink: binding as never,
    portal: {
      startLogin,
      startVippsLogin,
      startVippsLink,
      logout,
      updateMe,
      exportMyData,
      deleteMe,
      createPerson,
      updatePerson,
      removePerson,
    } as never,
  },
  {
    logger,
    baseUrl: 'https://test.example.com',
    portal: { vippsLinkReturnPath: '/min-side/vipps/koble' },
  }
);
const actions = createPortalActions(rt);
const {
  deleteMe: deleteMeAction,
  exportData: exportDataAction,
  logout: logoutAction,
  removePerson: removePersonAction,
  savePerson: savePersonAction,
  setMarketingConsent: setMarketingConsentAction,
  startLogin: startLoginAction,
  startVippsLink: startVippsLinkAction,
  startVipps: startVippsLoginAction,
  updateProfile: updateProfileAction,
} = actions;

/** 43 characters of base64url — the shape Medal mints and the cookie accepts. */
// Built, not written out: a 43-char base64url literal reads as a leaked credential to
// secret scanners (DeepSource), and this one is synthetic.
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

const PROFILE: PortalProfileDto = {
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
};

const EXPORT: PortalExport = {
  exported_at: Date.UTC(2026, 8, 5, 12),
  contact: {
    contact_id: 'ct-1',
    email: 'kari@example.com',
    first_name: 'Kari',
    last_name: null,
    phone: '40000000',
    // A pre-SP10 family: names and years, no ids.
    family: [{ name: 'Ola', birth_year: 2018 }] as PortalExport['family'],
    persons: [],
    labels: { person: 'Barn', persons: 'Barn' },
    marketing_consent: false,
    created_at: 1,
  },
  family: [{ name: 'Ola', birth_year: 2018 }] as PortalExport['family'],
  consents: [],
  bookings: [],
  relations: [],
};

function loggedIn() {
  session.readPortalSession.mockResolvedValue(SESSION);
}

function loggedOut() {
  session.readPortalSession.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  loggedOut();
});

describe('startLoginAction', () => {
  it('normalises the address and asks the seam to send a code', async () => {
    vi.mocked(startLogin).mockResolvedValue(undefined);

    const result = await startLoginAction({ email: '  Kari@Example.COM ' });

    expect(result).toEqual({ status: 'sent' });
    expect(startLogin).toHaveBeenCalledWith('kari@example.com');
  });

  it('says «sent» when Medal is throttling — the site is not an oracle either', async () => {
    vi.mocked(startLogin).mockRejectedValue(new PortalThrottledError());

    const result = await startLoginAction({ email: 'kari@example.com' });

    expect(result).toEqual({ status: 'sent' });
  });

  it('refuses something that is not an address before it reaches Medal', async () => {
    const result = await startLoginAction({ email: 'not-an-address' });

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(startLogin).not.toHaveBeenCalled();
  });

  it('refuses an address longer than the RFC allows', async () => {
    const result = await startLoginAction({ email: `${'a'.repeat(250)}@example.com` });

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(startLogin).not.toHaveBeenCalled();
  });

  it('lets an outage surface as a server error rather than a false «sent»', async () => {
    vi.mocked(startLogin).mockRejectedValue(new TypeError('fetch failed'));

    await expect(startLoginAction({ email: 'kari@example.com' })).rejects.toThrow('fetch failed');
  });
});

describe('startVippsLoginAction', () => {
  const AUTHORIZE = 'https://api.vipps.no/authorize?state=abc';

  it('binds the login to this browser: a fresh value in the cookie and in the start body', async () => {
    vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

    await expect(startVippsLoginAction(null)).rejects.toThrow('NEXT_REDIRECT');

    expect(binding.writeBrowserBinding).toHaveBeenCalledWith(
      'binding-0123456789-abcdefghijklmnopqrstuvwx'
    );
    expect(startVippsLogin).toHaveBeenCalledWith(
      expect.objectContaining({ browserBinding: 'binding-0123456789-abcdefghijklmnopqrstuvwx' })
    );
    // Written before Medal is asked: the callback can come back at once.
    expect(binding.writeBrowserBinding.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(startVippsLogin).mock.invocationCallOrder[0]
    );
  });

  it('clears the binding again when the start fails: no callback will spend it', async () => {
    vi.mocked(startVippsLogin).mockRejectedValue(new Error('down'));

    await expect(startVippsLoginAction(null)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(binding.clearBrowserBinding).toHaveBeenCalledTimes(1);
  });

  function arrivedOn(entries: Record<string, string>) {
    request.headers.mockResolvedValue(new Headers(entries));
  }

  it('asks the seam for an authorize URL with a return URL on the request origin, then redirects', async () => {
    arrivedOn({ host: 'preview.salong.example', 'x-forwarded-proto': 'https' });
    vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

    await expect(startVippsLoginAction(null, new FormData())).rejects.toThrow(
      `NEXT_REDIRECT: ${AUTHORIZE}`
    );

    expect(startVippsLogin).toHaveBeenCalledWith({
      returnUrl: 'https://preview.salong.example/min-side/vipps',
      browserBinding: 'binding-0123456789-abcdefghijklmnopqrstuvwx',
      locale: 'no',
    });
  });

  it('falls back to the canonical BASE_URL when the request names no host', async () => {
    arrivedOn({});
    vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

    await expect(startVippsLoginAction(null, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(startVippsLogin).toHaveBeenCalledWith({
      returnUrl: 'https://test.example.com/min-side/vipps',
      browserBinding: 'binding-0123456789-abcdefghijklmnopqrstuvwx',
      locale: 'no',
    });
  });

  it('answers «unavailable» when the workspace has no Vipps, without logging', async () => {
    vi.mocked(startVippsLogin).mockRejectedValue(new PortalVippsUnavailableError());

    await expect(startVippsLoginAction(null, new FormData())).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers «throttled» when Medal is rate-limiting', async () => {
    vi.mocked(startVippsLogin).mockRejectedValue(new PortalThrottledError());

    await expect(startVippsLoginAction(null, new FormData())).resolves.toEqual({
      ok: false,
      reason: 'throttled',
    });
  });

  /**
   * Where the parent lands afterwards, for a login that did not start on Min
   * side (D54). It is stored rather than carried in the `return_url` — see
   * `core/portal/next-path.ts` — so the URL handed to Medal is unchanged, and
   * the value is written on every attempt so an abandoned one cannot capture
   * the next login.
   */
  describe('the destination a login started elsewhere carries', () => {
    function withNext(path: string) {
      const form = new FormData();
      form.set('next', path);
      return form;
    }

    it('stores it, and still asks Medal for the ordinary return URL', async () => {
      arrivedOn({ host: 'salong.example', 'x-forwarded-proto': 'https' });
      vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

      await expect(
        startVippsLoginAction(null, withNext('/barnehage/eksempel?fortsett=1'))
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(nextPath.writePortalNextPath).toHaveBeenCalledWith('/barnehage/eksempel?fortsett=1');
      expect(startVippsLogin).toHaveBeenCalledWith({
        returnUrl: 'https://salong.example/min-side/vipps',
        browserBinding: 'binding-0123456789-abcdefghijklmnopqrstuvwx',
        locale: 'no',
      });
    });

    it('clears any earlier destination when the form carries none', async () => {
      vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

      await expect(startVippsLoginAction(null, new FormData())).rejects.toThrow('NEXT_REDIRECT');

      expect(nextPath.writePortalNextPath).toHaveBeenCalledWith(null);
    });

    /** The action does not judge the value; `writePortalNextPath` validates it
     * and refuses to store anything `safeReturnPath` will not vouch for. */
    it('hands even a hostile value to the validator rather than to the browser', async () => {
      vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

      await expect(startVippsLoginAction(null, withNext('//evil.example'))).rejects.toThrow(
        'NEXT_REDIRECT'
      );

      expect(nextPath.writePortalNextPath).toHaveBeenCalledWith('//evil.example');
      expect(startVippsLogin).toHaveBeenCalledWith(
        expect.objectContaining({ returnUrl: expect.stringContaining('/min-side/vipps') })
      );
    });
  });

  it('answers «unavailable» to anything else, and logs it', async () => {
    vi.mocked(startVippsLogin).mockRejectedValue(new TypeError('fetch failed'));

    await expect(startVippsLoginAction(null, new FormData())).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("never writes a cookie itself — that is the return route's job", async () => {
    vi.mocked(startVippsLogin).mockResolvedValue({ authorizeUrl: AUTHORIZE });

    await startVippsLoginAction(null, new FormData()).catch(() => {});

    expect(session.writePortalSession).not.toHaveBeenCalled();
  });
});

/**
 * The browser exchanges the code through `POST /api/portal/login/verify`, not
 * an action: a server action that sets a cookie makes Next re-fetch the page
 * that called it, and the verify writes `demo_portal`. The route is tested in
 * `tests/next/routes/portal-login-verify.test.ts`; the package's `verifyLogin`
 * action, for a page that wants the re-render, in `portal-actions-extra`.
 * Asking for a code stays an action, and that is safe only while it writes no
 * cookie.
 */
/**
 * «Koble til Vipps» on Min side → Profil: the logged-in sibling of the login
 * above. Same binding cookie, a different return route, and the session
 * rides along — so no session is an answer, and a Medal without the route is
 * `missing`, which hides the row.
 */
describe('startVippsLinkAction', () => {
  const AUTHORIZE = 'https://api.vipps.no/authorize?state=link';
  const BINDING = 'binding-0123456789-abcdefghijklmnopqrstuvwx';

  beforeEach(() => {
    request.headers.mockResolvedValue(
      new Headers({ host: 'preview.salong.example', 'x-forwarded-proto': 'https' })
    );
  });

  it('binds the link to this browser and redirects to Vipps', async () => {
    loggedIn();
    vi.mocked(startVippsLink).mockResolvedValue({ authorizeUrl: AUTHORIZE });

    await expect(startVippsLinkAction(null)).rejects.toThrow(`NEXT_REDIRECT: ${AUTHORIZE}`);

    expect(startVippsLink).toHaveBeenCalledWith(SESSION, {
      returnUrl: 'https://preview.salong.example/min-side/vipps/koble',
      browserBinding: BINDING,
      locale: 'no',
    });
    expect(binding.writeBrowserBinding).toHaveBeenCalledWith(BINDING);
    expect(binding.writeBrowserBinding.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(startVippsLink).mock.invocationCallOrder[0]
    );
    expect(binding.clearBrowserBinding).not.toHaveBeenCalled();
  });

  it('answers «session» without asking Medal when there is no session', async () => {
    loggedOut();

    await expect(startVippsLinkAction(null)).resolves.toEqual({ ok: false, reason: 'session' });
    expect(startVippsLink).not.toHaveBeenCalled();
    expect(binding.writeBrowserBinding).not.toHaveBeenCalled();
  });

  it('answers «missing» against a Medal without the route, and drops the binding', async () => {
    loggedIn();
    vi.mocked(startVippsLink).mockResolvedValue(null);

    await expect(startVippsLinkAction(null)).resolves.toEqual({ ok: false, reason: 'missing' });
    expect(binding.clearBrowserBinding).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('clears the cookie and answers «session» for a session Medal no longer honours', async () => {
    loggedIn();
    vi.mocked(startVippsLink).mockRejectedValue(new PortalSessionExpiredError());

    await expect(startVippsLinkAction(null)).resolves.toEqual({ ok: false, reason: 'session' });
    expect(session.clearPortalSession).toHaveBeenCalled();
    expect(binding.clearBrowserBinding).toHaveBeenCalledTimes(1);
  });

  it('answers «throttled», and «unavailable» for no Vipps or an outage (logging only the outage)', async () => {
    loggedIn();
    vi.mocked(startVippsLink).mockRejectedValue(new PortalThrottledError());
    await expect(startVippsLinkAction(null)).resolves.toEqual({ ok: false, reason: 'throttled' });

    vi.mocked(startVippsLink).mockRejectedValue(new PortalVippsUnavailableError());
    await expect(startVippsLinkAction(null)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(logger.error).not.toHaveBeenCalled();

    vi.mocked(startVippsLink).mockRejectedValue(new Error('down'));
    await expect(startVippsLinkAction(null)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('never returns the session', async () => {
    loggedIn();
    vi.mocked(startVippsLink).mockResolvedValue(null);

    expect(JSON.stringify(await startVippsLinkAction(null))).not.toContain(SESSION);
  });
});

describe('the login actions and cookies', () => {
  it('asks for a code without touching the cookie jar', async () => {
    vi.mocked(startLogin).mockResolvedValue(undefined);

    await startLoginAction({ email: 'kari@example.com' });

    expect(session.writePortalSession).not.toHaveBeenCalled();
    expect(session.clearPortalSession).not.toHaveBeenCalled();
    expect(nextPath.writePortalNextPath).not.toHaveBeenCalled();
  });
});

describe('logoutAction', () => {
  it('revokes upstream and clears the cookie', async () => {
    loggedIn();
    vi.mocked(logout).mockResolvedValue(undefined);

    const result = await logoutAction();

    expect(result).toEqual({ ok: true });
    expect(logout).toHaveBeenCalledWith(SESSION);
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('clears the cookie even when Medal cannot be reached', async () => {
    loggedIn();
    vi.mocked(logout).mockRejectedValue(new TypeError('fetch failed'));

    const result = await logoutAction();

    expect(result).toEqual({ ok: true });
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });

  it('clears the cookie and does not call Medal when there is no session to revoke', async () => {
    loggedOut();

    const result = await logoutAction();

    expect(result).toEqual({ ok: true });
    expect(logout).not.toHaveBeenCalled();
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });
});

describe('updateProfileAction', () => {
  it('sends the patch with the phone normalised and returns the refreshed profile', async () => {
    loggedIn();
    vi.mocked(updateMe).mockResolvedValue({ ...PROFILE, firstName: 'Karianne' });

    const result = await updateProfileAction({
      first_name: ' Karianne ',
      phone: '+47 400 00 000',
      family: [{ name: 'Ola', birth_year: 2018 }],
    });

    expect(updateMe).toHaveBeenCalledWith(SESSION, {
      first_name: 'Karianne',
      phone: '40000000',
      family: [{ name: 'Ola', birth_year: 2018 }],
    });
    expect(result).toEqual({ ok: true, profile: { ...PROFILE, firstName: 'Karianne' } });
    expect(JSON.stringify(result)).not.toContain(SESSION);
    expect(cache.revalidatePath).toHaveBeenCalledWith('/min-side');
  });

  it('sends null to clear the phone, for an explicit null and for an emptied field', async () => {
    loggedIn();
    vi.mocked(updateMe).mockResolvedValue({ ...PROFILE, phone: null });

    await updateProfileAction({ phone: null });
    await updateProfileAction({ phone: '   ' });

    expect(updateMe).toHaveBeenNthCalledWith(1, SESSION, { phone: null });
    expect(updateMe).toHaveBeenNthCalledWith(2, SESSION, { phone: null });
  });

  it('does not forward a key the parent did not send', async () => {
    loggedIn();
    vi.mocked(updateMe).mockResolvedValue(PROFILE);

    await updateProfileAction({ last_name: 'Nordmann' });

    const [, patch] = vi.mocked(updateMe).mock.calls[0];
    expect(Object.keys(patch)).toEqual(['last_name']);
  });

  it.each([
    ['a seven-digit phone', { phone: '4000000' }],
    ['a phone with letters', { phone: '4000000a' }],
    ['a blank first name', { first_name: '   ' }],
    ['a 61-character surname', { last_name: 'x'.repeat(61) }],
    [
      'an eleventh child',
      { family: Array.from({ length: 11 }, () => ({ name: 'A', birth_year: 2020 })) },
    ],
    ['a child with a blank name', { family: [{ name: '', birth_year: 2020 }] }],
    ['a fractional birth year', { family: [{ name: 'Ola', birth_year: 2018.5 }] }],
    ['a birth year in the future', { family: [{ name: 'Ola', birth_year: 2999 }] }],
    ['a birth year before 1900', { family: [{ name: 'Ola', birth_year: 1899 }] }],
  ])('refuses %s locally, before Medal', async (_label, patch) => {
    loggedIn();

    const result = await updateProfileAction(patch);

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(updateMe).not.toHaveBeenCalled();
  });

  /**
   * `readPortalSession` answers `null` for a missing cookie AND for one that is
   * not a Medal token, and does not say which. A malformed `demo_portal` that
   * was merely refused would be read and refused again on every action, so
   * the action clears it — an expired `Set-Cookie` is as cheap when there was
   * nothing in the jar as when there was junk.
   */
  it('answers «session», calls Medal with nothing, and clears the cookie when the read is null', async () => {
    loggedOut();

    const result = await updateProfileAction({ first_name: 'Kari' });

    expect(result).toEqual({ ok: false, reason: 'session' });
    expect(updateMe).not.toHaveBeenCalled();
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });

  it('clears the cookie and answers «session» when Medal says the session is dead', async () => {
    loggedIn();
    vi.mocked(updateMe).mockRejectedValue(new PortalSessionExpiredError());

    const result = await updateProfileAction({ first_name: 'Kari' });

    expect(result).toEqual({ ok: false, reason: 'session' });
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });

  it('hands the engine’s validation message to the form, and revalidates nothing', async () => {
    loggedIn();
    vi.mocked(updateMe).mockRejectedValue(new PortalValidationError('phone: not a number'));

    const result = await updateProfileAction({ first_name: 'Kari' });

    expect(result).toEqual({ ok: false, reason: 'invalid', message: 'phone: not a number' });
    expect(session.clearPortalSession).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('lets anything else become a generic server error', async () => {
    loggedIn();
    vi.mocked(updateMe).mockRejectedValue(new Error('upstream 502'));

    await expect(updateProfileAction({ first_name: 'Kari' })).rejects.toThrow('upstream 502');
  });
});

describe('setMarketingConsentAction', () => {
  it('flips the consent through the profile patch and echoes the stored value', async () => {
    loggedIn();
    vi.mocked(updateMe).mockResolvedValue({ ...PROFILE, marketingConsent: true });

    const result = await setMarketingConsentAction({ granted: true });

    expect(updateMe).toHaveBeenCalledWith(SESSION, { marketing_consent: true });
    expect(result).toEqual({ ok: true, marketingConsent: true });
    expect(JSON.stringify(result)).not.toContain(SESSION);
    expect(cache.revalidatePath).toHaveBeenCalledWith('/min-side');
  });

  it('withdraws the consent the same way', async () => {
    loggedIn();
    vi.mocked(updateMe).mockResolvedValue({ ...PROFILE, marketingConsent: false });

    const result = await setMarketingConsentAction({ granted: false });

    expect(updateMe).toHaveBeenCalledWith(SESSION, { marketing_consent: false });
    expect(result).toEqual({ ok: true, marketingConsent: false });
  });

  it('refuses a non-boolean', async () => {
    loggedIn();

    const result = await setMarketingConsentAction({ granted: 'yes' as unknown as boolean });

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('answers «session» without a cookie', async () => {
    const result = await setMarketingConsentAction({ granted: true });

    expect(result).toEqual({ ok: false, reason: 'session' });
  });
});

describe('exportDataAction', () => {
  it('returns a dated filename and the pretty-printed export', async () => {
    loggedIn();
    vi.mocked(exportMyData).mockResolvedValue(EXPORT);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T20:00:00Z'));

    try {
      const result = await exportDataAction();

      expect(result).toMatchObject({ ok: true, filename: 'min-side-eksport-2026-09-05.json' });
      const data = result as { json: string };
      expect(JSON.parse(data.json)).toEqual(EXPORT);
      // Pretty-printed: a file a person opens, not a wire payload.
      expect(data.json).toContain('\n  ');
      expect(JSON.stringify(result)).not.toContain(SESSION);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the cookie and answers «session» on a dead session', async () => {
    loggedIn();
    vi.mocked(exportMyData).mockRejectedValue(new PortalSessionExpiredError());

    const result = await exportDataAction();

    expect(result).toEqual({ ok: false, reason: 'session' });
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });
});

describe('deleteMeAction', () => {
  it('deletes upstream, then clears the cookie', async () => {
    loggedIn();
    const order: string[] = [];
    vi.mocked(deleteMe).mockImplementation(async () => {
      order.push('delete');
    });
    session.clearPortalSession.mockImplementation(async () => {
      order.push('clear');
    });

    const result = await deleteMeAction({ confirm: 'SLETT' });

    expect(result).toEqual({ ok: true });
    expect(deleteMe).toHaveBeenCalledWith(SESSION);
    expect(order).toEqual(['delete', 'clear']);
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it.each(['slett', 'SLETT ', 'DELETE', ''])(
    'refuses any confirmation but SLETT: %j',
    async (confirm) => {
      loggedIn();

      const result = await deleteMeAction({ confirm: confirm as 'SLETT' });

      expect(result).toMatchObject({ ok: false, reason: 'invalid' });
      expect(deleteMe).not.toHaveBeenCalled();
      expect(session.clearPortalSession).not.toHaveBeenCalled();
    }
  );

  it('answers «session» without a cookie, deletes nothing, and clears the jar', async () => {
    const result = await deleteMeAction({ confirm: 'SLETT' });

    expect(result).toEqual({ ok: false, reason: 'session' });
    expect(deleteMe).not.toHaveBeenCalled();
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });

  /**
   * Medal refusing the session on the delete is the one failure that is NOT
   * «the account still exists, keep the cookie»: the cookie is already dead
   * upstream, so it is cleared and the page is told to send the parent back
   * to the login — the same answer every other action gives.
   */
  it('clears the cookie and answers «session» when Medal says the session is dead', async () => {
    loggedIn();
    vi.mocked(deleteMe).mockRejectedValue(new PortalSessionExpiredError());

    const result = await deleteMeAction({ confirm: 'SLETT' });

    expect(result).toEqual({ ok: false, reason: 'session' });
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('does not clear the cookie when the delete failed — the account still exists', async () => {
    loggedIn();
    vi.mocked(deleteMe).mockRejectedValue(new Error('upstream 502'));

    await expect(deleteMeAction({ confirm: 'SLETT' })).rejects.toThrow('upstream 502');
    expect(session.clearPortalSession).not.toHaveBeenCalled();
  });
});

/**
 * Renewal. Medal slides the session on every call it accepts, but the cookie
 * was written once at login and died 30 days later however active the parent
 * was. An action that Medal answered with the parent's data proves the
 * session was just slid, so it rewrites the cookie; anything else — no
 * cookie, a dead session, a refused edit, a failure, a delete — leaves it.
 */
describe('session renewal in actions', () => {
  it.each([
    ['updateProfileAction', () => updateProfileAction({ first_name: 'Kari' })],
    ['setMarketingConsentAction', () => setMarketingConsentAction({ granted: true })],
  ])('%s renews the cookie after Medal accepted the session', async (_name, run) => {
    loggedIn();
    vi.mocked(updateMe).mockResolvedValue(PROFILE);
    vi.mocked(exportMyData).mockResolvedValue(EXPORT);

    const result = await run();

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(session.renewPortalSession).toHaveBeenCalledTimes(1);
    expect(session.renewPortalSession).toHaveBeenCalledWith(SESSION);
  });

  it('does not renew when there is no session', async () => {
    loggedOut();
    await updateProfileAction({ first_name: 'Kari' });
    expect(session.renewPortalSession).not.toHaveBeenCalled();
  });

  it('does not renew a session Medal says is dead', async () => {
    loggedIn();
    vi.mocked(updateMe).mockRejectedValue(new PortalSessionExpiredError());
    await updateProfileAction({ first_name: 'Kari' });
    expect(session.renewPortalSession).not.toHaveBeenCalled();
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });

  it('does not renew on a refused edit or an upstream failure', async () => {
    loggedIn();
    vi.mocked(updateMe).mockRejectedValueOnce(new PortalValidationError('nope'));
    await updateProfileAction({ first_name: 'Kari' });
    vi.mocked(updateMe).mockRejectedValueOnce(new Error('upstream 502'));
    await expect(updateProfileAction({ first_name: 'Kari' })).rejects.toThrow('upstream 502');
    expect(session.renewPortalSession).not.toHaveBeenCalled();
  });

  /** A cookie write from an action re-renders the page it came from, which
   * would hold the download behind a dashboard render; the hourly touch
   * renews instead. */
  it('does not renew on an export', async () => {
    loggedIn();
    vi.mocked(exportMyData).mockResolvedValue(EXPORT);
    const result = await exportDataAction();
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(session.renewPortalSession).not.toHaveBeenCalled();
  });

  it('never re-sets the cookie a delete has just cleared', async () => {
    loggedIn();
    vi.mocked(deleteMe).mockResolvedValue(undefined);
    const result = await deleteMeAction({ confirm: 'SLETT' });
    expect(result).toEqual({ ok: true });
    expect(session.renewPortalSession).not.toHaveBeenCalled();
  });
});

describe('savePersonAction / removePersonAction', () => {
  const result = { profile: PROFILE, personId: 'p-ola', fallback: false };

  it('creates a child with the details in the seam’s own terms, and revalidates', async () => {
    loggedIn();
    vi.mocked(createPerson).mockResolvedValue(result);

    const answer = await savePersonAction({
      create: true,
      person: {
        name: ' Ola ',
        birth_year: 2018,
        birth_month: 4,
        notes: '',
        preferred_resource_id: 'res-stylist',
      },
    });

    expect(createPerson).toHaveBeenCalledWith(SESSION, {
      name: 'Ola',
      birthYear: 2018,
      birthMonth: 4,
      notes: null,
      preferredResourceId: 'res-stylist',
    });
    expect(answer).toEqual({ ok: true, ...result });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/min-side');
    expect(JSON.stringify(answer)).not.toContain(SESSION);
  });

  it('edits in place by id — a rename is the same child', async () => {
    loggedIn();
    vi.mocked(updatePerson).mockResolvedValue(result);

    await savePersonAction({
      create: false,
      person_id: 'p-ola',
      person: { name: 'Ola Emil', birth_year: 2018 },
    });

    expect(updatePerson).toHaveBeenCalledWith(
      SESSION,
      { personId: 'p-ola', index: undefined },
      { name: 'Ola Emil', birthYear: 2018 }
    );
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('refuses a month outside 1–12 and a stylist id that is not an id', async () => {
    loggedIn();

    const month = await savePersonAction({
      create: true,
      person: { name: 'Ola', birth_year: 2018, birth_month: 13 },
    });
    const stylist = await savePersonAction({
      create: true,
      person: { name: 'Ola', birth_year: 2018, preferred_resource_id: '../x' },
    });

    expect(month).toMatchObject({ ok: false, reason: 'invalid' });
    expect(stylist).toMatchObject({ ok: false, reason: 'invalid' });
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('answers the engine’s refusal as a sentence for the form', async () => {
    loggedIn();
    vi.mocked(createPerson).mockRejectedValue(
      new PortalValidationError('Dette barnet er allerede lagt inn.')
    );

    const answer = await savePersonAction({
      create: true,
      person: { name: 'Ola', birth_year: 2018 },
    });

    expect(answer).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'Dette barnet er allerede lagt inn.',
    });
  });

  it('is a session failure, cookie cleared, when there is no session', async () => {
    const answer = await removePersonAction({ person_id: 'p-ola' });

    expect(answer).toEqual({ ok: false, reason: 'session' });
    expect(session.clearPortalSession).toHaveBeenCalled();
    expect(removePerson).not.toHaveBeenCalled();
  });

  it('removes by id, or by index for a child the profile could not name', async () => {
    loggedIn();
    vi.mocked(removePerson).mockResolvedValue({ ...result, personId: null });

    await removePersonAction({ person_id: 'p-ola' });
    await removePersonAction({ person_id: null, index: 1 });

    expect(removePerson).toHaveBeenNthCalledWith(1, SESSION, {
      personId: 'p-ola',
      index: undefined,
    });
    expect(removePerson).toHaveBeenNthCalledWith(2, SESSION, { personId: null, index: 1 });
  });
});
