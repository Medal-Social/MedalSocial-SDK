import { describe, expect, it } from 'vitest';
import { codeField, emailField, verifyLoginInput } from '../../../src/core/portal/login-input';

describe('login input', () => {
  it('trims and lower-cases the address before checking it', () => {
    expect(emailField.parse('  Kari@Example.NO ')).toBe('kari@example.no');
    expect(emailField.safeParse('not an address').success).toBe(false);
  });

  it('takes six digits and nothing else', () => {
    expect(codeField.parse('123456')).toBe('123456');
    const refused = codeField.safeParse('12345');
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe('Koden er seks siffer.');
  });

  it('validates the pair', () => {
    expect(verifyLoginInput.parse({ email: 'kari@example.no', code: '000111' })).toEqual({
      email: 'kari@example.no',
      code: '000111',
    });
  });
});
