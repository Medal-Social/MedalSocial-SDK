import { describe, expect, it } from 'vitest';
import {
  fill,
  fillParts,
  isBookingLabel,
  LABEL_PACKS,
  labelPackFor,
  labelText,
  resolveLabels,
} from '../../src/core/labels';

describe('labels', () => {
  it('reads Norwegian in all three spellings, and English for anything else', () => {
    expect(labelPackFor('nb-NO')).toBe('nb');
    expect(labelPackFor('no')).toBe('nb');
    expect(labelPackFor('nn-NO')).toBe('nb');
    expect(labelPackFor('en-GB')).toBe('en');
    expect(labelPackFor('sv-SE')).toBe('en');
  });

  it('puts the site’s words over the pack, and ignores anything that is not a label', () => {
    const labels = resolveLabels('nb-NO', {
      'people.self': 'Meg',
      'people.adult': undefined,
      'people.children': ['{count}', ' barn'],
      'summary.services': [1, 2] as unknown as string[],
    });
    expect(labels['people.self']).toBe('Meg');
    expect(labels['people.children']).toEqual(['{count}', ' barn']);
    expect(labels['summary.services']).toBe(LABEL_PACKS.nb['summary.services']);
    expect(labels['people.adult']).toBe(LABEL_PACKS.nb['people.adult']);
    expect(resolveLabels('en-GB', null)).toEqual(LABEL_PACKS.en);
  });

  it('gives both packs the same keys for the core', () => {
    const core = (pack: object) => Object.keys(pack).filter((key) => !key.startsWith('daypart.'));
    // Every Norwegian default day part has English words as well.
    const parts = (pack: object) => Object.keys(pack).filter((key) => key.startsWith('daypart.'));
    expect(parts(LABEL_PACKS.en)).toEqual(expect.arrayContaining(parts(LABEL_PACKS.nb)));
    expect(core(LABEL_PACKS.en).sort()).toEqual(core(LABEL_PACKS.nb).sort());
  });

  it('fills named holes and leaves an unknown one as written', () => {
    expect(fill('{count} barn', { count: 2 })).toBe('2 barn');
    expect(fill('{min}–{max} år', { min: 7, max: 8 })).toBe('7–8 år');
    expect(fill('{nope} {count}', { count: 1 })).toBe('{nope} 1');
  });

  it('fills an array element by element and joins it, as text', () => {
    expect(fill(['Steg ', '{step}', ' av {total}'], { step: 3, total: 4 })).toBe('Steg 3 av 4');
    expect(labelText(['Steg ', '{step}'])).toBe('Steg {step}');
    expect(labelText('Steg')).toBe('Steg');
  });

  it('keeps a filled string in ONE piece, like a template literal', () => {
    expect(
      fillParts('Steg {step} av {total} · {label}', { step: 3, total: 4, label: 'Tid' })
    ).toEqual(['Steg 3 av 4 · Tid']);
    expect(fillParts('{nope} har {count}', { count: 1 })).toEqual(['{nope} har 1']);
    expect(fillParts('{name}', { name: '' })).toEqual([]);
    expect(fillParts('', {})).toEqual([]);
  });

  it('keeps a filled array in one piece per element', () => {
    expect(
      fillParts(['Steg ', '{step}', ' av ', '{total}', ' · ', '{label}'], {
        step: 3,
        total: 4,
        label: 'Tid',
      })
    ).toEqual(['Steg ', '3', ' av ', '4', ' · ', 'Tid']);
    // An element may hold several holes, text, or both; one that fills to '' is no piece.
    expect(
      fillParts(['{a}{b}', '', ' og {c}', '{empty}'], { a: 'x', b: 'y', c: 'z', empty: '' })
    ).toEqual(['xy', ' og z']);
    expect(fillParts([], {})).toEqual([]);
  });

  it('joins back into exactly what fill gives', () => {
    const templates = ['Steg {step} av {total}', '{nope} {count}', ['{count}', ' barn'], 'plain'];
    for (const template of templates) {
      const values = { step: 2, total: 4, count: 7 };
      expect(fillParts(template, values).join('')).toBe(fill(template, values));
    }
  });

  it('tells a label from anything else', () => {
    expect(isBookingLabel('x')).toBe(true);
    expect(isBookingLabel(['x', ''])).toBe(true);
    expect(isBookingLabel([])).toBe(true);
    expect(isBookingLabel(['x', 1])).toBe(false);
    expect(isBookingLabel(null)).toBe(false);
    expect(isBookingLabel(3)).toBe(false);
  });
});

describe('labels — the default day parts in English', () => {
  it('names the Norwegian default keys in the en pack too', () => {
    expect(LABEL_PACKS.en['daypart.formiddag']).toBe('Morning');
    expect(LABEL_PACKS.en['daypart.ettermiddag']).toBe('Afternoon');
    expect(LABEL_PACKS.en['daypart.kveld']).toBe('Evening');
  });
});
