/**
 * `@medalsocial/booking/next` — the server half of a Medal booking site, for
 * Next.js 16. Server-only: importing it from a client component fails the
 * build.
 *
 * - `createBookingServer(options)` — the handler, the page loaders and the
 *   portal over one runtime.
 * - `createBookingHandler(options)` — `{ GET, POST, DELETE }` for every
 *   booking and portal API route.
 * - `loadBookingPage` / `loadManagePage` / `loadPortalPage` — what each page
 *   needs before it renders.
 * - `createPortal(options)` — the session cookie, the portal's action
 *   functions (wrap each in a `'use server'` export) and the Vipps return
 *   routes.
 * - `createMedalSeam` — the Medal client the rest is built on.
 *
 * Cache adapters live in their own entries: `/next/cache/workers`,
 * `/next/cache/memory`, `/next/cache/next-data`, `/next/cache/noop`.
 */

import 'server-only';

export type { Catalogue, ReadOptions } from './catalogue';
export { CATALOGUE_TAG, createCatalogue, slotKeyStart, slotsTag } from './catalogue';
export type { BookingHandler } from './handler';
export type {
  BookingContact,
  BookingPageResult,
  ManagePageResult,
  PageSwitches,
  PortalPageResult,
} from './loaders';
export { toManageDto } from './manage-dto';
export type {
  CreateBookingBody,
  CreateBookingResult,
  MedalSeam,
  MedalSeamOptions,
  RangeArgs,
  RecordConsentBody,
  RescheduleResult,
} from './medal';
export {
  createMedalSeam,
  DEFAULT_MEDAL_ENDPOINT,
  looksLikePlaceholderKey,
  MedalApiError,
  MedalConfigError,
} from './medal';
export type {
  BookingCacheAdapter,
  BookingLogger,
  BookingPortalServerOptions,
  BookingRateLimit,
  BookingServerOptions,
  BookingTiming,
  BookingTimingPhase,
  PortalMessages,
} from './options';
export { DEFAULT_EDGE_PREFIX, DEFAULT_PORTAL_MESSAGES } from './options';
export type {
  InvalidInput,
  PersonActionResult,
  Portal,
  PortalActions,
  PortalSchemas,
  SessionFailure,
  UpdateProfileResult,
  VerifyLoginResult,
  VippsLinkStartState,
  VippsStartState,
} from './portal';
export { toBookingFamilyMember } from './portal/guardian';
export type {
  PersonTarget,
  PortalPersonInput,
  PortalPersonResult,
  PortalSeam,
  VippsLinkCompletion,
} from './portal/medal-portal';
export {
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
  PortalVippsConflictError,
  PortalVippsUnavailableError,
} from './portal/medal-portal';
export type { PortalSession } from './portal/session';
export { RENEWED_SESSION_LIFETIME_MS } from './portal/session';
export type { VippsLinkFlash } from './portal/vipps-flash';
export { VIPPS_LINK_FLASHES, vippsLinkFlash } from './portal/vipps-flash';
export { isCrossOriginRequest, originFromHeaders, readBoundedText } from './request';
export type { BookingRuntime } from './runtime';
export { createBookingRuntime } from './runtime';
export type { BookingCatalogue, BookingSeed, Seed, SeedState } from './seed';
export { createSeed, SEED_RECHECK_MS, SEED_STALE_MAX_MS } from './seed';
export type { BookingServer } from './server';
export {
  createBookingHandler,
  createBookingServer,
  createPortal,
  loadBookingPage,
  loadManagePage,
  loadPortalPage,
} from './server';
