import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureGoogleReferral, readGoogleReferral } from '../../src/core/google-referral';

const NOW = 1_800_000_000_000;
const KEY = 'medal:booking:rwg';

describe('google referral', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps rwg_token from the landing URL for the visit', () => {
    captureGoogleReferral('?tjeneste=sv1&rwg_token=AJKvS9W%2Babc', NOW);
    expect(readGoogleReferral(NOW + 60_000)).toEqual({
      rwg_token: 'AJKvS9W+abc',
      captured_at: NOW,
    });
  });

  it('replaces the stored token with a newer one', () => {
    captureGoogleReferral('?rwg_token=old', NOW);
    captureGoogleReferral('?rwg_token=new', NOW + 1000);
    expect(readGoogleReferral(NOW + 2000)).toEqual({ rwg_token: 'new', captured_at: NOW + 1000 });
  });

  it('keeps the first capture time when the same token arrives again', () => {
    // A reload of the landing URL: a resent booking must carry the same body.
    captureGoogleReferral('?rwg_token=tok', NOW);
    captureGoogleReferral('?rwg_token=tok', NOW + 5000);
    expect(readGoogleReferral(NOW + 6000)).toEqual({ rwg_token: 'tok', captured_at: NOW });
  });

  it('ignores a malformed token and a page without one', () => {
    captureGoogleReferral('?rwg_token=has%20space', NOW);
    captureGoogleReferral('?tjeneste=sv1', NOW);
    captureGoogleReferral(`?rwg_token=${'a'.repeat(2049)}`, NOW);
    expect(readGoogleReferral(NOW)).toBeNull();
  });

  it('forgets a token older than 30 days', () => {
    captureGoogleReferral('?rwg_token=tok', NOW);
    expect(readGoogleReferral(NOW + 30 * 86_400_000)).not.toBeNull();
    expect(readGoogleReferral(NOW + 31 * 86_400_000)).toBeNull();
  });

  it('captures the token again once the stored one has expired', () => {
    captureGoogleReferral('?rwg_token=tok', NOW);
    const later = NOW + 31 * 86_400_000;
    captureGoogleReferral('?rwg_token=tok', later);
    expect(readGoogleReferral(later)).toEqual({ rwg_token: 'tok', captured_at: later });
  });

  it.each([
    ['not json', 'not json'],
    ['null', 'null'],
    ['a token that is not a string', JSON.stringify({ rwg_token: 5, captured_at: NOW })],
    ['a malformed token', JSON.stringify({ rwg_token: 'has space', captured_at: NOW })],
    ['no capture time', JSON.stringify({ rwg_token: 'tok' })],
  ])('reads nothing from a stored value that is %s', (_name, stored) => {
    window.sessionStorage.setItem(KEY, stored);
    expect(readGoogleReferral(NOW)).toBeNull();
  });

  it('goes on without a referral when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => captureGoogleReferral('?rwg_token=tok', NOW)).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readGoogleReferral(NOW)).toBeNull();
  });

  it('goes on without a referral when the browser has no storage', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => captureGoogleReferral('?rwg_token=tok', NOW)).not.toThrow();
    expect(readGoogleReferral(NOW)).toBeNull();
  });
});
