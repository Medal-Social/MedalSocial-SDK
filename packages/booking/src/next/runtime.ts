/**
 * One booking site's server half, wired once: the Medal seam, the two caches,
 * the seed, the portal seam and the cookie helpers, all built from one
 * `BookingServerOptions`. The handler, the loaders and the portal actions are
 * views over the same runtime, so a site that builds one with
 * `createBookingServer` shares its in-flight refreshes and its clients
 * across all three.
 *
 * Every part can be replaced (`overrides`) — the tests do, and a site with an
 * unusual Medal setup can.
 */

import { cookies as nextCookies } from 'next/headers';
import { createClock } from '../core/clock';
import type { BookingConfig } from '../core/config';
import { createDto } from '../core/dto';
import { createPaths } from '../core/paths';
import { createPhone } from '../core/phone';
import type { CookieJar, CookieSource } from '../core/portal/cookies';
import { createPortalNextPath } from '../core/portal/next-path';
import { createVippsLinkCookies } from '../core/portal/vipps-link';
import { type Catalogue, createCatalogue } from './catalogue';
import { createMedalSeam, type MedalSeam } from './medal';
import type { BookingLogger, BookingServerOptions, PortalMessages } from './options';
import { DEFAULT_PORTAL_MESSAGES, SILENT_LOGGER } from './options';
import { createGuardian } from './portal/guardian';
import { createPortalSeam, type PortalSeam } from './portal/medal-portal';
import { createPortalSession, type PortalSession } from './portal/session';
import { createVippsFlash, type VippsFlash } from './portal/vipps-flash';
import { createSeed, type Seed } from './seed';

export interface BookingRuntime {
  options: BookingServerOptions;
  config: Readonly<BookingConfig>;
  logger: BookingLogger;
  cookies: CookieSource;
  medal: MedalSeam;
  catalogue: Catalogue;
  seed: Seed;
  portal: PortalSeam;
  session: PortalSession;
  guardianFromSession: ReturnType<typeof createGuardian>;
  nextPath: ReturnType<typeof createPortalNextPath>;
  vippsLink: ReturnType<typeof createVippsLinkCookies>;
  flash: VippsFlash;
  dto: ReturnType<typeof createDto>;
  clock: ReturnType<typeof createClock>;
  phone: ReturnType<typeof createPhone>;
  paths: ReturnType<typeof createPaths> & {
    /** `null` when the site has no portal. */
    portal: string | null;
    portalLogin: string;
    sessionExpired: string;
    vippsReturn: string;
    vippsLinkReturn: string;
  };
  messages: PortalMessages;
  /** The site's canonical origin, for a request that names none. */
  baseUrl(): string | undefined;
}

/** Next's own jar, typed as the package's (a structural subset). */
const defaultCookies: CookieSource = async () => (await nextCookies()) as unknown as CookieJar;

export function createBookingRuntime(
  options: BookingServerOptions,
  overrides: Partial<BookingRuntime> = {}
): BookingRuntime {
  const { config } = options;
  const logger = overrides.logger ?? options.logger ?? SILENT_LOGGER;
  const cookies = overrides.cookies ?? options.cookies ?? defaultCookies;
  const medal = overrides.medal ?? createMedalSeam(options.medal);
  const catalogue =
    overrides.catalogue ?? createCatalogue({ config, cache: options.cache, logger }, medal);
  const seed =
    overrides.seed ??
    createSeed({ config, cache: options.cache, logger, timing: options.timing }, catalogue);
  const messages = { ...DEFAULT_PORTAL_MESSAGES, ...options.portal?.messages };
  const portal = overrides.portal ?? createPortalSeam(medal, { config, messages });
  const portalPath = config.paths.portal;
  const portalBase = portalPath ?? config.paths.booking;
  return {
    options,
    config,
    logger,
    cookies,
    medal,
    catalogue,
    seed,
    portal,
    session: overrides.session ?? createPortalSession(config, cookies),
    guardianFromSession: overrides.guardianFromSession ?? createGuardian(portal, logger),
    nextPath: overrides.nextPath ?? createPortalNextPath(config, cookies),
    vippsLink: overrides.vippsLink ?? createVippsLinkCookies(config, cookies),
    flash:
      overrides.flash ??
      createVippsFlash(
        {
          cookieName:
            options.portal?.vippsFlashCookieName ?? `${config.portal.cookieName}_vipps_flash`,
          path: portalBase,
        },
        cookies
      ),
    dto: overrides.dto ?? createDto(config),
    clock: overrides.clock ?? createClock(config),
    phone: overrides.phone ?? createPhone(config),
    paths: overrides.paths ?? {
      ...createPaths(config),
      portal: portalPath,
      portalLogin: config.paths.portalLogin,
      sessionExpired: `${config.paths.portalApi}/session/expired`,
      vippsReturn: options.portal?.vippsReturnPath ?? `${portalBase}/vipps`,
      vippsLinkReturn: options.portal?.vippsLinkReturnPath ?? `${portalBase}/vipps/link`,
    },
    messages,
    baseUrl:
      overrides.baseUrl ??
      (() => {
        const value = options.baseUrl;
        return typeof value === 'function' ? value() : value;
      }),
  };
}
