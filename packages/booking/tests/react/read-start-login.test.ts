import { describe, expect, it } from 'vitest';
import { readStartLogin } from '../../src/react/actions';

describe('readStartLogin', () => {
  it('reads an app-level throttle, plain or inside the envelope', () => {
    expect(readStartLogin({ ok: false, reason: 'throttled' })).toEqual({
      ok: false,
      reason: 'throttled',
    });
    expect(readStartLogin({ data: { ok: false, reason: 'throttled' } })).toEqual({
      ok: false,
      reason: 'throttled',
    });
  });

  it('still reads sent, a bad address and nothing at all as before', () => {
    expect(readStartLogin({ status: 'sent' })).toEqual({ ok: true });
    expect(readStartLogin({ ok: false, reason: 'invalid', message: 'x' })).toEqual({
      ok: false,
      reason: 'invalidEmail',
    });
    expect(readStartLogin(undefined)).toEqual({ ok: false, reason: 'unreachable' });
  });
});
