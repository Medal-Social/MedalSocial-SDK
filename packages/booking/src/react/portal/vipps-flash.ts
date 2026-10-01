import type { VippsLinkFlash } from '@medalsocial/meda/booking';
import type { BookingConfig } from '../../core/config';

/**
 * How a «link Vipps» attempt ended, as the profile reads it. The outcome
 * never travels in a URL: the return route sets an httpOnly flash cookie and
 * lands on a bare portal page, the server page reads it and hands it to the
 * dashboard, and the dashboard spends it. Free of `'use client'`.
 */

export type { VippsLinkFlash };

export const VIPPS_LINK_FLASHES: readonly VippsLinkFlash[] = [
  'linked',
  'link_conflict',
  'link_failed',
];

/** A cookie value as a flash, or `null` for anything else. */
export function vippsLinkFlash(value: unknown): VippsLinkFlash | null {
  return VIPPS_LINK_FLASHES.find((flash) => flash === value) ?? null;
}

/** Where the flash is spent (`DELETE`), so a reload says nothing again. */
export function vippsFlashPath(config: Pick<BookingConfig, 'paths'>): string {
  return `${config.paths.portalApi}/vipps/flash`;
}
