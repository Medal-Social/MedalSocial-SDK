import { describe, expect, it, vi } from 'vitest';
import { createGuardian } from '../../../src/next/portal/guardian';
import type { PortalSeam } from '../../../src/next/portal/medal-portal';

describe('guardianFromSession, when the profile cannot be read', () => {
  it('is null and a warning — never a throw', async () => {
    const failure = new Error('session expired');
    const getMe = vi.fn<PortalSeam['getMe']>().mockRejectedValue(failure);
    const getMyBookings = vi
      .fn<PortalSeam['getMyBookings']>()
      .mockResolvedValue({ upcoming: [], past: [] });
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const guardianFromSession = createGuardian({ getMe, getMyBookings }, logger);

    await expect(guardianFromSession('session')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: failure },
      'Could not read the Min side profile for the booking wizard'
    );
  });
});
