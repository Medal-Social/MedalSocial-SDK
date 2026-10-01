import { describe, expect, it } from 'vitest';
import { createSessionCookie, isPortalSessionToken } from '../../../src/core/portal/session-cookie';
import { PARITY_CONFIG } from '../../support/parity-config';

const TOKEN = `${'A'.repeat(21)}-_${'z'.repeat(20)}`;

describe('session cookie', () => {
  it('names the cookie and the two portal paths from the config', () => {
    expect(createSessionCookie(PARITY_CONFIG)).toEqual({
      PORTAL_SESSION_COOKIE: 'demo_portal',
      PORTAL_DASHBOARD_PATH: '/min-side',
      PORTAL_LOGIN_PATH: '/min-side/logg-inn',
      isPortalSessionToken,
    });
  });

  it('accepts only 43 characters of unpadded base64url', () => {
    expect(TOKEN).toHaveLength(43);
    expect(isPortalSessionToken(TOKEN)).toBe(true);
    expect(isPortalSessionToken(`${TOKEN}=`)).toBe(false);
    expect(isPortalSessionToken(TOKEN.replace('-', '+'))).toBe(false);
    expect(isPortalSessionToken(TOKEN.slice(1))).toBe(false);
    expect(isPortalSessionToken(42)).toBe(false);
  });
});
