import { describe, expect, it } from 'vitest';
import { ageOnDay, createAge, fitsAge } from '../../src/core/age';
import { PARITY_CONFIG } from '../support/parity-config';

const { ageLabel, grownUpEquivalent } = createAge(PARITY_CONFIG);

describe('ageOnDay', () => {
  it('is exact with the birth month, counting the birthday as the first of the month', () => {
    // Medal's own `ageOnDay`: before the birth month, a year younger.
    expect(ageOnDay(2019, 9, '2026-08-31')).toEqual({ min: 6, max: 6 });
    expect(ageOnDay(2019, 9, '2026-09-01')).toEqual({ min: 7, max: 7 });
  });

  it('is a range of two without it — the birthday may or may not have been', () => {
    expect(ageOnDay(2019, undefined, '2026-09-02')).toEqual({ min: 6, max: 7 });
    expect(ageOnDay(2019, null, '2026-09-02')).toEqual({ min: 6, max: 7 });
  });

  it('never goes below nothing', () => {
    expect(ageOnDay(2026, undefined, '2026-09-02')).toEqual({ min: 0, max: 0 });
    expect(ageOnDay(2026, 12, '2026-09-02')).toBeNull();
    expect(ageOnDay(2027, undefined, '2026-09-02')).toBeNull();
  });

  it('ignores a month that is not one', () => {
    expect(ageOnDay(2019, 13, '2026-09-02')).toEqual({ min: 6, max: 7 });
  });
});

describe('ageLabel', () => {
  it('reads «7 år» or «7–8 år»', () => {
    expect(ageLabel({ min: 7, max: 7 })).toBe('7 år');
    expect(ageLabel({ min: 7, max: 8 })).toBe('7–8 år');
  });
});

describe('fitsAge', () => {
  const BARNEHAGE = { ageMaxYears: 6 };
  const HERRE = { ageMinYears: 13 };

  it('rules out only a CERTAIN miss', () => {
    expect(fitsAge(BARNEHAGE, { min: 7, max: 7 })).toBe(false);
    // Six or seven on the day: may still be six, so still offered.
    expect(fitsAge(BARNEHAGE, { min: 6, max: 7 })).toBe(true);
    expect(fitsAge(HERRE, { min: 11, max: 12 })).toBe(false);
    expect(fitsAge(HERRE, { min: 12, max: 13 })).toBe(true);
  });

  it('fits everything when nobody’s age is known, and a service with no range fits everybody', () => {
    expect(fitsAge(BARNEHAGE, null)).toBe(true);
    expect(fitsAge({}, { min: 40, max: 40 })).toBe(true);
  });
});

describe('grownUpEquivalent', () => {
  const service = (id: string, name: string, category: string, bounds = {}) => ({
    id,
    name,
    category,
    ...bounds,
  });
  const BARNEHAGE = service('bhg', 'Barnehageklipp', 'barn', { ageMaxYears: 6 });
  const BARNEKLIPP = service('barn', 'Barneklipp', 'barn', { ageMinYears: 7, ageMaxYears: 12 });
  const GUTTEKLIPP = service('gutt', 'Gutteklipp', 'barn', { ageMaxYears: 12 });
  const JENTEKLIPP = service('jente', 'Jenteklipp', 'barn', { ageMaxYears: 12 });
  const HERRE = service('herre', 'Herreklipp', 'herre', { ageMinYears: 13 });
  const DAME = service('dame', 'Dameklipp', 'dame', { ageMinYears: 13 });

  it('is the one service in the same category that fits now', () => {
    expect(grownUpEquivalent(BARNEHAGE, [BARNEHAGE, BARNEKLIPP, HERRE], { min: 7, max: 7 })).toBe(
      BARNEKLIPP
    );
  });

  it('is the grown-up cut the name points at once the kids’ menu is outgrown', () => {
    const all = [GUTTEKLIPP, JENTEKLIPP, HERRE, DAME];
    expect(grownUpEquivalent(GUTTEKLIPP, all, { min: 13, max: 13 })).toBe(HERRE);
    expect(grownUpEquivalent(JENTEKLIPP, all, { min: 13, max: 14 })).toBe(DAME);
  });

  it('guesses nothing when more than one could be meant', () => {
    expect(
      grownUpEquivalent(BARNEHAGE, [BARNEHAGE, GUTTEKLIPP, JENTEKLIPP], { min: 7, max: 7 })
    ).toBeNull();
  });
});
