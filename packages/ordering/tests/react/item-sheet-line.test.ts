import { describe, expectTypeOf, it } from 'vitest';
import type { NewDraftLine } from '../../src/core';
import type { ItemSheetLine } from '../../src/react';

describe('ItemSheetLine', () => {
  it('is the draft store line, so the two shapes cannot drift', () => {
    expectTypeOf<ItemSheetLine>().toEqualTypeOf<NewDraftLine>();
  });
});
