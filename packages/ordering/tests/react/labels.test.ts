import { describe, expect, it } from 'vitest';
import * as entry from '../../src/react';
import { fill, mergeLabels, ORDERING_LABELS } from '../../src/react/labels';

describe('the label packs', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(ORDERING_LABELS.en).sort()).toEqual(Object.keys(ORDERING_LABELS.nb).sort());
  });

  it('picks Norwegian for nb, no and nn, English for the rest, and lays a site’s words over it', () => {
    expect(mergeLabels('nn-NO').close).toBe('Lukk');
    expect(mergeLabels('ar').close).toBe('Close');
    expect(mergeLabels('nb', { close: 'Steng' })).toEqual({
      ...ORDERING_LABELS.nb,
      close: 'Steng',
    });
  });

  it('fills placeholders and leaves unknown ones as they are', () => {
    expect(fill('Velg {min} til {max} {x}', { min: 1, max: 2 })).toBe('Velg 1 til 2 {x}');
  });

  it('is what the /react entry exports', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'ClosedNotice',
      'ItemSheet',
      'MenuList',
      'ORDERING_LABELS',
      'mergeLabels',
    ]);
  });
});
