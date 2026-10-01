/**
 * One call that wires a booking site's server half.
 *
 * ```ts
 * // lib/booking/server.ts
 * import 'server-only';
 * import { createBookingServer } from '@medalsocial/booking/next';
 * export const booking = createBookingServer({ config, medal, cache, … });
 *
 * // app/api/booking/[...path]/route.ts (and app/api/portal/[...path]/route.ts)
 * export const { GET, POST, DELETE } = booking.handler;
 * ```
 *
 * The handler, the loaders and the portal share one runtime, so in-flight
 * refreshes and Medal clients are shared too. The standalone functions
 * (`createBookingHandler`, `loadBookingPage`, …) reuse the runtime built for
 * the same options object.
 */

import { createBookingHandlerFor } from './handler';
import {
  type BookingPageResult,
  loadBookingPage as loadBookingPageFor,
  loadManagePage as loadManagePageFor,
  loadPortalPage as loadPortalPageFor,
  type ManagePageResult,
  type PageSwitches,
  type PortalPageResult,
} from './loaders';
import type { BookingServerOptions } from './options';
import { createPortalFor, type Portal } from './portal';
import { type BookingRuntime, createBookingRuntime } from './runtime';

const RUNTIMES = new WeakMap<BookingServerOptions, BookingRuntime>();

function runtimeFor(options: BookingServerOptions): BookingRuntime {
  const known = RUNTIMES.get(options);
  if (known) return known;
  const built = createBookingRuntime(options);
  RUNTIMES.set(options, built);
  return built;
}

type SearchParams = Record<string, string | string[] | undefined>;

export interface BookingServer {
  handler: ReturnType<typeof createBookingHandlerFor>;
  portal: Portal;
  loadBookingPage(
    args?: PageSwitches & { searchParams?: SearchParams }
  ): Promise<BookingPageResult>;
  loadManagePage(token: string, switches?: PageSwitches): Promise<ManagePageResult>;
  loadPortalPage(switches?: PageSwitches): Promise<PortalPageResult>;
}

export function createBookingServer(options: BookingServerOptions): BookingServer {
  return serverFor(runtimeFor(options));
}

/** The same, over a runtime the caller built (tests, unusual wiring). */
export function serverFor(rt: BookingRuntime): BookingServer {
  return {
    handler: createBookingHandlerFor(rt),
    portal: createPortalFor(rt),
    loadBookingPage: (args) => loadBookingPageFor(rt, args),
    loadManagePage: (token, switches) => loadManagePageFor(rt, token, switches),
    loadPortalPage: (switches) => loadPortalPageFor(rt, switches),
  };
}

export function createBookingHandler(options: BookingServerOptions) {
  return createBookingHandlerFor(runtimeFor(options));
}

export function createPortal(options: BookingServerOptions): Portal {
  return createPortalFor(runtimeFor(options));
}

export function loadBookingPage(
  options: BookingServerOptions,
  args?: PageSwitches & { searchParams?: SearchParams }
): Promise<BookingPageResult> {
  return loadBookingPageFor(runtimeFor(options), args);
}

export function loadManagePage(
  options: BookingServerOptions,
  token: string,
  switches?: PageSwitches
): Promise<ManagePageResult> {
  return loadManagePageFor(runtimeFor(options), token, switches);
}

export function loadPortalPage(
  options: BookingServerOptions,
  switches?: PageSwitches
): Promise<PortalPageResult> {
  return loadPortalPageFor(runtimeFor(options), switches);
}
