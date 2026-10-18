/**
 * One drop-in handler for every booking and portal API route.
 *
 * An app mounts it on two catch-alls and is done:
 *
 * ```ts
 * // app/api/booking/[...path]/route.ts and app/api/portal/[...path]/route.ts
 * export const { GET, POST, DELETE } = booking.handler;
 * ```
 *
 * It dispatches on the path after `config.paths.api` / `config.paths.portalApi`:
 *
 * | Path (after the prefix) | Methods |
 * |---|---|
 * | `services`, `resources`, `availability`, `schedule`, `next-free` | GET |
 * | `avatar/<resourceId>` | GET |
 * | `create` | POST |
 * | `manage/<token>` | GET (the booking), POST (`cancel` / `reschedule`) |
 * | portal `login/verify`, `persons`, `session/touch`, `vipps/link/verify` | POST |
 * | portal `session/expired` | GET |
 * | portal `vipps/flash` | DELETE |
 *
 * Static routes in the app still win over the catch-all in Next, so a site
 * keeps any route of its own beside these.
 */

import { NextResponse } from 'next/server';
import { calendarRoute } from './routes/calendar';
import {
  availabilityRoute,
  avatarRoute,
  nextFreeRoute,
  resourcesRoute,
  scheduleRoute,
  servicesRoute,
} from './routes/catalogue-routes';
import { createRoute } from './routes/create';
import { manageRoute, manageSummaryRoute } from './routes/manage';
import {
  loginVerifyRoute,
  personsRoute,
  sessionExpiredRoute,
  sessionTouchRoute,
  vippsFlashRoute,
  vippsLinkVerifyRoute,
} from './routes/portal-routes';
import { bookingErrorResponse } from './routes/shared';
import type { BookingRuntime } from './runtime';

type Method = 'GET' | 'POST' | 'DELETE';

type Route = (rt: BookingRuntime, request: Request, segment: string) => Promise<Response>;

interface Match {
  scope: string;
  routes: Partial<Record<Method, Route>>;
  /** The decoded trailing segment, for `avatar/<id>` and `manage/<token>`. */
  segment: string;
}

const BOOKING_ROUTES: Record<string, Partial<Record<Method, Route>>> = {
  services: { GET: (rt) => servicesRoute(rt) },
  resources: { GET: (rt, request) => resourcesRoute(rt, request) },
  availability: { GET: (rt, request) => availabilityRoute(rt, request) },
  schedule: { GET: (rt, request) => scheduleRoute(rt, request) },
  'next-free': { GET: (rt) => nextFreeRoute(rt) },
  create: { POST: (rt, request) => createRoute(rt, request) },
};

const BOOKING_PARAM_ROUTES: Record<string, Partial<Record<Method, Route>>> = {
  avatar: { GET: (rt, request, segment) => avatarRoute(rt, request, segment) },
  calendar: { GET: (rt, request, segment) => calendarRoute(rt, request, segment) },
  manage: {
    GET: (rt, request, segment) => manageSummaryRoute(rt, request, segment),
    POST: (rt, request, segment) => manageRoute(rt, request, segment),
  },
};

const PORTAL_ROUTES: Record<string, Partial<Record<Method, Route>>> = {
  'login/verify': { POST: (rt, request) => loginVerifyRoute(rt, request) },
  persons: { POST: (rt, request) => personsRoute(rt, request) },
  'session/touch': { POST: (rt) => sessionTouchRoute(rt) },
  'session/expired': { GET: (rt, request) => sessionExpiredRoute(rt, request) },
  'vipps/flash': { DELETE: (rt, request) => vippsFlashRoute(rt, request) },
  'vipps/link/verify': { POST: (rt, request) => vippsLinkVerifyRoute(rt, request) },
};

/** The rest of `pathname` after `prefix`, or `null` when it is not under it. */
function under(pathname: string, prefix: string): string | null {
  const base = prefix.replace(/\/+$/, '');
  if (!pathname.startsWith(`${base}/`)) return null;
  return pathname.slice(base.length + 1).replace(/\/+$/, '');
}

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function matchBooking(rest: string): Match | 'malformed' | null {
  const fixed = BOOKING_ROUTES[rest];
  if (fixed) return { scope: `booking/${rest}`, routes: fixed, segment: '' };
  const slash = rest.indexOf('/');
  if (slash > 0) {
    const head = rest.slice(0, slash);
    const tail = rest.slice(slash + 1);
    const routes = BOOKING_PARAM_ROUTES[head];
    if (routes && tail !== '' && !tail.includes('/')) {
      const segment = decoded(tail);
      if (segment === null) return 'malformed';
      return { scope: `booking/${head}`, routes, segment };
    }
  }
  return null;
}

