import { MedalApiError } from '@medalsocial/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MedalConfigError } from '../../../src/next/medal';
import { calendarRoute } from '../../../src/next/routes/calendar';
import { testRuntime } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * `GET <api>/calendar/<tokens>`: a calendar file a phone opens in place,
 * every word and time in it the server's own — Medal's booking, the site's
 * labels and address. Only the tokens come from the URL.
 */

/** Manage tokens are HMAC-SHA256 in base64url: 43 characters. */
const tok = (seed: string) => seed.padEnd(43, 'x');
const A = tok('aaaa');
const B = tok('bbbb');

function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    booking_id: id,
    status: 'confirmed',
    rescheduled_from_id: null,
    start_ts: '2026-10-20T11:00:00.000Z',
    end_ts: '2026-10-20T11:30:00.000Z',
    service_id: 'svc-1',
    service_name: 'Barneklipp',
    resource_id: 'res-1',
    resource_name: 'Ada',
    booked_for_name: null,
    party_sequence_id: null,
    amount_ore: 49_000,
    cancel_window_hours: 24,
    reschedule_window_hours: 24,
    can_cancel: true,
    can_reschedule: true,
    ...overrides,
  };
}

function route(
  getManage: (token: string) => Promise<unknown>,
  options: Parameters<typeof testRuntime>[1] = {}
) {
  const medal = { getManage: vi.fn(getManage) };
  const rt = testRuntime({ medal: medal as never }, options);
  const call = (segment: string, query = '') =>
    calendarRoute(
      rt,
      new Request(`https://salong.example/api/booking/calendar/x${query}`),
      segment
    );
  return { call, medal };
}

/** The file's lines, unfolded (RFC 5545 folds a long line with CRLF + space). */
const lines = (body: string) => body.replace(/\r\n /g, '').split('\r\n');

afterEach(() => {
  vi.useRealTimers();
});

describe('calendarRoute', () => {
  it('serves one event per booking, in place, never stored', async () => {
    const { call } = route(async (token) =>
      summary(`bk-${token.slice(0, 4)}`, token === B ? { booked_for_name: 'Emma' } : {})
    );
    const response = await call(`${A},${B}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    const body = lines(await response.text());
    expect(body.filter((line) => line.startsWith('UID:'))).toEqual(['UID:bk-aaaa', 'UID:bk-bbbb']);
    // The site's own words: its labels, its name, its address.
    expect(body).toContain('SUMMARY:Barneklipp hos Salong Demo');
    expect(body).toContain('SUMMARY:Barneklipp for Emma hos Salong Demo');
    expect(body.some((line) => line.startsWith('LOCATION:Torget 1'))).toBe(true);
    expect(body.some((line) => line.includes(`/bestill/administrer/${A}`))).toBe(true);
    expect(body).toContain('DTSTART:20261020T110000Z');
  });

  it('puts the site’s word in place of a service that has left the catalogue', async () => {
    for (const name of [null, 'Unknown service']) {
      const { call } = route(async () => summary('bk-1', { service_name: name }));
      const body = lines(await (await call(A)).text());
      expect(body).toContain('SUMMARY:Time hos Salong Demo');
    }
  });

  it('writes no DTEND for a booking Medal gave no end, so no calendar refuses it', async () => {
    const { call } = route(async () => summary('bk-1', { end_ts: null }));
    const body = lines(await (await call(A)).text());
    expect(body).toContain('DTSTART:20261020T110000Z');
    expect(body.some((line) => line.startsWith('DTEND'))).toBe(false);
  });

  it('takes nothing from the query string but ignores it', async () => {
    const { call } = route(async () => summary('bk-1'));
    const body = lines(await (await call(A, '?s=Ring+oss&l=Et+annet+sted&d=evil')).text());
    expect(body.some((line) => /Ring oss|Et annet sted|evil/.test(line))).toBe(false);
  });

  it('refuses a token that is not a manage token, before asking Medal', async () => {
    const { call, medal } = route(async () => summary('bk-1'));
    for (const segment of ['', 'short', `${A},bad token`, `${A},`, 'a'.repeat(129)]) {
      expect((await call(segment)).status).toBe(404);
    }
    expect(medal.getManage).not.toHaveBeenCalled();
  });

  it('refuses more tokens than a booking can seat', async () => {
    const { call, medal } = route(async () => summary('bk-1'));
    const many = Array.from({ length: PARITY_CONFIG.party.maxPeople + 1 }, (_, n) => tok(`t${n}`));
    expect((await call(many.join(','))).status).toBe(404);
    expect(medal.getManage).not.toHaveBeenCalled();
  });

  it('counts each token past the first against the rate limiter', async () => {
    const rateLimit = vi.fn(async () => false);
    const { call } = route(async () => summary('bk-1'), { rateLimit });
    await call(`${A},${B}`);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(rateLimit).toHaveBeenCalledWith('booking/calendar', expect.any(Request));

    const limited = route(async () => summary('bk-1'), { rateLimit: vi.fn(async () => true) });
    const response = await limited.call(`${A},${B}`);
    expect(response.status).toBe(429);
    expect(limited.medal.getManage).not.toHaveBeenCalled();
  });

  it('leaves out a revoked or cancelled booking, and 404s when none is left', async () => {
    const { call } = route(async (token) => {
      if (token === A) throw new MedalApiError(404, 'NOT_FOUND', 'gone');
      if (token === B) return summary('bk-x', { start_ts: null });
      return summary('bk-c', { status: 'cancelled' });
    });
    const response = await call(`${A},${B},${tok('cccc')}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives up after one deadline for the whole file', async () => {
    vi.useFakeTimers();
    const { call } = route(() => new Promise(() => {}));
    const pending = call(`${A},${B}`);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(504);
  });

  it('answers a Medal failure the way the catalogue routes do', async () => {
    expect((await route(() => Promise.reject(new MedalConfigError('no key'))).call(A)).status).toBe(
      503
    );
    expect((await route(() => Promise.reject(new Error('down'))).call(A)).status).toBe(502);
  });

  it('places nothing without an address, and links from the request’s origin without a base URL', async () => {
    const config = { ...PARITY_CONFIG, contact: { ...PARITY_CONFIG.contact, address: null } };
    const { call } = route(async () => summary('bk-1'), { config, baseUrl: undefined });
    const body = lines(await (await call(A)).text());
    expect(body.some((line) => line.startsWith('LOCATION'))).toBe(false);
  });
});
