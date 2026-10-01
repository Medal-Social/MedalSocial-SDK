import { describe, expect, it } from 'vitest';
import { createIcs, icsDataUrl } from '../../src/core/ics';
import { PARITY_CONFIG } from '../support/parity-config';

describe('icsDataUrl', () => {
  it('declares UTF-8 and percent-encodes the bytes', () => {
    expect(icsDataUrl('SUMMARY:Fødselsdagsklipp\r\n')).toBe(
      'data:text/calendar;charset=utf-8,SUMMARY%3AF%C3%B8dselsdagsklipp%0D%0A'
    );
    expect(createIcs(PARITY_CONFIG).icsDataUrl).toBe(icsDataUrl);
  });
});

describe('buildIcs — the UID line', () => {
  it('cannot be split into a second property by a line break in the id', () => {
    const ics = createIcs(PARITY_CONFIG).buildIcs({
      uid: 'bk-1\r\nATTENDEE:mailto:x@example.com',
      startTs: 0,
      endTs: 1,
      summary: 'Gutteklipp',
      stampTs: 0,
    });
    expect(ics).toContain('UID:bk-1ATTENDEE:mailto:x@example.com\r\n');
    expect(ics.split('\r\n').some((line) => line.startsWith('ATTENDEE'))).toBe(false);
  });
});
