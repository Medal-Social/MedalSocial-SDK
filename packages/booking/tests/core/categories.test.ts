import { describe, expect, it } from 'vitest';
import {
  adultCategoryFor,
  adultEquivalent,
  categoryOrder,
  childCategory,
  isChildCategory,
  normaliseCategory,
} from '../../src/core/categories';
import { resolveBookingConfig } from '../../src/core/config';
import { PARITY_CONFIG } from '../support/parity-config';

describe('categories', () => {
  it('keeps the configured display order', () => {
    expect(categoryOrder(PARITY_CONFIG)).toEqual([
      'barn',
      'dame',
      'herre',
      'farge',
      'foliestriper',
      'annet',
    ]);
  });

  it('lands an unknown or missing Medal category on the fallback', () => {
    expect(normaliseCategory(PARITY_CONFIG, 'herre')).toBe('herre');
    expect(normaliseCategory(PARITY_CONFIG, 'negler')).toBe('annet');
    expect(normaliseCategory(PARITY_CONFIG, null)).toBe('annet');
    expect(normaliseCategory(PARITY_CONFIG, undefined)).toBe('annet');
  });

  it('knows the kids’ path by audience, not by name', () => {
    expect(isChildCategory(PARITY_CONFIG, 'barn')).toBe(true);
    expect(isChildCategory(PARITY_CONFIG, 'dame')).toBe(false);
    expect(isChildCategory(PARITY_CONFIG, 'negler')).toBe(false);
    expect(childCategory(PARITY_CONFIG)).toBe('barn');
    expect(
      childCategory(
        resolveBookingConfig({ timeZone: 'UTC', categories: [{ key: 'annet', audience: 'any' }] })
      )
    ).toBeNull();
  });

  it('grows a kids’ service up by the word in its name, first rule first', () => {
    const service = (name: string, category = 'barn') => ({ name, category });
    expect(adultCategoryFor(PARITY_CONFIG, service('Gutteklipp'))).toBe('herre');
    expect(adultCategoryFor(PARITY_CONFIG, service('JENTEKLIPP'))).toBe('dame');
    expect(adultCategoryFor(PARITY_CONFIG, service('Barneklipp'))).toBeNull();
    expect(adultCategoryFor(PARITY_CONFIG, service('Herreklipp', 'herre'))).toBeNull();
  });

  it('answers the services in that adult group, or none', () => {
    const herre = { name: 'Herreklipp', category: 'herre' };
    const dame = { name: 'Dameklipp', category: 'dame' };
    expect(
      adultEquivalent(PARITY_CONFIG, { name: 'Gutteklipp', category: 'barn' }, [herre, dame])
    ).toEqual([herre]);
    expect(adultEquivalent(PARITY_CONFIG, herre, [herre, dame])).toEqual([]);
  });
});
