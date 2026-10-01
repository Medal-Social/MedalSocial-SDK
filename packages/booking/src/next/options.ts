/**
 * What a site hands the server half of the booking package.
 *
 * Split from `BookingConfig` by TRUST. The config is client-safe and goes into
 * the page as a prop; everything here — the Medal key, the cache handles, the
 * cookie jar, the logger — stays on the server and is never serialised.
 *
 * The package reads NO environment variable. A site passes its own key in
 * (`process.env.MEDAL_API_KEY` in a Next app), so the name of the variable,
 * the secret manager behind it and the moment it is read are all the app's.
 */

import type { BookingConfig } from '../core/config';
import type { CookieSource } from '../core/portal/cookies';
import type { MedalSeamOptions } from './medal';

/**
 * One cache the package reads through. Two of them back a booking site: the
 * per-location EDGE cache (the booking seed and catalogue, a few ms to read)
 * and the cross-isolate DATA cache (services, stylists, hours and free slots).
 *
 * `get`/`put`/`delete` are the contract every adapter keeps. The optional
 * members are what a platform adds on top: tag expiry for a data cache, a
 * background hand-off, a deploy version and a storage-key mapping for an
 * edge cache, and a read-through `load` for a cache (Next's) that is a
 * function wrapper rather than a key-value store.
 */
export interface BookingCacheAdapter {
  /** The value under `key`, or `undefined` for a miss. May throw; callers treat a throw as a miss. */
  get<T>(key: string): Promise<T | undefined>;
  /** Store `value` for at most `ttlSeconds`. `tags` group entries for `expireTag`. */
  put<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    options?: { tags?: readonly string[] }
  ): Promise<void>;
  /** Drop `keys` — in this location only, for an edge cache. */
  delete(keys: readonly string[]): Promise<void>;
  /** Expire every entry stored under `tag`. */
  expireTag?(tag: string): Promise<void>;
  /**
   * Hand background work to the platform (`ctx.waitUntil`, `after()`), so it
   * outlives the response without holding it. Answers `false` when there is no
   * hook for THIS request; the caller then awaits the work itself.
   */
  defer?(work: Promise<unknown>): boolean;
  /**
   * The storage key for a package key, or `null` when this adapter cannot
   * store anything right now (off its platform, no origin configured). The
   * default is the key itself.
   */
  key?(key: string): string | null;
  /** The deployed version, mixed into edge keys so a deploy starts cold. */
  version?(): string | undefined;
  /**
   * Read-through: the cached answer for `keyParts` + `args`, or `fill()`'s,
   * stored for `ttlSeconds` under `tags`. Adapters without it get the
   * `get`-then-`put` default (`cacheLoad`).
   */
  load?<T>(
    keyParts: readonly string[],
    args: readonly unknown[],
    fill: () => Promise<T>,
    options: { ttlSeconds: number; tags: readonly string[] }
  ): Promise<T>;
}

/**
 * Pino's call shape — `(meta, message)` — which is what every log line in the
 * package writes. `console` accepts it too.
 */
export interface BookingLogger {
  info(meta: unknown, message?: string): void;
  warn(meta: unknown, message?: string): void;
  error(meta: unknown, message?: string): void;
}

/** The phases the package measures. Fixed strings: the header is public. */
export type BookingTimingPhase = 'catalogue' | 'seed' | 'guardian';

/**
 * A `Server-Timing` sink. `meta.start` / `meta.end` are the span in
 * `Date.now()` milliseconds; the seed phase also carries `meta.state`
 * (`hit`, `stale`, `miss` or `bypass`).
 */
export type BookingTiming = (
  phase: BookingTimingPhase,
  ms: number,
  meta?: Record<string, string>
) => void;

/**
 * The app's rate limiter, asked once per handler request before anything is
 * read. `true` answers `429 { error: 'rateLimited' }`. `scope` is the route
 * (`booking/create`, `portal/login/verify`, …).
 */
export type BookingRateLimit = (scope: string, request: Request) => boolean | Promise<boolean>;

export interface BookingServerOptions {
  /** The resolved, client-safe config (`resolveBookingConfig`). */
  config: Readonly<BookingConfig>;
  /**
   * The Medal API key and origin. The app passes its own secrets in — as
   * values, or as functions read on every call where the platform fills
   * `process.env` per request (OpenNext on Workers). A missing or placeholder
   * key fails as `MedalConfigError` when Medal is first asked, never at
   * import.
   */
  medal: MedalSeamOptions;
  cache: {
    /** L1: per-location, few-ms reads (the booking seed and catalogue). */
    edge: BookingCacheAdapter;
    /** L2: cross-isolate data cache (services, stylists, hours, slots). */
    data: BookingCacheAdapter;
    /** Data-cache key prefix (the first key part of every L2 entry). */
    prefix: string;
    /** Edge-key path prefix. Default `/__medal-edge/booking-seed/v1`. */
    edgePrefix?: string;
    /** Added to every edge key, so staging and production on one zone never share. */
    environment: string;
  };
  /** The cookie jar for this request. Default: `cookies()` from `next/headers`. */
  cookies?: CookieSource;
  timing?: BookingTiming;
  logger?: BookingLogger;
  rateLimit?: BookingRateLimit;
  /**
   * The origin to fall back on when a request names none (a server action
   * with no host header): the site's canonical URL.
   */
  baseUrl?: string | (() => string | undefined);
  /** The portal's server-side switches. Every field has a default. */
  portal?: BookingPortalServerOptions;
  /**
   * The hosts the avatar route may fetch a stylist photo from: an exact
   * hostname (`images.example.com`) or a `*.` suffix (`*.example.com`, which
   * matches every subdomain but not the apex). Default
   * `DEFAULT_AVATAR_HOSTS` — Medal's photo storage and Google profile
   * pictures. Whatever is listed, the route only fetches `https:` on the
   * default port, never an IP address, `localhost` or an internal name, and
   * never follows a redirect.
   */
  avatarHosts?: readonly string[];
}

