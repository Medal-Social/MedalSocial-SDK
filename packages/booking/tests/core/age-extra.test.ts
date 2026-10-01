import { describe, expect, it } from 'vitest';
import { ageOnDay } from '../../src/core/age';

describe('ageOnDay — input it cannot read', () => {
  it('is null for a day key or birth year that is not a number', () => {
    expect(ageOnDay(2019, 9, 'not-a-day')).toBeNull();
    expect(ageOnDay(Number.NaN, 9, '2026-09-02')).toBeNull();
    expect(ageOnDay(2019.5, null, '2026-09-02')).toBeNull();
  });
});
