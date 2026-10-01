/**
 * The server halves of the three pages: what the booking page, the manage page
 * and the portal dashboard need before they render, as a tagged answer the
 * page turns into markup.
 *
 * Each loader does what the source site's page did, in the same order, and
 * nothing a page decides about layout or copy: the handoff first (so a
 * forwarded visit costs Medal nothing), then the seed and the guardian side by
 * side, with the timing spans the `Server-Timing` header reports.
 *
 * SECURITY. Everything a loader answers crosses into the browser as a prop,
 * and every field is a client-safe DTO. The Medal key never leaves the seam;
 * the session token is read here and put in no answer; the manage token comes
 * back only as the PATHS built from it.
 */

import type { BookingConfig } from '../core/config';
import { stylistDisplayName } from '../core/display-name';
import type { PortalBookingDto, PortalProfileDto } from '../core/portal/dto';
import type { BookingGuardian, BookingManageDto, BookingServiceDto } from '../core/types';
import { toManageDto } from './manage-dto';
import { MedalApiError } from './medal';
import { timed } from './options';
import { PortalSessionExpiredError } from './portal/medal-portal';
import type { VippsLinkFlash } from './portal/vipps-flash';
import { portalEnabled } from './routes/vipps-return';
import type { BookingRuntime } from './runtime';
import type { BookingSeed } from './seed';

/** The business's own contact, for «call us» and the unavailable screens. */
export interface BookingContact {
  phone: string | null;
  address: string | null;
}

/** The per-request switches a site resolves itself (from a CMS, say). */
export interface PageSwitches {
  /** Set = the booking page hands off here. Default `config.handoffUrl`. */
  handoffUrl?: string | null;
  /** Default `config.contact`. */
  contact?: BookingContact;
}

type SearchParams = Record<string, string | string[] | undefined>;

export type BookingPageResult =
  | { kind: 'redirect'; href: string }
  | { kind: 'unavailable'; contact: BookingContact }
  | {
      kind: 'ready';
      seed: BookingSeed;
      guardian: BookingGuardian | null;
      config: Readonly<BookingConfig>;
      contact: BookingContact;
      /** The window the seed describes; the wizard's day strip must use the same. */
      rangeDays: number;
    };

export type ManagePageResult =
  | { kind: 'unreachable'; retryHref: string; contact: BookingContact }
  | { kind: 'unknown'; bookingHref: string; contact: BookingContact }
  | {
      kind: 'ready';
      booking: BookingManageDto;
      service: BookingServiceDto | null;
      /** Where the page POSTs cancel / reschedule. */
      actionPath: string;
      /** The page's own URL, for the calendar entry's «change or cancel» line. */
      selfManagePath: string;
      bookingHref: string;
      contact: BookingContact;
    };

export type PortalPageResult =
  | { kind: 'disabled' }
  | { kind: 'redirect'; href: string }
  | { kind: 'unreachable'; contact: BookingContact }
  | {
      kind: 'ready';
      profile: PortalProfileDto;
      bookings: { upcoming: PortalBookingDto[]; past: PortalBookingDto[] };
      stylists: Array<{ id: string; name: string }>;
      /** How a «link Vipps» attempt just ended, for the profile section to say. */
      vippsFlash: VippsLinkFlash | null;
      bookingHref: string;
      contact: BookingContact;
    };

function contactOf(rt: BookingRuntime, switches: PageSwitches): BookingContact {
  if (switches.contact) return switches.contact;
  return { phone: rt.config.contact.phone, address: rt.config.contact.address };
}

function handoffOf(rt: BookingRuntime, switches: PageSwitches): string | null {
  return switches.handoffUrl === undefined ? rt.config.handoffUrl : switches.handoffUrl;
}

