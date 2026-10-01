import { afterEach, describe, expect, it, vi } from 'vitest';
import { leavePortal as leaveMinSide } from '../../../src/react/portal/leave';

describe('leaveMinSide', () => {
  const original = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  function stubLocation() {
    const location = { assign: vi.fn(), replace: vi.fn() };
    Object.defineProperty(window, 'location', { configurable: true, value: location });
    return location;
  }

  it('assigns by default — one document load, Back still works', () => {
    const location = stubLocation();
    leaveMinSide('/');
    expect(location.assign).toHaveBeenCalledWith('/');
    expect(location.replace).not.toHaveBeenCalled();
  });

  it('replaces when asked — the page being left must not be one Back away', () => {
    const location = stubLocation();
    leaveMinSide('/min-side/slettet', { replace: true });
    expect(location.replace).toHaveBeenCalledWith('/min-side/slettet');
    expect(location.assign).not.toHaveBeenCalled();
  });
});
