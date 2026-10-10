/**
 * `parseRange`: visitor-controlled from_ts/to_ts, with a DST-aware clamp so a
 * legal 62-calendar-day window never 400s across a fall-back.
 */

import { describe, expect, it } from 'vitest';
import { createClock } from '../../../src/core/clock';
import {
  MAX_RANGE_MS,
  MAX_RANGE_OVERSHOOT_MS,
  WINDOW_MAX_RANGE_DAYS,
} from '../../../src/core/range-bounds';
import { parseRange } from '../../../src/next/routes/shared';
import { PARITY_CONFIG } from '../../support/parity-config';

const DAY_MS = 24 * 60 * 60 * 1000;

function params(fromTs: number, toTs: number): URLSearchParams {
  return new URLSearchParams({ from_ts: String(fromTs), to_ts: String(toTs) });
}

describe('parseRange', () => {
  const oslo = createClock(PARITY_CONFIG);
  const ny = createClock({ ...PARITY_CONFIG, timeZone: 'America/New_York' });

  it('accepts the exact 62 × 24h bound without clamping', async () => {
    const fromTs = 0;
    const toTs = fromTs + MAX_RANGE_MS;
    const parsed = parseRange(params(fromTs, toTs));
    expect(parsed).toEqual({ fromTs, toTs });
  });

  it('clamps a Europe/Oslo fall-back overshoot instead of 400ing', async () => {
    // Early morning: the gained hour is not eaten by the time-of-day offset.
    const fromTs = Date.parse('2026-09-10T00:30:00+02:00');
    // Unclamped calendar end — what a pre-fix client would send.
    const toTs = oslo.dayStart(fromTs, WINDOW_MAX_RANGE_DAYS);
    expect(toTs - fromTs).toBeGreaterThan(MAX_RANGE_MS);
    expect(toTs - fromTs).toBeLessThanOrEqual(MAX_RANGE_MS + MAX_RANGE_OVERSHOOT_MS);

    const parsed = parseRange(params(fromTs, toTs));
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.fromTs).toBe(fromTs);
    expect(parsed.toTs).toBe(fromTs + MAX_RANGE_MS);
  });

  it('clamps an America/New_York fall-back overshoot the same way', async () => {
    const fromTs = Date.parse('2026-09-10T00:30:00-04:00');
    const toTs = ny.dayStart(fromTs, WINDOW_MAX_RANGE_DAYS);
    expect(toTs - fromTs).toBeGreaterThan(MAX_RANGE_MS);

    const parsed = parseRange(params(fromTs, toTs));
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.toTs).toBe(fromTs + MAX_RANGE_MS);
  });

  it('accepts a Europe/Oslo spring-forward window unchanged', async () => {
    const fromTs = Date.parse('2026-02-20T00:30:00+01:00');
    const toTs = oslo.dayStart(fromTs, WINDOW_MAX_RANGE_DAYS);
    expect(toTs - fromTs).toBeLessThan(MAX_RANGE_MS);

    const parsed = parseRange(params(fromTs, toTs));
    expect(parsed).toEqual({ fromTs, toTs });
  });

  it('still refuses a genuinely oversized range', async () => {
    const fromTs = 0;
    const toTs = 63 * DAY_MS;
    expect(toTs - fromTs).toBeGreaterThan(MAX_RANGE_MS + MAX_RANGE_OVERSHOOT_MS);

    const parsed = parseRange(params(fromTs, toTs));
    expect('error' in parsed).toBe(true);
    if (!('error' in parsed)) return;
    expect(parsed.error.status).toBe(400);
    expect(await parsed.error.json()).toMatchObject({
      error: 'invalidInput',
      message: expect.stringContaining('62'),
    });
  });

  it('still refuses a range past the one-hour DST overshoot', async () => {
    const fromTs = 0;
    const toTs = fromTs + MAX_RANGE_MS + MAX_RANGE_OVERSHOOT_MS + 1;
    const parsed = parseRange(params(fromTs, toTs));
    expect('error' in parsed).toBe(true);
    if (!('error' in parsed)) return;
    expect(parsed.error.status).toBe(400);
  });

  it('still refuses inverted and unreadable bounds', async () => {
    const inverted = parseRange(params(DAY_MS, 0));
    expect('error' in inverted).toBe(true);

    const bad = parseRange(new URLSearchParams({ from_ts: 'yesterday', to_ts: 'today' }));
    expect('error' in bad).toBe(true);
  });
});
