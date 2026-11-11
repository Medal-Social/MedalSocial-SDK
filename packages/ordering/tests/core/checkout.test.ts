import { describe, expect, it } from 'vitest';
import { CUSTOMER_LIMITS, checkCustomer, isPhoneNumber } from '../../src/core/checkout';

describe('isPhoneNumber', () => {
  it.each([
    '91234567',
    '912 34 567',
    '+47 912 34 567',
    '004791234567',
    '+46701234567',
    '(+47) 912-34-567',
  ])('takes %s', (phone) => expect(isPhoneNumber(phone)).toBe(true));
  it.each(['', '1234567', '+0123456789', 'phone', '+47 912', '9123456789'])('refuses %s', (phone) =>
    expect(isPhoneNumber(phone)).toBe(false)
  );
});

describe('checkCustomer', () => {
  const ok = { name: ' Kari ', phone: '91234567' };
  it('passes good details', () => {
    expect(checkCustomer(ok)).toBeNull();
    expect(checkCustomer({ ...ok, email: ' kari@example.com ' }, ' nuts ')).toBeNull();
    expect(checkCustomer({ ...ok, email: '  ' }, '')).toBeNull();
  });
  it('names the first field the API would refuse, in its order', () => {
    expect(checkCustomer({ name: ' ', phone: 'x', email: 'y' })).toBe('name');
    expect(checkCustomer({ ...ok, name: 'x'.repeat(CUSTOMER_LIMITS.maxName + 1) })).toBe('name');
    expect(checkCustomer({ ...ok, phone: '123', email: 'y' })).toBe('phone');
    expect(checkCustomer({ ...ok, email: 'kari@example' })).toBe('email');
    expect(checkCustomer({ ...ok, email: `${'x'.repeat(250)}@a.no` })).toBe('email');
    expect(checkCustomer(ok, 'x'.repeat(CUSTOMER_LIMITS.maxAllergyNote + 1))).toBe('allergy_note');
  });
});
