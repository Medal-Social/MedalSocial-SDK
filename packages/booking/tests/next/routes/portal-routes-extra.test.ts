import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalProfileDto } from '../../../src/core/portal/dto';
import { PortalThrottledError } from '../../../src/next/portal/medal-portal';
import {
  personsRoute,
  sessionExpiredRoute,
  vippsLinkVerifyRoute,
} from '../../../src/next/routes/portal-routes';
import { testLogger, testRuntime } from '../../support/next-runtime';

/**
 * The branches of the portal routes the moved suites do not reach: how the
 * wizard's new child is found in the profile Medal answers with, the throttle
 * on «add a child», a body over the ceiling, and a site with no portal page.
 */

const SITE = 'https://salong.example';
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');
const YEAR = new Date().getFullYear();

function member(overrides: Partial<PortalProfileDto['family'][number]> = {}) {
  return {
    personId: null,
    name: 'Mia',
    birthYear: YEAR - 3,
    birthMonth: null,
    notes: null,
    preferredResourceId: null,
    ...overrides,
  };
}

function profile(family: PortalProfileDto['family']): PortalProfileDto {
  return {
    contactId: 'ct-1',
    email: 'kari@example.com',
    firstName: 'Kari',
    lastName: null,
    phone: null,
    family,
    personDetails: true,
    marketingConsent: false,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('personsRoute — the child it answers with', () => {
  const readPortalSession = vi.fn();
  const createPerson = vi.fn();
  const logger = testLogger();
  const rt = testRuntime(
    { session: { readPortalSession } as never, portal: { createPerson } as never },
    { logger }
  );
  const add = (body: unknown) => personsRoute(rt, post('/api/portal/persons', body));

  beforeEach(() => {
    vi.clearAllMocks();
    readPortalSession.mockResolvedValue(SESSION);
  });

  it('finds the child by name and year when Medal names no id', async () => {
    createPerson.mockResolvedValue({
      profile: profile([member({ name: 'Noa', birthYear: YEAR - 5 }), member({ birthMonth: 2 })]),
      personId: null,
      fallback: true,
    });

    const response = await add({ name: 'Mia', birthYear: YEAR - 3 });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      child: { name: 'Mia', birthYear: YEAR - 3, birthMonth: 2 },
    });
  });

  it('falls back to name and year when the id Medal named is not in the profile', async () => {
    createPerson.mockResolvedValue({
      profile: profile([member({ personId: 'p-other', name: 'Mia' })]),
      personId: 'p-missing',
      fallback: false,
    });

    const response = await add({ name: 'Mia', birthYear: YEAR - 3 });

    expect(await response.json()).toEqual({
      ok: true,
      child: { name: 'Mia', birthYear: YEAR - 3, personId: 'p-other' },
    });
  });

  it('answers with what was asked for when the profile does not show the child', async () => {
    createPerson.mockResolvedValue({ profile: profile([]), personId: null, fallback: true });

    const withMonth = await add({ name: 'Mia', birthYear: YEAR - 3, birthMonth: 6 });
    expect(await withMonth.json()).toEqual({
      ok: true,
      child: { name: 'Mia', birthYear: YEAR - 3, birthMonth: 6 },
    });

    const withoutMonth = await add({ name: 'Mia', birthYear: YEAR - 3 });
    expect(await withoutMonth.json()).toEqual({
      ok: true,
      child: { name: 'Mia', birthYear: YEAR - 3 },
    });
  });

  it('sends no empty note to Medal', async () => {
    createPerson.mockResolvedValue({ profile: profile([]), personId: null, fallback: true });

    await add({ name: 'Mia', birthYear: YEAR - 3, notes: '   ' });

    expect(createPerson).toHaveBeenCalledWith(SESSION, { name: 'Mia', birthYear: YEAR - 3 });
  });

  it('answers «throttled» when Medal is rate-limiting, and logs nothing', async () => {
    createPerson.mockRejectedValue(new PortalThrottledError());

    const response = await add({ name: 'Mia', birthYear: YEAR - 3 });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, reason: 'throttled' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an outage', async () => {
    createPerson.mockRejectedValue(new Error('down'));

    expect((await add({ name: 'Mia', birthYear: YEAR - 3 })).status).toBe(503);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('refuses a body over the ceiling without parsing it', async () => {
    const response = await add({ name: 'Mia', birthYear: YEAR - 3, notes: 'x'.repeat(4096) });

    expect(response.status).toBe(400);
    expect(createPerson).not.toHaveBeenCalled();
  });
});

describe('sessionExpiredRoute on a site with no portal page', () => {
  it('sends a session Medal still honours to the login, the only portal page there is', async () => {
    const base = testRuntime();
    const rt = testRuntime({
      session: { readPortalSession: vi.fn(async () => SESSION) } as never,
      portal: { getMe: vi.fn(async () => ({})) } as never,
      paths: { ...base.paths, portal: null },
    });

    const response = await sessionExpiredRoute(
      rt,
      new Request(`${SITE}/api/portal/session/expired`)
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/min-side/logg-inn`);
  });
});

describe('vippsLinkVerifyRoute — a body over the ceiling', () => {
  it('is «invalid», and asks Medal nothing', async () => {
    const verifyVippsLink = vi.fn();
    const rt = testRuntime({ portal: { verifyVippsLink } as never });

    const response = await vippsLinkVerifyRoute(
      rt,
      post('/api/portal/vipps/link/verify', { code: '492155', pad: 'x'.repeat(2048) })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyVippsLink).not.toHaveBeenCalled();
  });
});
