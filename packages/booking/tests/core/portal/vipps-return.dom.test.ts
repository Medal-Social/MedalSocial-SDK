import { afterEach, describe, expect, it } from 'vitest';
import {
  maskedAddress,
  stripVippsReturn,
  vippsConfirmFrom,
} from '../../../src/core/portal/vipps-return';

describe('maskedAddress', () => {
  it('takes only the masked shape Medal writes', () => {
    expect(maskedAddress('k•••@g•••.com')).toBe('k•••@g•••.com');
    expect(maskedAddress('k•••@g•••.no')).toBe('k•••@g•••.no');
  });

  it('refuses a real address, markup, and anything longer than the mask', () => {
    for (const value of [
      'kari@example.com',
      '<b>k•••@g•••.com</b>',
      'ka•••@g•••.com',
      'k•••@g•••.c',
      'k•••@gmail.com',
      ' k•••@g•••.com',
      '',
      null,
      undefined,
    ]) {
      expect(maskedAddress(value)).toBeNull();
    }
  });
});

describe('vippsConfirmFrom', () => {
  it('reads the marker and the address', () => {
    expect(vippsConfirmFrom(new URLSearchParams('vipps=confirm_email&to=k•••@g•••.com'))).toEqual({
      to: 'k•••@g•••.com',
    });
  });

  it('gives no address when there is none, or it is not the mask', () => {
    expect(vippsConfirmFrom(new URLSearchParams('vipps=confirm_email'))).toEqual({ to: null });
    expect(
      vippsConfirmFrom(new URLSearchParams('vipps=confirm_email&to=kari@example.com'))
    ).toEqual({ to: null });
  });

  it('is nothing for an ordinary visit, another outcome, or a repeated marker', () => {
    expect(vippsConfirmFrom(new URLSearchParams(''))).toBeUndefined();
    expect(vippsConfirmFrom(new URLSearchParams('vipps=failed'))).toBeUndefined();
    expect(
      vippsConfirmFrom(new URLSearchParams('vipps=confirm_email&vipps=confirm_email'))
    ).toBeUndefined();
    expect(vippsConfirmFrom(null)).toBeUndefined();
  });
});

describe('stripVippsReturn', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('takes link, to, grant and the confirm marker out of the address bar, in place', () => {
    window.history.replaceState(
      null,
      '',
      '/bestill?resume=1&kategori=barn&vipps=confirm_email&to=k%E2%80%A2%E2%80%A2%E2%80%A2%40g&link=x&grant=y#top'
    );
    const before = window.history.length;

    stripVippsReturn();

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/bestill?resume=1&kategori=barn#top'
    );
    expect(window.history.length).toBe(before);
  });

  it('leaves another Vipps outcome and an ordinary query alone', () => {
    window.history.replaceState(null, '', '/min-side/logg-inn?vipps=failed');
    stripVippsReturn();
    expect(window.location.search).toBe('?vipps=failed');
  });
});
