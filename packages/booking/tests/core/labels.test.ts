import { describe, expect, it } from 'vitest';
import { fill, LABEL_PACKS, labelPackFor, resolveLabels } from '../../src/core/labels';

describe('labels', () => {
  it('reads Norwegian in all three spellings, and English for anything else', () => {
    expect(labelPackFor('nb-NO')).toBe('nb');
    expect(labelPackFor('no')).toBe('nb');
    expect(labelPackFor('nn-NO')).toBe('nb');
    expect(labelPackFor('en-GB')).toBe('en');
    expect(labelPackFor('sv-SE')).toBe('en');
  });

  it('puts the site’s words over the pack, and ignores anything that is not a string', () => {
    const labels = resolveLabels('nb-NO', {
      'people.self': 'Meg',
      'people.adult': undefined,
    });
    expect(labels['people.self']).toBe('Meg');
    expect(labels['people.adult']).toBe(LABEL_PACKS.nb['people.adult']);
    expect(resolveLabels('en-GB', null)).toEqual(LABEL_PACKS.en);
  });

  it('gives both packs the same keys for the core', () => {
    const core = (pack: object) => Object.keys(pack).filter((key) => !key.startsWith('daypart.'));
    expect(core(LABEL_PACKS.en).sort()).toEqual(core(LABEL_PACKS.nb).sort());
  });

  it('fills named holes and leaves an unknown one as written', () => {
    expect(fill('{count} barn', { count: 2 })).toBe('2 barn');
    expect(fill('{min}–{max} år', { min: 7, max: 8 })).toBe('7–8 år');
    expect(fill('{nope} {count}', { count: 1 })).toBe('{nope} 1');
  });
});
