import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PortalThrottledError,
  PortalVippsConflictError,
} from '../../../src/next/portal/medal-portal';
import { vippsLinkVerifyRoute } from '../../../src/next/routes/portal-routes';
import { testRuntime } from '../../support/next-runtime';

/**
 * `POST /api/portal/vipps/link/verify` — the e-mail code that confirms a
 * conflicted Vipps login (SP10). The body is the code alone; the link and
 * the browser binding come from their httpOnly cookies and go to Medal in a
 * POST body. The session goes into its cookie and never into the answer.
 */

const session = {
  writePortalSession: vi.fn<(token: string, expiresAt: number) => Promise<void>>(),
};
const link = {
  readVippsLinkPair: vi.fn<() => Promise<{ link: string; binding: string } | null>>(),
  clearVippsLinkPair: vi.fn<() => Promise<void>>(),
};
const guardianFromSession = vi.fn(async () => ({
  firstName: 'Kari',
  lastName: null,
  email: 'kari@example.com',
  phone: '40000000',
  family: [],
}));
const verifyVippsLink = vi.fn();

const rt = testRuntime({
  session: session as never,
  vippsLink: link as never,
  guardianFromSession,
  portal: { verifyVippsLink } as never,
});
const POST = (request: Request) => vippsLinkVerifyRoute(rt, request);

const SITE = 'https://salong.example';
const LINK = ['link', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');
const BINDING = ['bind', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklm'].join('');
const TOKEN = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLM', '0-_9'].join('');

function post(body: unknown, headers: Record<string, string> = { origin: SITE }): Request {
  return new Request(`${SITE}/api/portal/vipps/link/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  link.readVippsLinkPair.mockResolvedValue({ link: LINK, binding: BINDING });
  vi.mocked(verifyVippsLink).mockResolvedValue({ sessionToken: TOKEN, expiresAt: 1234 });
});

describe('POST /api/portal/vipps/link/verify', () => {
  it('verifies the code with the cookies’ link and binding, logs in, and spends both', async () => {
    const response = await POST(post({ code: '492155' }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(verifyVippsLink).toHaveBeenCalledWith({
      link: LINK,
      code: '492155',
      browserBinding: BINDING,
    });
    expect(session.writePortalSession).toHaveBeenCalledWith(TOKEN, 1234);
    expect(link.clearVippsLinkPair).toHaveBeenCalledTimes(1);
    expect(JSON.parse(text)).toMatchObject({ ok: true, guardian: { email: 'kari@example.com' } });
    for (const secret of [TOKEN, LINK, BINDING]) expect(text).not.toContain(secret);
  });

  it('takes the code and nothing else — a link in the body is refused, not used', async () => {
    const response = await POST(post({ code: '492155', link: 'someone-elses-link' }));

    expect(response.status).toBe(400);
    expect(verifyVippsLink).not.toHaveBeenCalled();
  });

  it('is «wrong or expired» for a wrong code, and keeps the cookies for another try', async () => {
    vi.mocked(verifyVippsLink).mockResolvedValue(null);

    const response = await POST(post({ code: '000000' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid' });
    expect(session.writePortalSession).not.toHaveBeenCalled();
    expect(link.clearVippsLinkPair).not.toHaveBeenCalled();
  });

  it('never asks Medal without the bind cookie — the pair is null, the answer «invalid»', async () => {
    // `readVippsLinkPair` is null whenever the binding is missing or malformed
    // (`vipps-link.test.ts`); this is what the route does with that.
    link.readVippsLinkPair.mockResolvedValue(null);

    const response = await POST(post({ code: '492155' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyVippsLink).not.toHaveBeenCalled();
    expect(session.writePortalSession).not.toHaveBeenCalled();
  });

  it('is «wrong or expired» without a link cookie, without asking Medal', async () => {
    link.readVippsLinkPair.mockResolvedValue(null);

    const response = await POST(post({ code: '492155' }));

    expect(response.status).toBe(401);
    expect(verifyVippsLink).not.toHaveBeenCalled();
  });

  it('says «conflict» and spends the link when the Vipps account is taken', async () => {
    vi.mocked(verifyVippsLink).mockRejectedValue(new PortalVippsConflictError());

    const response = await POST(post({ code: '492155' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: 'conflict' });
    expect(link.clearVippsLinkPair).toHaveBeenCalledTimes(1);
  });

  it('maps the throttle and an outage', async () => {
    vi.mocked(verifyVippsLink).mockRejectedValueOnce(new PortalThrottledError());
    expect((await POST(post({ code: '492155' }))).status).toBe(429);

    vi.mocked(verifyVippsLink).mockRejectedValueOnce(new Error('down'));
    expect((await POST(post({ code: '492155' }))).status).toBe(503);
  });

  it('refuses another origin, a request that declares none, and a malformed code', async () => {
    expect((await POST(post({ code: '492155' }, { origin: 'https://evil.example' }))).status).toBe(
      403
    );
    expect((await POST(post({ code: '492155' }, {}))).status).toBe(403);
    expect((await POST(post({ code: '4921' }))).status).toBe(400);
    expect((await POST(post('{'))).status).toBe(400);
    expect(verifyVippsLink).not.toHaveBeenCalled();
  });
});
