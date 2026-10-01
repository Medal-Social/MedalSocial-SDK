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

function match(rt: BookingRuntime, pathname: string): Match | 'malformed' | null {
  const booking = under(pathname, rt.config.paths.api);
  if (booking !== null) {
    const fixed = BOOKING_ROUTES[booking];
    if (fixed) return { scope: `booking/${booking}`, routes: fixed, segment: '' };
    const slash = booking.indexOf('/');
    if (slash > 0) {
      const head = booking.slice(0, slash);
      const tail = booking.slice(slash + 1);
      const routes = BOOKING_PARAM_ROUTES[head];
      if (routes && tail !== '' && !tail.includes('/')) {
        const segment = decoded(tail);
        if (segment === null) return 'malformed';
        return { scope: `booking/${head}`, routes, segment };
      }
    }
    return null;
  }
  const portal = under(pathname, rt.config.paths.portalApi);
  if (portal !== null) {
    const routes = PORTAL_ROUTES[portal];
    return routes ? { scope: `portal/${portal}`, routes, segment: '' } : null;
  }
  return null;
}

export interface BookingHandler {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>;
}

/** The handler over an existing runtime (what `createBookingServer` shares). */
export function createBookingHandlerFor(rt: BookingRuntime): BookingHandler {
  async function handle(method: Method, request: Request): Promise<Response> {
    const found = match(rt, new URL(request.url).pathname);
    if (found === 'malformed')
      return bookingErrorResponse('invalidInput', 400, 'path is malformed');
    if (found === null) return bookingErrorResponse('notFound', 404);
    const route = found.routes[method];
    if (!route) {
      const response = bookingErrorResponse('methodNotAllowed', 405);
      response.headers.set('Allow', Object.keys(found.routes).join(', '));
      return response;
    }
    if (rt.options.rateLimit && (await rt.options.rateLimit(found.scope, request))) {
      return NextResponse.json(
        { error: 'rateLimited' },
        { status: 429, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return route(rt, request, found.segment);
  }

  return {
    GET: (request) => handle('GET', request),
    POST: (request) => handle('POST', request),
    DELETE: (request) => handle('DELETE', request),
  };
}