/** Where «book» goes: the handoff when there is one, else the site's own page. */
function bookingHrefOf(rt: BookingRuntime, switches: PageSwitches): string {
  return handoffOf(rt, switches) ?? rt.config.paths.booking;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * The booking page.
 *
 * THE HANDOFF. With a handoff URL the business takes its bookings somewhere
 * else, and the booking page is the address every old link already points
 * at, so it forwards (the page answers with a 307 `redirect`). The manage page
 * is deliberately NOT covered: it is the link in every confirmation e-mail.
 *
 * Then the seed (catalogue, stylists, openings and hours for the prefetch set
 * the link names) and the guardian (a parent who arrived holding a portal
 * session), side by side. A seed that cannot be read — the catalogue is the
 * one fetch the page cannot do without — is `unavailable`.
 */
export async function loadBookingPage(
  rt: BookingRuntime,
  { searchParams = {}, ...switches }: PageSwitches & { searchParams?: SearchParams } = {}
): Promise<BookingPageResult> {
  const handoff = handoffOf(rt, switches);
  if (handoff !== null) return { kind: 'redirect', href: handoff };
  const contact = contactOf(rt, switches);

  // The one the link names first — the portal's «book again» key, then the
  // marketing key — so the likeliest service is in the HTML.
  const { query } = rt.config;
  const named = single(searchParams[query.rebookService]) ?? single(searchParams[query.service]);

  const loadSeed = async (): Promise<BookingSeed | null> => {
    try {
      return await rt.seed.loadBookingSeed(named);
    } catch (error) {
      rt.logger.error({ err: error }, 'Could not read the service catalogue for the booking page');
      return null;
    }
  };
  // Best effort in every direction: no cookie, a dead one, or Medal being
  // unreachable are all a visitor the page does not know, who books like
  // everybody else. Never a redirect, never a cookie write (a page may not).
  const fetchGuardian = async (): Promise<BookingGuardian | null> => {
    const session = await rt.session.readPortalSession();
    if (session === null) return null;
    return rt.guardianFromSession(session);
  };
  const [seed, guardian] = await Promise.all([
    loadSeed(),
    timed(rt.options.timing, 'guardian', fetchGuardian),
  ]);

  if (seed === null || seed.services.length === 0) return { kind: 'unavailable', contact };
  return {
    kind: 'ready',
    seed,
    guardian,
    config: rt.config,
    contact,
    rangeDays: rt.seed.RANGE_DAYS,
  };
}

/**
 * The manage page — the page the link in the confirmation e-mail opens.
 *
 * The path segment is a live bearer credential, so: the token is never in an
 * answer (only the paths built from it), an unknown token gets the same card
 * as a revoked one, and a Medal that could not be ASKED is `unreachable`
 * (retry this very page) rather than `unknown` (book a new one) — a parent who
 * came to move Thursday's appointment during a thirty-second outage must not
 * end up with two.
 *
 * The page must be `force-dynamic`, `noindex` and `referrer: no-referrer`.
 */
export async function loadManagePage(
  rt: BookingRuntime,
  token: string,
  switches: PageSwitches = {}
): Promise<ManagePageResult> {
  const contact = contactOf(rt, switches);
  const bookingHref = bookingHrefOf(rt, switches);
  const selfManagePath = rt.paths.managePath(token);

  let summary: Awaited<ReturnType<BookingRuntime['medal']['getManage']>> | null = null;
  try {
    summary = await rt.medal.getManage(token);
  } catch (error) {
    // A 404 is the ordinary case — an expired link, an erased booking — and
    // not worth a log line. Anything else is the business's problem, and the
    // error carries no token: the client redacts the path it was in.
    if (!(error instanceof MedalApiError) || error.status !== 404) {
      rt.logger.error({ err: error }, 'Manage summary could not be read');
      return { kind: 'unreachable', retryHref: selfManagePath, contact };
    }
  }

  const booking = summary === null ? null : toManageDto(summary);
  if (booking === null) return { kind: 'unknown', bookingHref, contact };

  return {
    kind: 'ready',
    booking,
    service: await bookedService(rt, booking.serviceId),
    actionPath: `${rt.config.paths.api}/manage/${encodeURIComponent(token)}`,
    selfManagePath,
    bookingHref,
    contact,
  };
}

/**
 * The catalogue entry for the booked service, for the weekend note on a new
 * slot (the manage payload carries the price charged but neither the base
 * price nor the surcharge). Best effort: no catalogue means no note.
 */
async function bookedService(
  rt: BookingRuntime,
  serviceId: string | null
): Promise<BookingServiceDto | null> {
  if (serviceId === null) return null;
  try {
    const services = await rt.medal.listServices();
    const found = services.find((service) => service.id === serviceId);
    return found ? rt.dto.toBookingServiceDto(found) : null;
  } catch (error) {
    rt.logger.warn({ err: error }, 'Could not read the service catalogue for the manage page');
    return null;
  }
}

/**
 * The portal dashboard.
 *
 * `disabled` when the portal is off (the page should redirect home);
 * `redirect` to the login without a session, and to the session-expired route
 * for one Medal no longer honours — a page cannot clear a cookie while
 * rendering, and the login would bounce a parent holding a dead one straight
 * back. `allSettled` rather than `all` for the two Medal reads, so a 502 on
 * one racing a 401 on the other cannot hide the dead session behind the
 * «unreachable» card.
 */
export async function loadPortalPage(
  rt: BookingRuntime,
  switches: PageSwitches = {}
): Promise<PortalPageResult> {
  if (!(await portalEnabled(rt))) return { kind: 'disabled' };
  const contact = contactOf(rt, switches);
  const session = await rt.session.readPortalSession();
  if (session === null) return { kind: 'redirect', href: rt.paths.portalLogin };

  const [stylists, vippsFlash, [profileResult, bookingsResult]] = await Promise.all([
    portalStylists(rt),
    rt.flash.readVippsLinkFlash(),
    Promise.allSettled([rt.portal.getMe(session), rt.portal.getMyBookings(session)]),
  ]);
  const failures = [profileResult, bookingsResult].flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );
  if (failures.some((error) => error instanceof PortalSessionExpiredError)) {
    return { kind: 'redirect', href: rt.paths.sessionExpired };
  }
  if (profileResult.status === 'rejected' || bookingsResult.status === 'rejected') {
    // The seam has scrubbed the session out of every error.
    for (const error of failures) {
      rt.logger.error({ err: error }, 'Portal profile or bookings could not be read');
    }
    return { kind: 'unreachable', contact };
  }
  return {
    kind: 'ready',
    profile: profileResult.value,
    bookings: bookingsResult.value,
    stylists,
    vippsFlash,
    bookingHref: bookingHrefOf(rt, switches),
    contact,
  };
}

/** The stylists a child card can name as preferred, in the business's order. */
async function portalStylists(rt: BookingRuntime): Promise<Array<{ id: string; name: string }>> {
  try {
    return (await rt.catalogue.cachedResources())
      .map(rt.dto.toBookingResourceDto)
      .filter((resource) => resource.name.trim() !== '')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((resource) => ({ id: resource.id, name: stylistDisplayName(resource.name) }));
  } catch (error) {
    rt.logger.warn({ err: error }, 'Could not read the stylists for the portal');
    return [];
  }
}