function matchPortal(rest: string): Match | null {
  const routes = PORTAL_ROUTES[rest];
  return routes ? { scope: `portal/${rest}`, routes, segment: '' } : null;
}

/**
 * The route a path names. The LONGER prefix is tried first, so a portal API
 * nested under the booking API (`/api` and `/api/portal`) still reaches the
 * portal routes, and the other way round.
 */
function match(rt: BookingRuntime, pathname: string): Match | 'malformed' | null {
  const { api, portalApi } = rt.config.paths;
  const prefixes = [
    { prefix: api, find: matchBooking },
    { prefix: portalApi, find: matchPortal },
  ].sort((a, b) => b.prefix.replace(/\/+$/, '').length - a.prefix.replace(/\/+$/, '').length);
  for (const { prefix, find } of prefixes) {
    const rest = under(pathname, prefix);
    if (rest === null) continue;
    const found = find(rest);
    if (found !== null) return found;
  }
  return null;
}

export interface BookingHandler {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>;
}

/**
 * Answers that are part of the flow rather than a fault: a taken slot or a
 * replayed submission (409), an expired portal session (401), a manage link or
 * path that no longer resolves (404). Counted at `info`; everything else is
 * `warn`, and a 5xx is `error`.
 */
const EXPECTED_STATUSES = new Set([401, 404, 409]);

/**
 * The refusal's code from a response body: `error` on the booking routes,
 * `reason` on the portal routes — both fixed codes. Nothing else in the body
 * is read.
 */
export function failureCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { error, reason } = body as { error?: unknown; reason?: unknown };
  if (typeof error === 'string') return error;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * One line per refused or failed answer, so a fault shows in the site's logs
 * the night it starts. The route had every 400 to itself: when the range guard
 * refused every unseeded service for eight weeks of nights, nothing anywhere
 * said so.
 *
 * Only the route, the method, the status and the response's error CODE go out.
 * Not its `message`: most are the package's fixed strings, but the portal's
 * person route relays the engine's validation text about what the visitor
 * typed. The rate limiter's own 429 is not logged at all — the requests it
 * refuses are the flood, and a line each would bury the faults.
 */
async function logFailure(
  rt: BookingRuntime,
  route: string,
  method: Method,
  response: Response
): Promise<void> {
  const { status } = response;
  if (status < 400) return;
  let code: string | undefined;
  try {
    code = failureCode(await response.clone().json());
  } catch {
    // A body that is not JSON still gets its line, without the code.
  }
  const meta = { route, method, status, code };
  const line = `booking ${method} ${route} answered ${status}`;
  if (status >= 500) rt.logger.error(meta, line);
  else if (EXPECTED_STATUSES.has(status)) rt.logger.info(meta, line);
  else rt.logger.warn(meta, line);
}

/** The handler over an existing runtime (what `createBookingServer` shares). */
export function createBookingHandlerFor(rt: BookingRuntime): BookingHandler {
  async function dispatch(
    method: Method,
    request: Request,
    found: Match | 'malformed' | null
  ): Promise<Response | null> {
    if (found === 'malformed')
      return bookingErrorResponse('invalidInput', 400, 'path is malformed');
    if (found === null) return bookingErrorResponse('notFound', 404);
    const route = found.routes[method];
    if (!route) {
      const response = bookingErrorResponse('methodNotAllowed', 405);
      response.headers.set('Allow', Object.keys(found.routes).join(', '));
      return response;
    }
    if (rt.options.rateLimit && (await rt.options.rateLimit(found.scope, request))) return null;
    return route(rt, request, found.segment);
  }

  async function handle(method: Method, request: Request): Promise<Response> {
    const found = match(rt, new URL(request.url).pathname);
    const response = await dispatch(method, request, found);
    if (response === null) {
      // Refused by the site's rate limiter: answered, never logged (`logFailure`).
      return NextResponse.json(
        { error: 'rateLimited' },
        { status: 429, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    // A path the package does not know is logged under a fixed label, never by
    // its path: an unmatched path can still carry a manage token
    // (`manage/<token>/x`). A client and a server on different package versions
    // look exactly like this, which is why it is logged at all.
    const route = found === 'malformed' ? 'malformed' : found === null ? 'unmatched' : found.scope;
    await logFailure(rt, route, method, response);
    return response;
  }

  return {
    GET: (request) => handle('GET', request),
    POST: (request) => handle('POST', request),
    DELETE: (request) => handle('DELETE', request),
  };
}
