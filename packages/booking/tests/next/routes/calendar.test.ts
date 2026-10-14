import { MedalApiError } from '@medalsocial/sdk';
import { describe, expect, it, vi } from 'vitest';
import { MedalConfigError } from '../../../src/next/medal';
import { calendarRoute } from '../../../src/next/routes/calendar';
import { testRuntime } from '../../support/next-runtime';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * `GET <api>/calendar/<tokens>`: a calendar file a phone opens in place, its
 * events read from Medal by manage token, only the wording from the URL.
 */

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

function route(getManage: (token: string) => Promise<unknown>, config = PARITY_CONFIG) {
  const rt = testRuntime({ medal: { getManage: vi.fn(getManage) } as never }, { config });
  return (segment: string, query = '') =>
    calendarRoute(
      rt,
      new Request(`https://salong.example/api/booking/calendar/x${query}`),
      segment
    );
}

const lines = (body: string) => body.split('\r\n');

describe('calendarRoute', () => {
  it('serves one event per token, in place, never stored', async () => {
    const call = route(async (token) => summary(`bk-${token}`));
    const response = await call('a,b', '?s=Barneklipp+for+Jonas&d=&s=Barneklipp+for+Emma&d=Notat');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    const body = lines(await response.text());
    expect(body.filter((line) => line.startsWith('UID:'))).toEqual(['UID:bk-a', 'UID:bk-b']);
    expect(body).toContain('SUMMARY:Barneklipp for Jonas');
    expect(body).toContain('SUMMARY:Barneklipp for Emma');
    expect(body).toContain('DESCRIPTION:Notat');
    // The place falls back to the site's own address.
    expect(body.some((line) => line.startsWith('LOCATION:Torget 1'))).toBe(true);
  });

  it('takes the time from Medal, not from the URL, and the place from the hint', async () => {
    const call = route(async () => summary('bk-1'));
    const body = lines(await (await call('a', '?s=Klipp&l=Schous+plass+6')).text());
    expect(body).toContain('DTSTART:20261020T110000Z');
    expect(body).toContain('LOCATION:Schous plass 6');
  });

  it('names the event after the service and the business without a hint', async () => {
    const call = route(async () => summary('bk-1'));
    const body = lines(await (await call('a')).text());
    expect(body).toContain('SUMMARY:Barneklipp – Salong Demo');
    expect(body.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
  });

  it('leaves out a revoked or cancelled booking, and 404s when none is left', async () => {
    const call = route(async (token) => {
      if (token === 'gone') throw new MedalApiError(404, 'NOT_FOUND', 'gone');
      if (token === 'null') return summary('bk-x', { start_ts: null });
      return summary('bk-c', { status: 'cancelled' });
    });
    const response = await call('gone,null,cancelled');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toMatch(/json/);
  });

  it('404s for no token or more than a booking can hold', async () => {
    const call = route(async () => summary('bk-1'));
    expect((await call('')).status).toBe(404);
    expect((await call(Array.from({ length: 21 }, (_, n) => `t${n}`).join(','))).status).toBe(404);
  });

  it('answers a Medal failure the way the catalogue routes do', async () => {
    expect(
      (await route(async () => Promise.reject(new MedalConfigError('no key')))('a')).status
    ).toBe(503);
    expect((await route(async () => Promise.reject(new Error('down')))('a')).status).toBe(502);
  });

  it('places nothing without a hint or an address', async () => {
    const config = { ...PARITY_CONFIG, contact: { ...PARITY_CONFIG.contact, address: null } };
    const call = route(async () => summary('bk-1'), config);
    const body = lines(await (await call('a')).text());
    expect(body.some((line) => line.startsWith('LOCATION'))).toBe(false);
  });
});
