/**
 * The locations route: every location that takes online orders with each
 * channel's state right now, read through the site so the API key stays on
 * the server.
 *
 * ```ts
 * // app/api/ordering/locations/route.ts
 * export const GET = createLocationsRoute({
 *   apiKey: process.env.MEDAL_API_KEY!,
 *   location: process.env.MEDAL_ORDERING_LOCATION,
 * });
 * ```
 *
 * `GET` answers `{ data: OrderingLocations }`; with `location` set, only that
 * location is listed (none when Medal no longer lists it — it takes no
 * online orders). The open state changes by the minute but every visitor
 * sees the same one, so the answer is kept 15 s in this process (visitors
 * arriving while Medal is asked share the call) and a CDN may keep it 15 s
 * more (`public, s-maxage=15, stale-while-revalidate=30`). A failure is
 * never cached.
 */

import type { OrderingLocations } from '@medalsocial/sdk';
import {
  configuredLocation,
  dataResponse,
  errorResponse,
  lazyClient,
  locationIsSet,
  NOT_CONFIGURED,
  READ_DEADLINE_MS,
  type RouteBaseOptions,
  readFailure,
  reporter,
} from './shared';

/** How long the process keeps the locations, in ms. */
const CACHE_MS = 15_000;

const CACHE_CONTROL = 'public, s-maxage=15, stale-while-revalidate=30';

/** The slice of the SDK client the route uses — what a test injects. */
export interface LocationsClient {
  ordering: {
    locations(request?: { signal?: AbortSignal }): Promise<{ data: OrderingLocations }>;
  };
}

export interface LocationsRouteOptions extends RouteBaseOptions<LocationsClient> {
  /** List only this location. Never taken from the request. Default: every location. */
  location?: string;
}

/** A Next App Router `GET` handler serving `{ data: OrderingLocations }`. */
export function createLocationsRoute(
  options: LocationsRouteOptions
): (request: Request) => Promise<Response> {
  const medal = lazyClient(options);
  const report = reporter(options.onError);
  let cached: { data: OrderingLocations; at: number } | undefined;
  let inflight: Promise<OrderingLocations> | undefined;

  /**
   * One read from Medal. Not tied to the visitor's request signal: it is
   * shared, and one visitor leaving must not cancel it for the rest.
   */
  async function fetchLocations(api: LocationsClient): Promise<OrderingLocations> {
    try {
      const { data } = await api.ordering.locations({
        signal: AbortSignal.timeout(READ_DEADLINE_MS),
      });
      cached = { data, at: Date.now() };
      return data;
    } catch (error) {
      report(error);
      throw error;
    }
  }

  function current(api: LocationsClient): Promise<OrderingLocations> {
    if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.data);
    inflight ??= fetchLocations(api).finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  return async function GET(_request: Request): Promise<Response> {
    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }
    const only = locationIsSet(options.location) ? configuredLocation(options.location) : undefined;
    if (only === null) {
      // Set but not a location id: refuse rather than list every location.
      report(new Error('The ordering location is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }
    let data: OrderingLocations;
    try {
      data = await current(api);
    } catch (error) {
      return errorResponse(readFailure(error, null));
    }
    const listed =
      only === undefined
        ? data
        : { ...data, locations: data.locations.filter((l) => l.id === only) };
    return dataResponse(listed, CACHE_CONTROL);
  };
}
