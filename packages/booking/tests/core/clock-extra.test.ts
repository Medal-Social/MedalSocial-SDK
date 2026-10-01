/**
 * The clock functions the parity suite did not reach directly (the manage
 * page's absolute dates), and the factory's own contract.
 */

import { describe, expect, it } from 'vitest';
import { createClock } from '../../src/core/clock';
import { PARITY_CONFIG } from '../support/parity-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

pinAForeignViewerClock();

const clock = createClock(PARITY_CONFIG);
const THURSDAY_15 = Date.parse('2026-10-08T15:00:00+02:00');

describe('createClock', () => {
  it('answers the same clock for the same config object', () => {
    expect(createClock(PARITY_CONFIG)).toBe(clock);
    expect(clock.timeZone).toBe('Europe/Oslo');
    expect(clock.dayparts).toEqual(['formiddag', 'ettermiddag', 'kveld']);
  });

  it('writes the manage page’s absolute date and time', () => {
    expect(clock.date(THURSDAY_15)).toBe('tor. 8. okt.');
    expect(clock.dateTime(THURSDAY_15)).toBe('tor. 8. okt. kl. 15:00');
    expect(clock.weekday(THURSDAY_15)).toBe('torsdag');
  });

  it('labels a day part through the pack, and a part it has no words for by its key', () => {
    expect(clock.daypartLabel('kveld')).toBe('Kveld');
    expect(clock.daypartLabel('natt')).toBe('natt');
  });

  it('files an hour outside a hand-built set of day parts under the last one', () => {
    const partial = createClock({
      timeZone: 'Europe/Oslo',
      locale: 'nb-NO',
      dayparts: [
        { key: 'dag', from: 8, to: 16 },
        { key: 'sein', from: 16, to: 20 },
      ],
    });
    expect(partial.daypartOf(Date.parse('2026-10-08T03:00:00+02:00'))).toBe('sein');
    expect(partial.daypartOf(Date.parse('2026-10-08T09:00:00+02:00'))).toBe('dag');
  });
});
