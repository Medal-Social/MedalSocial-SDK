/**
 * The slots route: the pickup or delivery times a guest can pick on one
 * service date, read through the site so the API key stays on the server.
 *
 * ```ts
 * // app/api/ordering/slots/route.ts
 * export const GET = createSlotsRoute({
 *   apiKey: process.env.MEDAL_API_KEY!,
 *   location: process.env.MEDAL_ORDERING_LOCATION!,
 * });
 * ```
 *
 * `GET ?channel=takeaway&date=2026-10-23` answers `{ data: OrderingSlots }`.
 * The location comes from the options only — a visitor cannot ask about
 * another one. The channel and date are checked here, so a bad query never
 * costs a Medal call. Every visitor sees the same slots, so a CDN may keep
 * them a minute (`public, s-maxage=60`).
 */

import type { OrderingSlots, OrderingSlotsOptions } from '@medalsocial/sdk';
import { parseChannel } from '../core/deep-link';
import {
  configuredLocation,
  invalidRequest,
  NOT_CONFIGURED,
  type RouteBaseOptions,
  readRoute,
  reporter,
} from './shared';

/** The slice of the SDK client the route uses — what a test injects. */
export interface SlotsClient {
  ordering: {
    slots(
      options: OrderingSlotsOptions,
      request?: { signal?: AbortSignal }
    ): Promise<{ data: OrderingSlots }>;
  };
}

export interface SlotsRouteOptions extends RouteBaseOptions<SlotsClient> {
  /**
   * The ordering location (`process.env.MEDAL_ORDERING_LOCATION`). Never taken
   * from the request. Checked per request: unset answers `500 NOT_CONFIGURED`.
   */
  location: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `yyyy-mm-dd` that is a real calendar date. */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** A Next App Router `GET` handler serving `{ data: OrderingSlots }`. */
export function createSlotsRoute(
  options: SlotsRouteOptions
): (request: Request) => Promise<Response> {
  const report = reporter(options.onError);
  return readRoute<SlotsClient, OrderingSlotsOptions>(options, {
    parse(request) {
      const params = new URL(request.url).searchParams;
      const channel = parseChannel(params.get('channel'));
      if (channel === null) {
        return { error: invalidRequest('channel must be dine_in, takeaway or delivery.') };
      }
      const date = params.get('date')?.trim() ?? '';
      if (!isDate(date)) return { error: invalidRequest('date must be a yyyy-mm-dd date.') };
      const location = configuredLocation(options.location);
      if (location === null) {
        report(new Error('The ordering location is not configured'));
        return { error: NOT_CONFIGURED };
      }
      return { args: { location, channel, date } };
    },
    call: (api, args, signal) => api.ordering.slots(args, { signal }),
    // The configured location is not one Medal knows.
    notFound: NOT_CONFIGURED,
    cacheControl: 'public, s-maxage=60',
  });
}
