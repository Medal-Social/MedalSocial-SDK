import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The parts of `createPortalActions` the moved suite does not reach: the
 * `verifyLogin` action (the package ships one for a page that wants the
 * re-render), the single-child actions, the site's own options (locale,
 * export file name, delete word), a site with no portal page, and
 * `createPortalFor`.
 */

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);
const request = vi.hoisted(() => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/headers', () => request);
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

import type { PortalProfileDto } from '../../src/core/portal/dto';
import type { BookingServerOptions } from '../../src/next/options';
import { createPortalActions, createPortalFor, createPortalSchemas } from '../../src/next/portal';
import {
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
} from '../../src/next/portal/medal-portal';
import type { BookingRuntime } from '../../src/next/runtime';
import { testLogger, testRuntime } from '../support/next-runtime';

const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

const PROFILE: PortalProfileDto = {
  contactId: 'ct-1',
  email: 'kari@example.com',
  firstName: 'Kari',
  lastName: null,
  phone: '40000000',
  family: [],
  personDetails: true,
  marketingConsent: false,
};

const session = {
  readPortalSession: vi.fn<() => Promise<string | null>>(),
  writePortalSession: vi.fn<(token: string, expiresAt: number) => Promise<void>>(),
  clearPortalSession: vi.fn<() => Promise<void>>(),
  renewPortalSession: vi.fn<(token: string) => Promise<void>>(),
};
const vippsLink = {
  writeBrowserBinding: vi.fn(async () => {}),
  clearBrowserBinding: vi.fn(async () => {}),
};
const nextPath = { writePortalNextPath: vi.fn(async () => {}) };
const portal = {
  startLogin: vi.fn(),
  verifyLogin: vi.fn(),
  startVippsLogin: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  removePerson: vi.fn(),
  exportMyData: vi.fn(),
  deleteMe: vi.fn(),
};
const guardianFromSession = vi.fn();
const logger = testLogger();

function build(
  options: Partial<BookingServerOptions> = {},
  overrides: Partial<BookingRuntime> = {}
): BookingRuntime {
  return testRuntime(
    {
      session: session as never,
      vippsLink: vippsLink as never,
      nextPath: nextPath as never,
      portal: portal as never,
      guardianFromSession,
      ...overrides,
    },
    { logger, baseUrl: 'https://salong.example', ...options }
  );
}

const actions = createPortalActions(build());
const PERSON_RESULT = { profile: PROFILE, personId: 'p-1', fallback: false };

beforeEach(() => {
  vi.clearAllMocks();
  session.readPortalSession.mockResolvedValue(SESSION);
});

describe('verifyLogin (the action)', () => {
  const input = { email: ' Kari@Example.com ', code: '123456' };

  it('writes the cookie and answers with the guardian, never the token', async () => {
    portal.verifyLogin.mockResolvedValue({ sessionToken: SESSION, expiresAt: 1234 });
    guardianFromSession.mockResolvedValue({ firstName: 'Kari' });

    const result = await actions.verifyLogin(input);

    expect(portal.verifyLogin).toHaveBeenCalledWith('kari@example.com', '123456');
    expect(session.writePortalSession).toHaveBeenCalledWith(SESSION, 1234);
    expect(guardianFromSession).toHaveBeenCalledWith(SESSION);
    expect(result).toEqual({ ok: true, guardian: { firstName: 'Kari' } });
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('refuses a malformed code before Medal', async () => {
    expect(await actions.verifyLogin({ email: 'kari@example.com', code: '12' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(portal.verifyLogin).not.toHaveBeenCalled();
  });

  it('is «invalid» for a wrong code, and writes nothing', async () => {
    portal.verifyLogin.mockResolvedValue(null);

    expect(await actions.verifyLogin(input)).toEqual({ ok: false, reason: 'invalid' });
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });

  it('is «throttled» without logging, and «unreachable» with', async () => {
    portal.verifyLogin.mockRejectedValueOnce(new PortalThrottledError());
    expect(await actions.verifyLogin(input)).toEqual({ ok: false, reason: 'throttled' });
    expect(logger.error).not.toHaveBeenCalled();

    portal.verifyLogin.mockRejectedValueOnce(new Error('down'));
    expect(await actions.verifyLogin(input)).toEqual({ ok: false, reason: 'unreachable' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });
});

describe('createPerson / updatePerson', () => {
  it('creates a child, clearing blank text and keeping a null stylist', async () => {
    portal.createPerson.mockResolvedValue(PERSON_RESULT);

    const result = await actions.createPerson({
      person: {
        name: ' Mia ',
        birth_year: 2020,
        notes: 'Første klipp',
        preferred_resource_id: null,
      },
    });

    expect(portal.createPerson).toHaveBeenCalledWith(SESSION, {
      name: 'Mia',
      birthYear: 2020,
      notes: 'Første klipp',
      preferredResourceId: null,
    });
    expect(result).toEqual({ ok: true, ...PERSON_RESULT });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/min-side');
    expect(session.renewPortalSession).toHaveBeenCalledWith(SESSION);
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('clears the month and the note when the form sends null', async () => {
    portal.createPerson.mockResolvedValue(PERSON_RESULT);

    await actions.createPerson({
      person: { name: 'Mia', birth_year: 2020, birth_month: null, notes: null },
    });

    expect(portal.createPerson).toHaveBeenCalledWith(SESSION, {
      name: 'Mia',
      birthYear: 2020,
      birthMonth: null,
      notes: null,
    });
  });

  it('edits by id or index', async () => {
    portal.updatePerson.mockResolvedValue(PERSON_RESULT);

    const result = await actions.updatePerson({
      index: 2,
      person: { name: 'Mia', birth_year: 2020, notes: '', preferred_resource_id: 'res-1' },
    });

    expect(portal.updatePerson).toHaveBeenCalledWith(
      SESSION,
      { personId: undefined, index: 2 },
      { name: 'Mia', birthYear: 2020, notes: null, preferredResourceId: 'res-1' }
    );
    expect(result).toEqual({ ok: true, ...PERSON_RESULT });
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('refuses a malformed child before Medal, with the first issue as the message', async () => {
    const created = await actions.createPerson({ person: { name: '', birth_year: 2020 } });
    const updated = await actions.updatePerson({ person: { name: 'Mia', birth_year: 1800 } });

    expect(created).toMatchObject({ ok: false, reason: 'invalid' });
    expect(updated).toEqual({
      ok: false,
      reason: 'invalid',
      message: rt().messages.invalidBirthYear,
    });
    expect(portal.createPerson).not.toHaveBeenCalled();
    expect(portal.updatePerson).not.toHaveBeenCalled();
  });

  it('answers the engine’s refusal as a sentence, and lets anything else throw', async () => {
    portal.updatePerson.mockRejectedValueOnce(new PortalValidationError('Finnes ikke.'));
    expect(
      await actions.updatePerson({ person_id: 'p-1', person: { name: 'Mia', birth_year: 2020 } })
    ).toEqual({ ok: false, reason: 'invalid', message: 'Finnes ikke.' });

    portal.updatePerson.mockRejectedValueOnce(new Error('upstream 502'));
    await expect(
      actions.updatePerson({ person_id: 'p-1', person: { name: 'Mia', birth_year: 2020 } })
    ).rejects.toThrow('upstream 502');
    expect(session.renewPortalSession).not.toHaveBeenCalled();
  });

  it('is a session failure, cookie cleared, for a session Medal no longer honours', async () => {
    portal.createPerson.mockRejectedValue(new PortalSessionExpiredError());

    const result = await actions.createPerson({ person: { name: 'Mia', birth_year: 2020 } });

    expect(result).toEqual({ ok: false, reason: 'session' });
    expect(session.clearPortalSession).toHaveBeenCalledTimes(1);
  });
});

describe('the other actions refuse malformed input before Medal', () => {
  it.each([
    ['savePerson', () => actions.savePerson({ person: { name: 'Mia', birth_year: 2020 } })],
    ['removePerson', () => actions.removePerson({ index: -1 })],
    ['setMarketingConsent', () => actions.setMarketingConsent({})],
  ])('%s', async (_name, run) => {
    expect(await run()).toMatchObject({ ok: false, reason: 'invalid' });
    expect(session.readPortalSession).not.toHaveBeenCalled();
  });
});

describe('the site’s own options', () => {
  it('asks for a code in the site’s locale when it names one', async () => {
    const english = createPortalActions(build({ portal: { locale: 'en' } }));
    portal.startLogin.mockResolvedValue(undefined);

    expect(await english.startLogin({ email: 'kari@example.com' })).toEqual({ status: 'sent' });
    expect(portal.startLogin).toHaveBeenCalledWith('kari@example.com', 'en');
  });

  it('names the export file with the site’s prefix', async () => {
    const site = createPortalActions(build({ portal: { exportFilePrefix: 'my-data' } }));
    portal.exportMyData.mockResolvedValue({ bookings: [] });

    const result = await site.exportData();

    expect(result).toMatchObject({
      ok: true,
      filename: expect.stringMatching(/^my-data-\d{4}-\d{2}-\d{2}\.json$/),
    });
    expect(JSON.stringify(result)).not.toContain(SESSION);
  });

  it('confirms a delete with the site’s word, and only that word', async () => {
    const site = createPortalActions(build({ portal: { deleteConfirmWord: 'DELETE' } }));
    portal.deleteMe.mockResolvedValue(undefined);

    expect(await site.deleteMe({ confirm: 'SLETT' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(portal.deleteMe).not.toHaveBeenCalled();

    expect(await site.deleteMe({ confirm: 'DELETE' })).toEqual({ ok: true });
    expect(portal.deleteMe).toHaveBeenCalledWith(SESSION);
  });

  it('builds the Vipps return URL on the request host when the site names no base URL', async () => {
    const site = createPortalActions(build({ baseUrl: undefined }));
    request.headers.mockResolvedValueOnce(new Headers({ host: 'localhost:3000' }));
    portal.startVippsLogin.mockResolvedValue({ authorizeUrl: 'https://vipps.example/auth' });

    await expect(site.startVipps(null)).rejects.toThrow('NEXT_REDIRECT');

    expect(portal.startVippsLogin).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: 'http://localhost:3000/min-side/vipps' })
    );
  });

  it('treats a `next` that is not text as no destination', async () => {
    const form = new FormData();
    form.set('next', new Blob(['/bestill']));
    portal.startVippsLogin.mockResolvedValue({ authorizeUrl: 'https://vipps.example/auth' });

    await expect(actions.startVipps(null, form)).rejects.toThrow('NEXT_REDIRECT');

    expect(nextPath.writePortalNextPath).toHaveBeenCalledWith(null);
  });
});

describe('a site with no portal page', () => {
  it('revalidates the booking page instead', async () => {
    const base = testRuntime();
    const site = createPortalActions(build({}, { paths: { ...base.paths, portal: null } }));
    portal.removePerson.mockResolvedValue(PERSON_RESULT);

    expect(await site.removePerson({ person_id: 'p-1' })).toEqual({ ok: true, ...PERSON_RESULT });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/bestill');
  });
});

describe('createPortalFor', () => {
  it('bundles the session, the actions, the schemas and the two return routes', async () => {
    const runtime = build({ portal: { enabled: async () => false } });
    const bundle = createPortalFor(runtime);

    expect(bundle.session).toBe(runtime.session);
    expect(Object.keys(bundle.actions)).toEqual(Object.keys(createPortalActions(runtime)));
    expect(Object.keys(bundle.schemas)).toEqual(Object.keys(createPortalSchemas(runtime)));

    const login = await bundle.vippsReturn.GET(
      new Request('https://salong.example/min-side/vipps')
    );
    const link = await bundle.vippsLinkReturn.GET(
      new Request('https://salong.example/min-side/vipps/link')
    );
    // Switched off: both send the browser home, which proves they are the routes.
    expect(login.headers.get('location')).toBe('https://salong.example/');
    expect(link.headers.get('location')).toBe('https://salong.example/');
  });
});

function rt(): BookingRuntime {
  return build();
}
