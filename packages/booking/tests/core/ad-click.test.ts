import { describe, expect, it } from 'vitest';
import { adClickOf } from '../../src/core/ad-click';

describe('adClickOf', () => {
  it('keeps the three Google click ids', () => {
    expect(adClickOf({ gclid: 'Cj0-abc_1', gbraid: 'gb', wbraid: 'wb' })).toEqual({
      gclid: 'Cj0-abc_1',
      gbraid: 'gb',
      wbraid: 'wb',
    });
  });

  it('leaves out every other key', () => {
    expect(adClickOf({ gclid: 'abc', fbclid: 'meta', utm_source: 'google' })).toEqual({
      gclid: 'abc',
    });
  });

  it('leaves out an id Medal Social would refuse', () => {
    expect(adClickOf({ gclid: 'has space', gbraid: 'dot.ted', wbraid: 'ok' })).toEqual({
      wbraid: 'ok',
    });
    expect(adClickOf({ gclid: 'a'.repeat(512) })).toEqual({ gclid: 'a'.repeat(512) });
    expect(adClickOf({ gclid: 'a'.repeat(513) })).toBeNull();
    expect(adClickOf({ gclid: '' })).toBeNull();
    expect(adClickOf({ gclid: 5 })).toBeNull();
  });

  it('is no click for anything that is not an object with an id', () => {
    for (const value of [null, undefined, 'Cj0', 7, [], {}]) {
      expect(adClickOf(value)).toBeNull();
    }
  });
});
