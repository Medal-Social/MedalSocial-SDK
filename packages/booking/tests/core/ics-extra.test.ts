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

/**
 * Pre-release review: no free-text field can start a property of its own.
 * Every line break is escaped in all three spellings (a lone CR is a line end
 * to more than one parser), the RFC 5545 separators are escaped, and the other
 * control characters TEXT does not admit are dropped.
 */
describe('buildIcs — free text', () => {
  const build = (text: string) =>
    createIcs(PARITY_CONFIG).buildIcs({
      uid: 'bk-1',
      startTs: 0,
      endTs: 1,
      summary: text,
      description: text,
      location: text,
      stampTs: 0,
    });
  const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

  it.each([
    ['a lone CR', 'Notat\rATTENDEE:mailto:x@example.com'],
    ['a lone LF', 'Notat\nATTENDEE:mailto:x@example.com'],
    ['a CRLF', 'Notat\r\nATTENDEE:mailto:x@example.com'],
  ])('escapes %s, so it cannot start a property', (_label, text) => {
    const ics = build(text);
    const lines = unfold(ics);

    expect(lines).toContain('SUMMARY:Notat\\nATTENDEE:mailto:x@example.com');
    expect(lines).toContain('DESCRIPTION:Notat\\nATTENDEE:mailto:x@example.com');
    expect(lines).toContain('LOCATION:Notat\\nATTENDEE:mailto:x@example.com');
    expect(lines.some((line) => line.startsWith('ATTENDEE'))).toBe(false);
    // No bare CR or LF anywhere: every line ends in CRLF.
    expect(ics).not.toMatch(/\r(?!\n)|(?<!\r)\n/);
  });

  it('escapes the backslash first, then the separators, and keeps a tab', () => {
    expect(unfold(build('a\\b;c,d\te'))).toContain('SUMMARY:a\\\\b\\;c\\,d\te');
  });

  it('drops the control characters TEXT does not admit, in text and in the UID', () => {
    const ics = createIcs(PARITY_CONFIG).buildIcs({
      uid: 'bk\u0000-1\u000b\t',
      startTs: 0,
      endTs: 1,
      summary: 'Gutte\u0007klipp\u001b\u007f',
      stampTs: 0,
    });
    expect(unfold(ics)).toContain('UID:bk-1');
    expect(unfold(ics)).toContain('SUMMARY:Gutteklipp');
  });
});
