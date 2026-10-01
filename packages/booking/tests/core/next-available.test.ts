import { describe, expect, it } from 'vitest';
import { earliestOpening, firstOpeningPerResource } from '../../src/core/next-available';

describe('firstOpeningPerResource', () => {
  it('is each stylist’s earliest start, and nobody’s for a stylist-less slot', () => {
    expect(
      firstOpeningPerResource([
        { startTs: 30, resourceId: 'res-a' },
        { startTs: 10, resourceId: 'res-a' },
        { startTs: 20, resourceId: 'res-b' },
        { startTs: 5, resourceId: null },
        { startTs: 40, resourceId: 'res-b' },
      ])
    ).toEqual({ 'res-a': 10, 'res-b': 20 });
  });
});

describe('earliestOpening', () => {
  it('is the next start across every service, skipping what has begun', () => {
    expect(
      earliestOpening(
        {
          a: [
            { startTs: 100, resourceId: 'r' },
            { startTs: 300, resourceId: 'r' },
          ],
          b: [
            { startTs: 200, resourceId: null },
            { startTs: 250, resourceId: 'r' },
          ],
        },
        150
      )
    ).toBe(200);
  });

  it('is null when nothing in the window is free', () => {
    expect(earliestOpening({ a: [{ startTs: 100, resourceId: 'r' }] }, 100)).toBeNull();
    expect(earliestOpening({}, 0)).toBeNull();
  });
});
