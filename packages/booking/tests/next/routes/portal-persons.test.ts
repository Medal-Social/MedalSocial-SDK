import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalProfileDto } from '../../../src/core/portal/dto';
import {
  PortalSessionExpiredError,
  PortalValidationError,
} from '../../../src/next/portal/medal-portal';
import { personsRoute } from '../../../src/next/routes/portal-routes';
import { testRuntime } from '../../support/next-runtime';

/**
 * `POST /api/portal/persons` — step 1's «+ Legg til barn» for a logged-in
 * parent. Same-origin strictly (it writes to the parent's account), the
 * session read from the cookie and never in the answer, the child narrowed as
 * `/bestill` narrows the family.
 */

const session = {
  readPortalSession: vi.fn<() => Promise<string | null>>(),
};
const createPerson = vi.fn();

const rt = testRuntime({ session: session as never, portal: { createPerson } as never });
const POST = (request: Request) => personsRoute(rt, request);

const SESSION = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');
const SITE = 'https://salong.example';
const YEAR = new Date().getFullYear();

const PROFILE: PortalProfileDto = {
  contactId: 'ct-1',
  email: 'kari@example.com',
  firstName: 'Kari',
  lastName: null,
  phone: '40000000',
  family: [
    {
      personId: 'p-mia',
      name: 'Mia',
      birthYear: YEAR - 3,
      birthMonth: 4,
      notes: 'Første klipp',
      preferredResourceId: null,
    },
  ],
  personDetails: true,
  marketingConsent: false,
};

function post(body: unknown, headers: Record<string, string> = { origin: SITE }): Request {
  return new Request(`${SITE}/api/portal/persons`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.readPortalSession.mockResolvedValue(SESSION);
  vi.mocked(createPerson).mockResolvedValue({
    profile: PROFILE,
    personId: 'p-mia',
    fallback: false,
  });
});

describe('POST /api/portal/persons', () => {
  it('creates the child and answers with them, narrowed, without the session or the note', async () => {
    const response = await POST(
      post({ name: ' Mia ', birthYear: YEAR - 3, birthMonth: 4, notes: 'Første klipp' })
    );
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({
      ok: true,
      child: { name: 'Mia', birthYear: YEAR - 3, birthMonth: 4, personId: 'p-mia' },
    });
    expect(createPerson).toHaveBeenCalledWith(SESSION, {
      name: 'Mia',
      birthYear: YEAR - 3,
      birthMonth: 4,
      notes: 'Første klipp',
    });
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain('Første klipp');
    expect(text).not.toContain('ct-1');
  });

  it('refuses another origin, and a request that declares none', async () => {
    expect((await POST(post({}, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(post({}, {}))).status).toBe(403);
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('is a session failure without a cookie', async () => {
    session.readPortalSession.mockResolvedValue(null);
    const response = await POST(post({ name: 'Mia', birthYear: YEAR - 3 }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: 'session' });
  });

  it('refuses a child outside the eighteen-year window or a month that is not one', async () => {
    expect((await POST(post({ name: 'Mia', birthYear: YEAR - 30 }))).status).toBe(400);
    expect((await POST(post({ name: 'Mia', birthYear: YEAR - 3, birthMonth: 13 }))).status).toBe(
      400
    );
    expect((await POST(post('{not json'))).status).toBe(400);
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('passes the editor’s sentence through for a refusal, and maps a dead session', async () => {
    vi.mocked(createPerson).mockRejectedValueOnce(
      new PortalValidationError('Dette barnet er allerede lagt inn.')
    );
    const refused = await POST(post({ name: 'Mia', birthYear: YEAR - 3 }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'Dette barnet er allerede lagt inn.',
    });

    vi.mocked(createPerson).mockRejectedValueOnce(new PortalSessionExpiredError());
    expect((await POST(post({ name: 'Mia', birthYear: YEAR - 3 }))).status).toBe(401);

    vi.mocked(createPerson).mockRejectedValueOnce(new Error('down'));
    expect((await POST(post({ name: 'Mia', birthYear: YEAR - 3 }))).status).toBe(503);
  });
});
