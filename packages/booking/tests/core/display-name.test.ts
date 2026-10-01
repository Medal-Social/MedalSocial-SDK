import { describe, expect, it } from 'vitest';
import { initialsOf, stylistDisplayName } from '../../src/core/display-name';

/**
 * Medal's resource names are admin labels — «siv», «Bjarne (Salong Demo)» — and
 * step 2 used to print them as they came, with «B(» in the initials circle.
 */
describe('stylistDisplayName', () => {
  it.each([
    ['siv', 'Siv'],
    ['Bjarne (Salong Demo)', 'Bjarne'],
    ['  solveig (Salong Demo) ', 'Solveig'],
    ['Sara', 'Sara'],
    ['øystein', 'Øystein'],
    ['Anne Lise (salong 2)', 'Anne Lise'],
    ['Bjarne (Salong Demo) (vikar)', 'Bjarne'],
  ])('%j → %j', (raw, expected) => {
    expect(stylistDisplayName(raw)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const raw of [
      'Bjarne (Salong Demo) (vikar)',
      '  solveig (Salong Demo) ',
      '(Salong Demo)',
      'siv',
    ]) {
      const once = stylistDisplayName(raw);
      expect(stylistDisplayName(once)).toBe(once);
    }
  });

  it('only strips a TRAILING suffix', () => {
    expect(stylistDisplayName('Sara (senior) Lund')).toBe('Sara (senior) Lund');
  });

  it('keeps a name that is nothing but a suffix rather than blanking it', () => {
    expect(stylistDisplayName('(Salong Demo)')).toBe('(Salong Demo)');
  });

  it('answers an empty name with an empty one', () => {
    expect(stylistDisplayName('')).toBe('');
    expect(stylistDisplayName('   ')).toBe('');
  });
});

describe('initialsOf', () => {
  it.each([
    ['Bjarne (Salong Demo)', 'B'],
    ['Solveig Lund', 'SL'],
    ['solveig lund (Salong Demo)', 'SL'],
    ['siv', 'S'],
    ['Åse Ødegård', 'ÅØ'],
    ['Anne Lise Berg', 'AL'],
    ['"Kim" 2', 'K'],
  ])('%j → %j', (raw, expected) => {
    expect(initialsOf(raw)).toBe(expected);
  });

  it('is empty when there are no letters to take', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('(1)')).toBe('');
  });
});
