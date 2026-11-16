import { describe, expect, it } from 'vitest';
import { adSourceOf } from '../../src/core/ad-source';

describe('adSourceOf', () => {
  it('keeps the network, with the campaign when it has one', () => {
    expect(adSourceOf({ network: 'meta', campaign: 'ck-host_2026.a' })).toEqual({
      network: 'meta',
      campaign: 'ck-host_2026.a',
    });
    expect(adSourceOf({ network: 'google' })).toEqual({ network: 'google' });
  });

  it('keeps the network and leaves out a campaign Medal Social would not take', () => {
    for (const campaign of ['Kari Nordmann', '', '-leading', 'a'.repeat(101), 7, null]) {
      expect(adSourceOf({ network: 'google', campaign })).toEqual({ network: 'google' });
    }
    expect(adSourceOf({ network: 'google', campaign: 'a'.repeat(100) })).toEqual({
      network: 'google',
      campaign: 'a'.repeat(100),
    });
  });

  it('leaves out every other key', () => {
    expect(adSourceOf({ network: 'meta', gclid: 'x', utm_term: 'frisor' })).toEqual({
      network: 'meta',
    });
  });

  it('is no source for a network it does not count, or anything that is not an object', () => {
    for (const value of [
      { network: 'tiktok' },
      { campaign: 'ck-a' },
      {},
      null,
      undefined,
      'meta',
    ]) {
      expect(adSourceOf(value)).toBeNull();
    }
  });
});
