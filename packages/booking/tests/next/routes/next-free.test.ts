import { beforeEach, describe, expect, it, vi } from 'vitest';
import { earliestOpening } from '../../../src/core/next-available';
import { nextFreeRoute } from '../../../src/next/routes/catalogue-routes';
import { testRuntime } from '../../support/next-runtime';

const loadBookingSeed = vi.fn();
const rt = testRuntime({ seed: { loadBookingSeed } as never });

const GET = () => nextFreeRoute(rt);

const slot = (startTs: number) => ({ startTs, resourceId: 'r1' });

describe('earliestOpening', () => {
  it('finds the first future start across every service', () => {
    const now = 1_000;
    expect(
      earliestOpening({ a: [slot(500), slot(9_000)], b: [slot(4_000), slot(7_000)] }, now)
    ).toBe(4_000);
  });

  it('is null when nothing is free', () => {
    expect(earliestOpening({ a: [] }, 0)).toBeNull();
    expect(earliestOpening({ a: [slot(10)] }, 20)).toBeNull();
  });
});

describe('GET /api/booking/next-free', () => {
  beforeEach(() => {
    loadBookingSeed.mockReset();
  });

  it('answers the next free start with a label in the salon clock', async () => {
    const future = Date.now() + 60 * 60 * 1000;
    loadBookingSeed.mockResolvedValue({ slots: { gutt: [slot(future)] } });
    const response = await GET();
    const body = await response.json();
    expect(body.startTs).toBe(future);
    expect(body.label).toMatch(/\d{2}:\d{2}$/);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
  });

  it('says nothing when the seed cannot be read', async () => {
    loadBookingSeed.mockRejectedValue(new Error('medal down'));
    const response = await GET();
    expect(await response.json()).toEqual({ startTs: null, label: null });
  });
});
