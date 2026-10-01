import { describe, expect, it } from 'vitest';
import { mergeLabels } from '../../../src/react/labels';
import { partySizeWord } from '../../../src/react/wizard/adapters';

describe('partySizeWord', () => {
  it('spells two, three and more from the pack', () => {
    const labels = mergeLabels('nb');
    expect(partySizeWord(labels, 2)).toBe('to');
    expect(partySizeWord(labels, 3)).toBe('tre');
    expect(partySizeWord(labels, 4)).toBe('flere');
    expect(partySizeWord(mergeLabels('en'), 2)).toBe('two');
  });

  it('leaves the number to meda where the pack is blank, in either form', () => {
    const labels = mergeLabels('nb', {
      'wizard.party.sizeWord.two': '',
      'wizard.party.sizeWord.three': [],
      'wizard.party.sizeWord.other': ['fl', 'ere'],
    });
    expect(partySizeWord(labels, 2)).toBeUndefined();
    expect(partySizeWord(labels, 3)).toBeUndefined();
    expect(partySizeWord(labels, 5)).toBe('flere');
  });
});
