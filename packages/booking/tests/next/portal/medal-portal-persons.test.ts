import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMedalSeam } from '../../../src/next/medal';
import {
  createPortalSeam,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
} from '../../../src/next/portal/medal-portal';
import { PARITY_CONFIG } from '../../support/parity-config';

/** Key and origin read per call, so `vi.stubEnv` drives the seam as it drove the source. */
const { createPerson, removePerson, updatePerson } = createPortalSeam(
  createMedalSeam({
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  }),
  { config: PARITY_CONFIG }
);

/**
 * The SP10 person routes of the portal seam, on the wire: what is sent (the
 * session in `x-portal-session`, the snake_case body), how the answers are
 * read, and the FEATURE DETECTION that keeps the site working against a
 * Medal without them — a 404 that is not the engine's own «Person not
 * found» is a missing route, and the seam falls back to `PATCH /me {family}`.
 * The profile re-read after each edit goes through the SDK over the same
 * stubbed `fetch`.
 */

const API_KEY = 'test-api-key-not-real';
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

type Route = (call: Call) => { status: number; body?: unknown } | undefined;

const WIRE_PROFILE = {
  contact_id: 'ct-1',
  email: 'kari@example.com',
  first_name: 'Kari',
  last_name: null,
  phone: '40000000',
  family: [{ name: 'Ola', birth_year: 2018 }],
  persons: [
    {
      person_id: 'p-ola',
      name: 'Ola',
      birth_year: 2018,
      relation_type: 'guardian',
      relation_label: null,
      notes: null,
      active: true,
    },
  ],
  labels: { person: 'Barn', persons: 'Barn' },
  marketing_consent: false,
  created_at: 1,
};

function stubMedal(route: Route): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const call: Call = {
        method: (init.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init.headers),
      };
      calls.push(call);
      const answer = route(call) ?? defaults(call);
      if (answer.status === 204) return new Response(null, { status: 204 });
      return typeof answer.body === 'string'
        ? new Response(answer.body, { status: answer.status })
        : Response.json(answer.body, { status: answer.status });
    })
  );
  return calls;
}

function defaults(call: Call): { status: number; body?: unknown } {
  if (call.path === '/api/v1/portal/me') return { status: 200, body: { data: WIRE_PROFILE } };
  return { status: 404, body: 'No matching routes found' };
}

const MISSING = { status: 404, body: 'No matching routes found' };

