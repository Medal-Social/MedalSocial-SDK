import type { BookingConfig } from '../config';
import type { CookieSource } from './cookies';

/**
 * The two short-lived cookies behind «confirm a conflicted Vipps login with
 * an e-mail code» (SP10 A5).
 *
 * BROWSER BINDING. When this site starts a Vipps login it mints 32 random
 * bytes, keeps them in the binding cookie and sends them to Medal as
 * `browser_binding`; Medal stores them with the pending link and will only
 * verify a code from the browser that holds the same value. A `link` copied
 * out of one browser's address bar is worthless in another's.
 *
 * THE LINK. Medal's callback hands the browser an opaque `link` for the
 * pending login. `/min-side/vipps` — where the callback lands — moves it
 * straight into the link cookie, scoped to the one route that spends it, and
 * redirects on without it: the page the parent types the code on never has
 * the link in its address bar, its history entry, its Referer or any
 * analytics pageview. The verify route reads it back from the cookie and
 * sends it to Medal in a POST body — the only place it is ever written.
 *
 * Both `httpOnly` (no script reads them), `secure`, `SameSite=Lax` (the Vipps
 * callback is a top-level navigation from another site, which Lax admits) and
 * fifteen minutes long — Medal's own lifetime for a pending link.
 *
 * THE BINDING IS MANDATORY. Medal binds every pending link to a browser and
 * refuses a verify without the matching value, so this site does not pretend
 * otherwise: no binding cookie, no link cookie (the return route), and no
 * pair to verify (`readVippsLinkPair`). The binding cookie is `__Host-`
 * prefixed — Secure, `Path=/`, no `Domain` — so no sibling host or insecure
 * page can plant one. It is new with SP10, so there is no older name to keep
 * reading.
 */

/** The route that spends the link, and so the only path its cookie is sent to. */
export function vippsLinkVerifyPath(config: Pick<BookingConfig, 'paths'>): string {
  return `${config.paths.portalApi}/vipps/link/verify`;
}

const MAX_AGE_SECONDS = 15 * 60;

/** Medal's link and this site's binding are both 32 bytes of unpadded base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isVippsToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value);
}

/** 32 random bytes, unpadded base64url — 43 characters. */
export function mintBrowserBinding(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export interface VippsLinkCookies {
  readonly VIPPS_BINDING_COOKIE: string;
  readonly VIPPS_LINK_COOKIE: string;
  readonly VIPPS_LINK_VERIFY_PATH: string;
  writeBrowserBinding(binding: string): Promise<void>;
  writePendingLink(link: string): Promise<void>;
  readBrowserBinding(): Promise<string | null>;
  readVippsLinkPair(): Promise<{ link: string; binding: string } | null>;
  clearBrowserBinding(): Promise<void>;
  clearVippsLinkPair(): Promise<void>;
}

/** The binding and link cookies, named by `portal.vippsBindingCookieName` / `vippsLinkCookieName`. */
export function createVippsLinkCookies(
  config: Pick<BookingConfig, 'portal' | 'paths'>,
  cookies: CookieSource
): VippsLinkCookies {
  const VIPPS_BINDING_COOKIE = config.portal.vippsBindingCookieName;
  const VIPPS_LINK_COOKIE = config.portal.vippsLinkCookieName;
  const VIPPS_LINK_VERIFY_PATH = vippsLinkVerifyPath(config);

  /** The attributes, without a lifetime — a delete must not carry `Max-Age`. */
  const ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax' as const };
  const OPTIONS = { ...ATTRIBUTES, maxAge: MAX_AGE_SECONDS };

  async function writeBrowserBinding(binding: string): Promise<void> {
    (await cookies()).set(VIPPS_BINDING_COOKIE, binding, { ...OPTIONS, path: '/' });
  }

  async function writePendingLink(link: string): Promise<void> {
    (await cookies()).set(VIPPS_LINK_COOKIE, link, { ...OPTIONS, path: VIPPS_LINK_VERIFY_PATH });
  }

  /** This browser's binding, when it holds one of the right shape. */
  async function readBrowserBinding(): Promise<string | null> {
    const binding = (await cookies()).get(VIPPS_BINDING_COOKIE)?.value;
    return isVippsToken(binding) ? binding : null;
  }

  /**
   * What the verify route needs: the link AND the binding, both the right
   * shape — or `null`, which the route answers without asking Medal.
   */
  async function readVippsLinkPair(): Promise<{ link: string; binding: string } | null> {
    const jar = await cookies();
    const link = jar.get(VIPPS_LINK_COOKIE)?.value;
    const binding = jar.get(VIPPS_BINDING_COOKIE)?.value;
    if (!isVippsToken(link) || !isVippsToken(binding)) return null;
    return { link, binding };
  }

  /**
   * The binding alone gone — a login that ended without a pending link (a
   * grant, a start that failed). Deleted with the attributes it was set with:
   * a `__Host-` cookie is only replaced by a Secure `Path=/` one.
   */
  async function clearBrowserBinding(): Promise<void> {
    (await cookies()).delete({ name: VIPPS_BINDING_COOKIE, ...ATTRIBUTES, path: '/' });
  }

  /** Both gone, once the link has been spent: neither is worth anything after. */
  async function clearVippsLinkPair(): Promise<void> {
    const jar = await cookies();
    jar.delete({ name: VIPPS_LINK_COOKIE, ...ATTRIBUTES, path: VIPPS_LINK_VERIFY_PATH });
    jar.delete({ name: VIPPS_BINDING_COOKIE, ...ATTRIBUTES, path: '/' });
  }

  return {
    VIPPS_BINDING_COOKIE,
    VIPPS_LINK_COOKIE,
    VIPPS_LINK_VERIFY_PATH,
    writeBrowserBinding,
    writePendingLink,
    readBrowserBinding,
    readVippsLinkPair,
    clearBrowserBinding,
    clearVippsLinkPair,
  };
}
