/**
 * The client entries' contract: `/react/wizard` is the booking page's subset
 * of `/react`, the same functions rather than copies, and none of the manage
 * page or the portal. (`verify:paths` checks the built graph says the same.)
 */

import { describe, expect, it } from 'vitest';
import * as react from '../../src/react';
import * as wizard from '../../src/react/wizard';

describe('@medalsocial/booking/react/wizard', () => {
  it('exports the booking page: the wizard, its hook, the provider and the login sheet', () => {
    expect(Object.keys(wizard).sort()).toEqual([
      'BookingProvider',
      'BookingWizard',
      'LoginSheet',
      'confirmationLines',
      'isCompleteConfirmation',
      'personForChild',
      'useBooking',
      'useBookingKit',
    ]);
  });

  it('is a subset of /react, so the two entries hand out the same functions', () => {
    const barrel: Record<string, unknown> = { ...react };
    for (const [name, value] of Object.entries(wizard)) expect(barrel[name], name).toBe(value);
    for (const name of ['ManageBooking', 'PortalDashboard', 'BookingLink', 'useNextFree']) {
      expect(react).toHaveProperty(name);
      expect(wizard).not.toHaveProperty(name);
    }
  });
});
