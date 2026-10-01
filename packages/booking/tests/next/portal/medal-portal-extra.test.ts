import { MedalApiError, MedalNetworkError } from '@medalsocial/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMedalSeam, type MedalSeam } from '../../../src/next/medal';
import { createPortalSeam, PortalValidationError } from '../../../src/next/portal/medal-portal';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The branches the moved suites do not reach: the redaction edges, the
 * persons fallbacks addressed by index or by an id the family lacks, the
 * optional fields of a person edit, custom form copy, and the odd bodies a
 * raw route can answer with.
 */

// Built, not written out: a literal key reads as a leaked credential to
// secret scanners, and this one is synthetic.
const API_KEY = ['test', 'api', 'key', 'not', 'real'].join('-');
const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

const wireSeam = () =>
  createMedalSeam({
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  });

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Answer = { status: number; body?: unknown };

const WIRE_PROFILE = {
  contact_id: 'ct-1',
  email: 'kari@example.com',
  first_name: 'Kari',
  last_name: null,
  phone: '40000000',
  family: [
    { name: 'Ola', birth_year: 2018 },
    { name: 'Mia', birth_year: 2021 },
  ],
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
    {
      person_id: 'p-mia',
      name: 'Mia',
      birth_year: 2021,
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

const MISSING: Answer = { status: 404, body: 'No matching routes found' };

function stubMedal(route: (call: Call) => Answer | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const call: Call = {
        method: (init.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const answer =
        route(call) ??
        (call.path === '/api/v1/portal/me'
          ? { status: 200, body: { data: WIRE_PROFILE } }
          : MISSING);
      if (answer.status === 204) return new Response(null, { status: 204 });
      return typeof answer.body === 'string'
        ? new Response(answer.body, { status: answer.status })
        : Response.json(answer.body, { status: answer.status });
    })
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv('MEDAL_API_KEY', API_KEY);
  vi.stubEnv('MEDAL_API_ENDPOINT', 'https://medal.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('session redaction, the edges', () => {
  const me = vi.fn();
  const seam = {
    requireMedal: () => ({ portal: { me } }),
    requireMedalWithTimeout: vi.fn(),
    requireMedalConfig: vi.fn(),
  } as unknown as MedalSeam;
  const { getMe } = createPortalSeam(seam, { config: PARITY_CONFIG });

  it('leaves a string cause without the session as it was', async () => {
    const thrown = new Error(`failed for ${SESSION}`, { cause: 'socket hang up' });
    me.mockRejectedValue(thrown);

    const error = (await getMe(SESSION).catch((e: unknown) => e)) as Error;

    expect(error).toBe(thrown);
    expect(error.message).toBe('failed for <session>');
    expect(error.cause).toBe('socket hang up');
  });

  it('skips a non-Error inside an AggregateError', async () => {
    me.mockRejectedValue(new AggregateError(['plain', new Error(`inner ${SESSION}`)], 'many'));

    const error = (await getMe(SESSION).catch((e: unknown) => e)) as AggregateError;

    expect(error.errors[0]).toBe('plain');
    expect((error.errors[1] as Error).message).toBe('inner <session>');
  });

  it('passes a string throw without the session on unchanged', async () => {
    me.mockRejectedValue('boom');

    await expect(getMe(SESSION)).rejects.toBe('boom');
  });

  it('passes a throw that is neither an Error nor a string on unchanged', async () => {
    const odd = { reason: 'odd' };
    me.mockRejectedValue(odd);

    await expect(getMe(SESSION)).rejects.toBe(odd);
  });
});

describe('the raw routes, odd answers', () => {
  it('reads an empty 2xx body as malformed', async () => {
    stubMedal(() => ({ status: 200, body: '' }));
    const { startVippsLogin } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(
      startVippsLogin({ returnUrl: 'https://salong.example/min-side/vipps' })
    ).rejects.toMatchObject({ code: 'NON_JSON_BODY' });
  });

  it('reads a non-JSON error body as UNKNOWN_ERROR', async () => {
    stubMedal(() => ({ status: 502, body: '<html>bad gateway</html>' }));
    const { startVippsLogin } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(
      startVippsLogin({ returnUrl: 'https://salong.example/min-side/vipps' })
    ).rejects.toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('refuses an exchange body whose token is not a string', async () => {
    stubMedal(() => ({ status: 200, body: { data: { session_token: 42, expires_at: 1 } } }));
    const { exchangeVippsGrant } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(exchangeVippsGrant('grant-opaque-value')).rejects.toMatchObject({
      code: 'NON_JSON_BODY',
    });
  });

  it('does not scrub an empty API key it could not read', async () => {
    vi.stubEnv('MEDAL_API_KEY', '');
    const { exchangeVippsGrant } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(exchangeVippsGrant('grant-opaque-value')).rejects.toMatchObject({
      name: 'MedalConfigError',
    });
  });
});

describe('createPerson, the edges', () => {
  it('sends notes when it has them, and is a null id for a create without one', async () => {
    const calls = stubMedal((call) =>
      call.method === 'POST' ? { status: 201, body: { data: {} } } : undefined
    );
    const { createPerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    const result = await createPerson(SESSION, { name: 'Mia', birthYear: 2021, notes: 'Rolig' });

    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Mia',
      birth_year: 2021,
      notes: 'Rolig',
    });
    expect(result).toMatchObject({ personId: null, fallback: false });
  });

  it('is a null id after the fallback when the family names the child twice', async () => {
    stubMedal((call) => {
      if (call.method === 'POST') return MISSING;
      if (call.method === 'PATCH') {
        return {
          status: 200,
          body: {
            data: {
              ...WIRE_PROFILE,
              family: [
                { name: 'Mia', birth_year: 2021 },
                { name: 'Mia', birth_year: 2021 },
              ],
              persons: [],
            },
          },
        };
      }
      return undefined;
    });
    const { createPerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    const result = await createPerson(SESSION, { name: 'Mia', birthYear: 2021 });

    expect(result).toMatchObject({ personId: null, fallback: true });
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['INVALID_INPUT', 400],
  ])('speaks the editor’s words for %s', async (code, status) => {
    stubMedal((call) =>
      call.method === 'POST'
        ? { status, body: { error: { code, message: 'birth_year: too small' } } }
        : undefined
    );
    const { createPerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(createPerson(SESSION, { name: 'Mia', birthYear: 1 })).rejects.toThrow(
      new PortalValidationError('Sjekk navn, fødselsår og måned.')
    );
  });

  it('speaks a site’s own copy when it passes some', async () => {
    stubMedal((call) =>
      call.method === 'POST'
        ? { status: 409, body: { error: { code: 'CONFLICT', message: 'exists' } } }
        : undefined
    );
    const { createPerson } = createPortalSeam(wireSeam(), {
      config: PARITY_CONFIG,
      messages: { duplicateChild: 'Already added.' },
    });

    await expect(createPerson(SESSION, { name: 'Mia', birthYear: 2021 })).rejects.toThrow(
      new PortalValidationError('Already added.')
    );
  });

  it('rethrows a failure that is not an API answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { createPerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(createPerson(SESSION, { name: 'Mia', birthYear: 2021 })).rejects.toBeInstanceOf(
      MedalNetworkError
    );
  });
});

describe('updatePerson, the edges', () => {
  it('sends only the fields it was given, and takes a 204 as done', async () => {
    const calls = stubMedal((call) =>
      call.method === 'PATCH' && call.path === '/api/v1/portal/me/persons/p-ola'
        ? { status: 204 }
        : undefined
    );
    const { updatePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    const result = await updatePerson(
      SESSION,
      { personId: 'p-ola' },
      { preferredResourceId: 'res-a' }
    );

    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      preferred_resource_id: 'res-a',
    });
    expect(result).toMatchObject({ personId: 'p-ola', fallback: false });
  });

  it('goes straight to the list by index when there is no id, keeping the name', async () => {
    const calls = stubMedal((call) =>
      call.method === 'PATCH' && call.path === '/api/v1/portal/me'
        ? {
            status: 200,
            body: {
              data: {
                ...WIRE_PROFILE,
                family: [
                  { name: 'Ola', birth_year: 2018 },
                  { name: 'Mia', birth_year: 2020 },
                ],
                persons: [],
              },
            },
          }
        : undefined
    );
    const { updatePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    const result = await updatePerson(SESSION, { index: 1 }, { birthYear: 2020 });

    expect(calls.some((call) => call.path.startsWith('/api/v1/portal/me/persons'))).toBe(false);
    expect(
      calls.find((call) => call.method === 'PATCH' && call.path === '/api/v1/portal/me')?.body
    ).toEqual({
      family: [
        { name: 'Ola', birth_year: 2018 },
        { name: 'Mia', birth_year: 2020 },
      ],
    });
    expect(result).toMatchObject({ personId: null, fallback: true });
  });

  it.each([
    ['no id and no index', {}],
    ['an index past the end', { index: 5 }],
    ['a negative index', { index: -1 }],
  ])('is the editor’s «not found» for %s', async (_label, target) => {
    stubMedal(() => undefined);
    const { updatePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(updatePerson(SESSION, target, { name: 'X' })).rejects.toThrow(
      new PortalValidationError('Fant ikke barnet. Last siden på nytt og prøv igjen.')
    );
  });

  it('is «not found» when the fallback cannot find the id in the family', async () => {
    stubMedal(() => undefined);
    const { updatePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(updatePerson(SESSION, { personId: 'p-gone' }, { name: 'X' })).rejects.toThrow(
      PortalValidationError
    );
  });
});

describe('removePerson, the edges', () => {
  it('falls back to the list by id when Medal has no person routes', async () => {
    const calls = stubMedal((call) =>
      call.method === 'PATCH' && call.path === '/api/v1/portal/me'
        ? {
            status: 200,
            body: {
              data: {
                ...WIRE_PROFILE,
                family: [WIRE_PROFILE.family[1]],
                persons: [WIRE_PROFILE.persons[1]],
              },
            },
          }
        : undefined
    );
    const { removePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    const result = await removePerson(SESSION, { personId: 'p-ola' });

    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(
      calls.find((call) => call.method === 'PATCH' && call.path === '/api/v1/portal/me')?.body
    ).toEqual({ family: [{ name: 'Mia', birth_year: 2021 }] });
    expect(result).toMatchObject({ personId: 'p-ola', fallback: true });
  });

  it('is «not found» for a child the family does not have', async () => {
    stubMedal(() => undefined);
    const { removePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    await expect(removePerson(SESSION, { index: 9 })).rejects.toThrow(PortalValidationError);
  });

  it('is «not found» for the engine’s own 404', async () => {
    stubMedal((call) =>
      call.method === 'DELETE'
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Person not found' } } }
        : undefined
    );
    const { removePerson } = createPortalSeam(wireSeam(), { config: PARITY_CONFIG });

    const error = await removePerson(SESSION, { personId: 'p-gone' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PortalValidationError);
    expect(error).not.toBeInstanceOf(MedalApiError);
  });
});
