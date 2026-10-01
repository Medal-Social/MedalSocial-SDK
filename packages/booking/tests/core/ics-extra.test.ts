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
