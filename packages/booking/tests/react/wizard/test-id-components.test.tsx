/**
 * Pure helpers behind the wizard `data-testid` wrappers — the object-ref and
 * non-HTMLElement paths the full wizard never exercises alone.
 */

import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  assignRef,
  stampAttrs,
  withDayTestId,
  withServiceOptionTestId,
  withSlotTestId,
  withStylistOptionTestId,
} from '../../../src/react/wizard/test-id-components';
import { BOOKING_TEST_IDS } from '../../../src/react/wizard/test-ids';

describe('testid helper primitives', () => {
  it('assignRef supports function refs, object refs, and a missing ref', () => {
    const fn = vi.fn();
    assignRef(fn, null);
    expect(fn).toHaveBeenCalledWith(null);

    const objectRef = createRef<HTMLElement>();
    const node = document.createElement('button');
    assignRef(objectRef, node);
    expect(objectRef.current).toBe(node);

    assignRef(undefined, node);
    const cleanup = vi.fn();
    expect(assignRef(() => cleanup, node)).toBe(cleanup);
  });

  it('stampAttrs writes only onto HTMLElements', () => {
    const el = document.createElement('button');
    stampAttrs(el, { 'data-testid': BOOKING_TEST_IDS.stylistOption });
    expect(el.getAttribute('data-testid')).toBe(BOOKING_TEST_IDS.stylistOption);

    stampAttrs(null, { 'data-testid': 'x' });
    // SVGElement is an Element but not an HTMLElement — the early return.
    stampAttrs(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), {
      'data-testid': 'x',
    });
  });

  it('returns the same wrapper identity for the same inner (cache hit)', () => {
    expect(withServiceOptionTestId()).toBe(withServiceOptionTestId());
    expect(withStylistOptionTestId()).toBe(withStylistOptionTestId());
    expect(withDayTestId()).toBe(withDayTestId());
    expect(withSlotTestId()).toBe(withSlotTestId());
  });
});
