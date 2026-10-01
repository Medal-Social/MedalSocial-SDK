import { describe, expect, it } from 'vitest';
import { createPhone, telHref } from '../../src/core/phone';
import { PARITY_CONFIG } from '../support/parity-config';

describe('phone — the strict Norwegian rule', () => {
  const phone = createPhone(PARITY_CONFIG);

  it('dials digits', () => {
    expect(telHref('22 33 44 55')).toBe('tel:22334455');
    expect(phone.telHref('+47 22 33 44 55')).toBe('tel:+4722334455');
  });

  it('strips spacing and a pasted +47 or 0047, never a bare leading 47', () => {
    expect(phone.validate).toBe('strict');
    expect(phone.nationalDigits('400 00 000')).toBe('40000000');
    expect(phone.nationalDigits('+47 400 00 000')).toBe('40000000');
    expect(phone.nationalDigits('0047 (400) 00-000')).toBe('40000000');
    expect(phone.nationalDigits('47 12 34 56')).toBe('47123456');
  });

  it('asks for eight digits and nothing about the first one', () => {
    expect(phone.looksValid('22 33 44 55')).toBe(true);
    expect(phone.looksValid('+4740000000')).toBe(true);
    expect(phone.looksValid('4000000')).toBe(false);
    expect(phone.looksValid('400000000')).toBe(false);
  });

  it('is loose when the site asks for loose, even in Norway', () => {
    const loose = createPhone({ phone: { country: 'NO', validate: 'loose' } });
    expect(loose.validate).toBe('loose');
    expect(loose.looksValid('+47 400 00 000')).toBe(true);
    expect(loose.nationalDigits('+47 400.00.000')).toBe('+4740000000');
  });
});
