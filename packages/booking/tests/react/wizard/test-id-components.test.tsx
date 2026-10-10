/**
 * Wrapper helpers that stamp `data-testid`s — pure helpers plus the cache and
 * object-ref path the full wizard never exercises alone.
 */

import { DefaultStylistCard } from '@medalsocial/meda/booking';
import { render, screen } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
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
  });

  it('stampAttrs writes only onto HTMLElements', () => {
    const el = document.createElement('button');
    stampAttrs(el, { 'data-testid': BOOKING_TEST_IDS.stylistOption });
    expect(el.getAttribute('data-testid')).toBe(BOOKING_TEST_IDS.stylistOption);

    stampAttrs(null, { 'data-testid': 'x' });
    stampAttrs(document.createDocumentFragment().appendChild(document.createTextNode('t')), {
      'data-testid': 'x',
    });
  });
});

describe('testid card wrappers', () => {
  it('forwards an object ref on the stylist radio and stamps the test id there', () => {
    const Stylist = withStylistOptionTestId(DefaultStylistCard);
    const radioRef = createRef<HTMLButtonElement>();
    render(
      <Stylist
        option={{ kind: 'resource', resourceId: 'res-1', label: 'Sara' }}
        selected={false}
        onClick={() => {}}
        ref={radioRef as RefObject<HTMLButtonElement>}
      />
    );
    const option = screen.getByTestId(BOOKING_TEST_IDS.stylistOption);
    expect(option).toHaveAttribute('data-resource-id', 'res-1');
    expect(radioRef.current).toBe(option);
  });

  it('stamps data-resource-id=first when the option has no resource id', () => {
    const Stylist = withStylistOptionTestId(DefaultStylistCard);
    render(
      <Stylist
        option={{ kind: 'firstAvailable', label: 'Første ledige' }}
        selected={false}
        onClick={() => {}}
      />
    );
    expect(screen.getByTestId(BOOKING_TEST_IDS.stylistOption)).toHaveAttribute(
      'data-resource-id',
      'first'
    );
  });

  it('returns the same wrapper identity for the same inner (cache hit)', () => {
    expect(withServiceOptionTestId()).toBe(withServiceOptionTestId());
    expect(withStylistOptionTestId()).toBe(withStylistOptionTestId());
    expect(withDayTestId()).toBe(withDayTestId());
    expect(withSlotTestId()).toBe(withSlotTestId());
  });
});