/**
 * Where Medal's `photo_url` points: presigned Cloudflare R2 objects (Medal's
 * own photo storage) and, for a stylist linked to a member with no photo of
 * their own, that member's Google profile picture.
 */
export const DEFAULT_AVATAR_HOSTS: readonly string[] = Object.freeze([
  '*.r2.cloudflarestorage.com',
  '*.googleusercontent.com',
]);

export interface BookingPortalServerOptions {
  /**
   * Whether the portal is on for THIS request, for a site whose switch lives
   * in a CMS. Default `config.portal.enabled`.
   */
  enabled?: () => boolean | Promise<boolean>;
  /** The «Vipps link» flash cookie. Default `<portal.cookieName>_vipps_flash`. */
  vippsFlashCookieName?: string;
  /** Where Vipps returns a login (the `vippsReturn` route). Default `<paths.portal>/vipps`. */
  vippsReturnPath?: string;
  /** Where Vipps returns a «link Vipps» (the `vippsLinkReturn` route). Default `<paths.portal>/vipps/link`. */
  vippsLinkReturnPath?: string;
  /** The word the delete-account form must carry. Default `'SLETT'`. */
  deleteConfirmWord?: string;
  /** The data export's file name, before `-<date>.json`. Default `'min-side-eksport'`. */
  exportFilePrefix?: string;
  /** The language of Medal's login e-mails. Default `'no'`. */
  locale?: 'no' | 'en';
  /** The validation sentences the portal's actions answer with. */
  messages?: Partial<PortalMessages>;
}

/** The sentences the portal answers a form with. Norwegian by default. */
export interface PortalMessages {
  duplicateChild: string;
  invalidChild: string;
  childNotFound: string;
  invalidPhone: string;
  invalidBirthYear: string;
}

export const DEFAULT_PORTAL_MESSAGES: PortalMessages = {
  duplicateChild: 'Dette barnet er allerede lagt inn.',
  invalidChild: 'Sjekk navn, fødselsår og måned.',
  childNotFound: 'Fant ikke barnet. Last siden på nytt og prøv igjen.',
  invalidPhone: 'Telefonnummeret må ha åtte siffer.',
  invalidBirthYear: 'Fødselsåret ser ikke riktig ut.',
};

export const DEFAULT_EDGE_PREFIX = '/__medal-edge/booking-seed/v1';

const quiet = () => {};

/** The default logger: silent. A site that wants the lines passes its own. */
export const SILENT_LOGGER: BookingLogger = { info: quiet, warn: quiet, error: quiet };

/**
 * `work` measured into `timing` under `phase`, or just `work` when there is no
 * sink. `meta` is read after the work, so a phase can report how it ended.
 */
export async function timed<T>(
  timing: BookingTiming | undefined,
  phase: BookingTimingPhase,
  work: () => Promise<T>,
  meta?: () => Record<string, string> | undefined
): Promise<T> {
  if (!timing) return work();
  const start = Date.now();
  try {
    return await work();
  } finally {
    const end = Date.now();
    timing(phase, end - start, { start: String(start), end: String(end), ...meta?.() });
  }
}

/**
 * Hand `work` to the adapter's `defer`, or await it where there is none.
 * Never throws: everything scheduled through here is an optimisation.
 */
export async function inBackground(
  adapter: Pick<BookingCacheAdapter, 'defer'>,
  work: Promise<unknown>
): Promise<void> {
  const settled = work.then(
    () => undefined,
    () => undefined
  );
  if (adapter.defer?.(settled) === true) return;
  await settled;
}

/** The read-through every adapter without its own `load` gets. */
export async function cacheLoad<T>(
  adapter: BookingCacheAdapter,
  keyParts: readonly string[],
  args: readonly unknown[],
  fill: () => Promise<T>,
  options: { ttlSeconds: number; tags: readonly string[] }
): Promise<T> {
  if (adapter.load) return adapter.load(keyParts, args, fill, options);
  // A path, so an adapter that keys by URL (the Workers cache) can store it.
  const path = `/${[...keyParts, JSON.stringify(args)].map(encodeURIComponent).join('/')}`;
  const key = adapter.key ? adapter.key(path) : path;
  if (key === null) return fill();
  const hit = await adapter.get<T>(key).catch(() => undefined);
  if (hit !== undefined) return hit;
  const value = await fill();
  await adapter.put(key, value, options.ttlSeconds, { tags: options.tags }).catch(() => undefined);
  return value;
}
