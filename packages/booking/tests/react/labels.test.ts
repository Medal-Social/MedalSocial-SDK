import { BOOKING_LABEL_KEYS } from '@medalsocial/meda/booking';
import { describe, expect, it } from 'vitest';
import { LABEL_PACKS } from '../../src/core/labels';
import { BOOKING_LABELS, mergeLabels } from '../../src/react/labels';

describe('the built-in label packs', () => {
  it.each(['nb', 'en'] as const)('%s covers every meda screen key and every core key', (pack) => {
    const labels = BOOKING_LABELS[pack] as Record<string, string>;
    for (const key of BOOKING_LABEL_KEYS) expect(typeof labels[key], key).toBe('string');
    for (const key of Object.keys(LABEL_PACKS[pack]))
      expect(typeof labels[key], key).toBe('string');
  });

  it('gives nb and en the same fixed keys (the keyed groups are per config)', () => {
    const fixed = (pack: object) =>
      Object.keys(pack)
        .filter((key) => !key.startsWith('daypart.') && !key.startsWith('category.'))
        .sort();
    expect(fixed(BOOKING_LABELS.en)).toEqual(fixed(BOOKING_LABELS.nb));
  });

  it('merges overrides over the pack for the locale, later layers winning', () => {
    const merged = mergeLabels('nb-NO', { 'wizard.title': 'A' }, null, undefined, {
      'wizard.title': 'B',
      'wizard.retry': 'C',
    });
    expect(merged['wizard.title']).toBe('B');
    expect(merged['wizard.retry']).toBe('C');
    expect(merged['who.heading']).toBe(BOOKING_LABELS.nb['who.heading']);
    expect(mergeLabels('en-GB')['who.heading']).toBe(BOOKING_LABELS.en['who.heading']);
  });

  it('ignores a value that is not a label', () => {
    const merged = mergeLabels('nb', {
      'wizard.title': 3 as unknown as string,
      'wizard.retry': ['Prøv ', 4] as unknown as string[],
    });
    expect(merged['wizard.title']).toBe(BOOKING_LABELS.nb['wizard.title']);
    expect(merged['wizard.retry']).toBe(BOOKING_LABELS.nb['wizard.retry']);
  });

  it('takes a label in either form, string or array of text pieces', () => {
    const merged = mergeLabels('nb', {
      'wizard.progress': 'Steg {step} av {total}',
      'confirmation.party.total': ['Totalt ', '{total}'],
    });
    expect(merged['wizard.progress']).toBe('Steg {step} av {total}');
    expect(merged['confirmation.party.total']).toEqual(['Totalt ', '{total}']);
  });

  it('builds in arrays only where the package itself splits a sentence', () => {
    for (const pack of [BOOKING_LABELS.nb, BOOKING_LABELS.en]) {
      const split = Object.entries(pack)
        .filter(([, value]) => Array.isArray(value))
        .map(([key]) => key)
        .sort();
      expect(split).toEqual(['portal.greeting', 'wizard.progress', 'wizard.slotsUnavailable.call']);
    }
  });
});
