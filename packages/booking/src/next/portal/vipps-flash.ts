/**
 * The one-shot flash that carries a «link Vipps» outcome from the link return
 * route to the portal's profile section — «linked», the conflict sentence, or
 * the failure sentence.
 *
 * A cookie and not a query value, for two reasons. A URL value is anyone's
 * to type, and the success message must mean «this site spent a link grant
 * and Medal said yes» — `linked` is only ever written after a successful
 * `completeVippsLink`. And the return route redirects to a bare portal URL,
 * so no outcome (and no `link_grant`) stays in the address bar or history.
 * The dashboard reads it on the server; the profile row spends it
 * (`DELETE <portalApi>/vipps/flash` — a page may not write a cookie while
 * rendering).
 *
 * `httpOnly` (no script can plant or read it), `secure`, `SameSite=Lax` (the
 * redirect that carries it is a same-site navigation), scoped to the portal
 * path, and sixty seconds long: enough for the redirect to land, short enough
 * that a missed clear cannot speak on tomorrow's visit.
 */

import type { CookieSource } from '../../core/portal/cookies';

export const VIPPS_LINK_FLASHES = ['linked', 'link_conflict', 'link_failed'] as const;

export type VippsLinkFlash = (typeof VIPPS_LINK_FLASHES)[number];

/** A cookie value as a flash, or `null` for anything else. */
export function vippsLinkFlash(value: unknown): VippsLinkFlash | null {
  return typeof value === 'string' && (VIPPS_LINK_FLASHES as readonly string[]).includes(value)
    ? (value as VippsLinkFlash)
    : null;
}

export interface VippsFlash {
  readonly VIPPS_FLASH_COOKIE: string;
  writeVippsLinkFlash(flash: VippsLinkFlash): Promise<void>;
  /** The flash this request carries, if it is one of ours. */
  readVippsLinkFlash(): Promise<VippsLinkFlash | null>;
  clearVippsLinkFlash(): Promise<void>;
}

export function createVippsFlash(
  options: { cookieName: string; path: string },
  cookies: CookieSource
): VippsFlash {
  const VIPPS_FLASH_COOKIE = options.cookieName;
  const ATTRIBUTES = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: options.path,
  };
  return {
    VIPPS_FLASH_COOKIE,
    async writeVippsLinkFlash(flash) {
      (await cookies()).set(VIPPS_FLASH_COOKIE, flash, { ...ATTRIBUTES, maxAge: 60 });
    },
    async readVippsLinkFlash() {
      return vippsLinkFlash((await cookies()).get(VIPPS_FLASH_COOKIE)?.value);
    },
    async clearVippsLinkFlash() {
      (await cookies()).delete({ name: VIPPS_FLASH_COOKIE, ...ATTRIBUTES });
    },
  };
}
