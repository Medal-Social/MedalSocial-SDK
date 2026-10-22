import { describe, expect, it } from 'vitest';
import { createMoney, formatOre } from '../../src/core/money';

const NBSP = '\u00A0';
const MINUS = '\u2212';

describe('money — NOK in Norwegian, hand-written', () => {
  const money = createMoney();

  it.each([
    [0, `0${NBSP}kr`],
    [5, `0,05${NBSP}kr`],
    [14_950, `149,50${NBSP}kr`],
    [15_000, `150${NBSP}kr`],
    [123_450, `1${NBSP}234,50${NBSP}kr`],
    [1_234_500, `12${NBSP}345${NBSP}kr`],
    [100_000_000, `1${NBSP}000${NBSP}000${NBSP}kr`],
  ])('writes %d øre as «%s»', (ore, expected) => {
    expect(money.formatOre(ore)).toBe(expected);
  });

  it('defaults to nb-NO and NOK', () => {
    expect(money.currency).toBe('NOK');
    expect(formatOre(14_950)).toBe(`149,50${NBSP}kr`);
  });

  it('rounds a fractional øre and writes a negative amount with a minus sign', () => {
    expect(money.formatOre(14_949.6)).toBe(`149,50${NBSP}kr`);
    expect(money.formatOre(-2_050)).toBe(`${MINUS}20,50${NBSP}kr`);
    expect(money.formatOre(-0.4)).toBe(`0${NBSP}kr`);
  });

  it('applies to every Norwegian spelling', () => {
    for (const locale of ['nb', 'no', 'nn-NO', 'NB-no']) {
      expect(createMoney({ locale }).formatOre(15_000)).toBe(`150${NBSP}kr`);
    }
  });

  it('writes a modifier delta signed, and nothing for a free option', () => {
    expect(money.formatDeltaOre(1_500)).toBe(`+${NBSP}15${NBSP}kr`);
    expect(money.formatDeltaOre(-1_500)).toBe(`${MINUS}${NBSP}15${NBSP}kr`);
    expect(money.formatDeltaOre(0)).toBe('');
  });

  it('refuses a non-finite amount', () => {
    expect(() => money.formatOre(Number.NaN)).toThrow(RangeError);
    expect(() => money.formatOre(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('money — Intl for everything else', () => {
  it('writes a whole amount whole and anything else to the currency precision', () => {
    const gbp = createMoney({ locale: 'en-GB', currency: 'GBP' });
    expect(gbp.formatOre(1_200)).toBe('£12');
    expect(gbp.formatOre(1_250)).toBe('£12.50');
    expect(gbp.formatDeltaOre(250)).toBe('+£2.50');
    expect(gbp.formatDeltaOre(-250)).toBe('-£2.50');
    expect(gbp.formatDeltaOre(0.4)).toBe('');
  });

  it('writes NOK the Intl way outside Norwegian', () => {
    expect(createMoney({ locale: 'en-GB', currency: 'NOK' }).formatOre(14_950)).toMatch(
      /^NOK\s149\.50$/u
    );
  });

  it('reads a zero-decimal currency in its own minor unit', () => {
    expect(createMoney({ locale: 'ja-JP', currency: 'JPY' }).formatOre(1_200)).toMatch(/1,200/);
  });

  it('refuses a non-finite amount too', () => {
    expect(() => createMoney({ locale: 'en-GB', currency: 'GBP' }).formatOre(Number.NaN)).toThrow(
      RangeError
    );
  });
});
