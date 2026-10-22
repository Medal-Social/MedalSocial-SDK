/**
 * The hours engine reasons in the restaurant's time zone, never the machine's:
 * the whole parity table again with the process clock on UTC+14 (the suite
 * otherwise runs on Europe/Oslo, the zone of most fixtures).
 */
import { describe, expect, it } from 'vitest';
import * as engine from '../../src/core/hours';
import { loadHoursFixture } from '../support/hours-fixture';
import { pinAForeignViewerClock } from '../support/viewer-clock';

pinAForeignViewerClock();

const functions = engine as unknown as Record<string, (...args: unknown[]) => unknown>;

describe('hours engine under a foreign process clock', () => {
  it('runs with the process clock far from Oslo', () => {
    expect(new Date(Date.UTC(2026, 9, 21, 12)).getHours()).toBe(2);
  });

  it('answers every parity case the same', () => {
    for (const c of loadHoursFixture().cases) {
      expect(functions[c.fn](...c.args), `${c.fn}: ${c.name}`).toStrictEqual(c.result);
    }
  });
});