beforeEach(() => {
  vi.stubEnv('MEDAL_API_KEY', API_KEY);
  vi.stubEnv('MEDAL_API_ENDPOINT', 'https://medal.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createPerson', () => {
  it('posts the child with the session and only the details it was given', async () => {
    const calls = stubMedal((call) =>
      call.method === 'POST' && call.path === '/api/v1/portal/me/persons'
        ? { status: 201, body: { data: { person_id: 'p-mia' } } }
        : undefined
    );

    const result = await createPerson(SESSION, {
      name: 'Mia',
      birthYear: 2021,
      birthMonth: 4,
      notes: null,
      preferredResourceId: 'res-sara',
    });

    const post = calls.find((call) => call.method === 'POST');
    expect(post?.headers.get('x-portal-session')).toBe(SESSION);
    expect(post?.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    // `notes: null` on a create is «nothing» — the strict schema takes no null.
    expect(post?.body).toEqual({
      name: 'Mia',
      birth_year: 2021,
      birth_month: 4,
      preferred_resource_id: 'res-sara',
    });
    expect(result.personId).toBe('p-mia');
    expect(result.fallback).toBe(false);
    expect(result.profile.email).toBe('kari@example.com');
  });

  it('falls back to the whole family list when Medal has no person routes', async () => {
    const calls = stubMedal((call) => {
      if (call.method === 'POST') return MISSING;
      if (call.method === 'PATCH' && call.path === '/api/v1/portal/me') {
        return {
          status: 200,
          body: {
            data: {
              ...WIRE_PROFILE,
              family: [...WIRE_PROFILE.family, { name: 'Mia', birth_year: 2021 }],
              persons: [
                ...WIRE_PROFILE.persons,
                { ...WIRE_PROFILE.persons[0], person_id: 'p-mia', name: 'Mia', birth_year: 2021 },
              ],
            },
          },
        };
      }
      return undefined;
    });

    const result = await createPerson(SESSION, { name: 'Mia', birthYear: 2021, birthMonth: 4 });

    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      family: [
        { name: 'Ola', birth_year: 2018 },
        { name: 'Mia', birth_year: 2021 },
      ],
    });
    expect(result.fallback).toBe(true);
    expect(result.personId).toBe('p-mia');
  });

  it('speaks the editor’s words for a duplicate child, never the engine’s', async () => {
    stubMedal((call) =>
      call.method === 'POST'
        ? { status: 409, body: { error: { code: 'CONFLICT', message: 'person exists: Mia' } } }
        : undefined
    );

    await expect(createPerson(SESSION, { name: 'Mia', birthYear: 2021 })).rejects.toThrow(
      new PortalValidationError('Dette barnet er allerede lagt inn.')
    );
  });

  it('sends a create exactly once — a 503 is not retried into a 409', async () => {
    const calls = stubMedal((call) =>
      call.method === 'POST'
        ? { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'down' } } }
        : undefined
    );

    await expect(createPerson(SESSION, { name: 'Mia', birthYear: 2021 })).rejects.toThrow();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('maps a dead session, and keeps it out of what it throws', async () => {
    stubMedal((call) =>
      call.method === 'POST'
        ? {
            status: 401,
            body: { error: { code: 'PORTAL_SESSION_INVALID', message: `bad ${SESSION}` } },
          }
        : undefined
    );

    const error = await createPerson(SESSION, { name: 'Mia', birthYear: 2021 }).catch(
      (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(PortalSessionExpiredError);
    expect(String((error as Error).stack)).not.toContain(SESSION);
  });
});

describe('updatePerson', () => {
  it('patches ONE child by id — a rename keeps the id', async () => {
    const calls = stubMedal((call) =>
      call.method === 'PATCH' && call.path === '/api/v1/portal/me/persons/p-ola'
        ? { status: 200, body: { data: { person_id: 'p-ola' } } }
        : undefined
    );

    const result = await updatePerson(
      SESSION,
      { personId: 'p-ola' },
      { name: 'Ola Emil', birthYear: 2018, birthMonth: null, notes: 'Liker film' }
    );

    const patch = calls.find((call) => call.method === 'PATCH');
    // `null` clears on an edit.
    expect(patch?.body).toEqual({
      name: 'Ola Emil',
      birth_year: 2018,
      birth_month: null,
      notes: 'Liker film',
    });
    expect(result).toMatchObject({ personId: 'p-ola', fallback: false });
  });

  it('sends a patch exactly once — a 429 is the throttle at once, not a retry', async () => {
    const calls = stubMedal((call) =>
      call.method === 'PATCH' && call.path === '/api/v1/portal/me/persons/p-ola'
        ? { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down' } } }
        : undefined
    );

    await expect(
      updatePerson(SESSION, { personId: 'p-ola' }, { name: 'Ole' })
    ).rejects.toBeInstanceOf(PortalThrottledError);
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('is the editor’s «not found» for the engine’s own 404, not a fallback', async () => {
    const calls = stubMedal((call) =>
      call.method === 'PATCH' && call.path.startsWith('/api/v1/portal/me/persons/')
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Person not found' } } }
        : undefined
    );

    await expect(updatePerson(SESSION, { personId: 'p-gone' }, { name: 'X' })).rejects.toThrow(
      PortalValidationError
    );
    expect(calls.some((call) => call.path === '/api/v1/portal/me' && call.method === 'PATCH')).toBe(
      false
    );
  });

  it('falls back to rewriting that child’s entry in the family list', async () => {
    const calls = stubMedal((call) => {
      if (call.path.startsWith('/api/v1/portal/me/persons/')) return MISSING;
      if (call.method === 'PATCH' && call.path === '/api/v1/portal/me') {
        return {
          status: 200,
          body: { data: { ...WIRE_PROFILE, family: [{ name: 'Ola Emil', birth_year: 2018 }] } },
        };
      }
      return undefined;
    });

    const result = await updatePerson(SESSION, { personId: 'p-ola' }, { name: 'Ola Emil' });

    expect(
      calls.find((call) => call.method === 'PATCH' && call.path === '/api/v1/portal/me')?.body
    ).toEqual({
      family: [{ name: 'Ola Emil', birth_year: 2018 }],
    });
    expect(result.fallback).toBe(true);
  });
});

describe('removePerson', () => {
  it('deletes one child by id', async () => {
    const calls = stubMedal((call) => (call.method === 'DELETE' ? { status: 204 } : undefined));

    const result = await removePerson(SESSION, { personId: 'p-ola' });

    const remove = calls.find((call) => call.method === 'DELETE');
    expect(remove?.path).toBe('/api/v1/portal/me/persons/p-ola');
    expect(remove?.body).toBeUndefined();
    expect(result.fallback).toBe(false);
  });

  it('sends a remove exactly once — a 503 is not retried into a 404', async () => {
    const calls = stubMedal((call) =>
      call.method === 'DELETE'
        ? { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'down' } } }
        : undefined
    );

    await expect(removePerson(SESSION, { personId: 'p-ola' })).rejects.toThrow();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('falls back to the list without that child, by index when there is no id', async () => {
    const calls = stubMedal((call) => {
      if (call.method === 'PATCH' && call.path === '/api/v1/portal/me') {
        return { status: 200, body: { data: { ...WIRE_PROFILE, family: [], persons: [] } } };
      }
      return undefined;
    });

    const result = await removePerson(SESSION, { personId: null, index: 0 });

    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ family: [] });
    expect(result.fallback).toBe(true);
  });
});
