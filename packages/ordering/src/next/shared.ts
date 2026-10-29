/**
 * What every ordering route shares: the lazily built SDK client, how a Medal
 * failure is recognised, the `{ error: { code, message } }` answer and the
 * site's `onError` hook that must never break a response.
 */

import { Medal, MedalApiError } from '@medalsocial/sdk';

/** One attempt at Medal; the SDK retries 429/5xx within each route's deadline. */
export const ATTEMPT_TIMEOUT_MS = 5_000;

/** A read route's whole upstream call, retries included. */
export const READ_DEADLINE_MS = 8_000;

/** What every route factory takes besides its own options. */
export interface RouteBaseOptions<Client> {
  /**
   * The workspace API key (`process.env.MEDAL_API_KEY`). Checked on the first
   * request, so a build without it still succeeds; a missing key answers
   * `500 NOT_CONFIGURED`.
   */
  apiKey: string;
  /** The Medal API origin. Default: the SDK's (`https://io.medalsocial.com`). */
  baseUrl?: string;
  /** A ready client instead of one built from `apiKey`/`baseUrl` (tests, custom setups). */
  medal?: Client;
  /**
   * Told about every failed Medal call (the SDK's error, unchanged — SDK
   * errors carry no request headers). For the site's logger; a throw here is
   * ignored.
   */
  onError?: (error: unknown) => void;
}

/**
 * The client to call Medal with: the injected one, else one built from the
 * key on first use (and kept), else `undefined` while no key is set.
 */
export function lazyClient<Client>(
  options: Pick<RouteBaseOptions<Client>, 'apiKey' | 'baseUrl' | 'medal'>
): () => Client | Medal | undefined {
  let client: Client | Medal | undefined = options.medal;
  return () => {
    if (client) return client;
    const key = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    if (key === '') return undefined;
    client = new Medal(key, { baseUrl: options.baseUrl, timeout: ATTEMPT_TIMEOUT_MS });
    return client;
  };
}

/** The site's `onError`, made safe: a throw from it is swallowed. */
export function reporter(
  onError: ((error: unknown) => void) | undefined
): (error: unknown) => void {
  return (error) => {
    try {
      onError?.(error);
    } catch {
      // The site's logger failing must not turn into a failed response.
    }
  };
}

/** The parts of a Medal API failure the routes read. */
export interface ApiFailure {
  status: number;
  code: unknown;
  details?: unknown;
  retryAfterMs?: unknown;
}

/**
 * `error` as an API failure, or `null`. Besides `instanceof`, an error named
 * `MedalApiError` with a numeric `status` counts: a site with two copies of
 * the SDK installed throws the other copy's class.
 */
export function apiFailure(error: unknown): ApiFailure | null {
  if (error instanceof MedalApiError) return error;
  if (
    error instanceof Error &&
    error.name === 'MedalApiError' &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return error as unknown as ApiFailure;
  }
  return null;
}

/** A route's error answer before it becomes a `Response`. */
export interface ErrorBody {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** `{ error: { code, message, details? } }`, never cached. */
export function errorResponse({ status, code, message, details, headers }: ErrorBody): Response {
  return Response.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status, headers: { ...headers, 'cache-control': 'no-store' } }
  );
}

/** `{ data }` with the given `Cache-Control`. */
export function dataResponse(data: unknown, cacheControl: string, status = 200): Response {
  return Response.json({ data }, { status, headers: { 'cache-control': cacheControl } });
}

/** The visitor's request signal and a deadline: whichever fires first aborts the call. */
export function deadline(request: Request, ms: number): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(ms)]);
}

/** The API's cap on an order id. */
const MAX_ID_LENGTH = 64;

/**
 * An order id from the query, trimmed, or `null` when missing, blank, over
 * 64 characters or a dot segment (which the SDK refuses before any call).
 */
export function readOrderId(value: string | null): string | null {
  const id = value?.trim() ?? '';
  if (id === '' || id.length > MAX_ID_LENGTH || id === '.' || id === '..') return null;
  return id;
}

/** The API's cap on a location id. */
const MAX_LOCATION_LENGTH = 64;

/** A configured location id, trimmed, or `null` when unset, blank or over 64 characters. */
/**
 * Whether a location is configured at all: `undefined` or blank is not, so a
 * route that may serve every location does; anything else is checked by
 * `configuredLocation`.
 */
export function locationIsSet(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
}

export function configuredLocation(value: unknown): string | null {
  const location = typeof value === 'string' ? value.trim() : '';
  return location === '' || location.length > MAX_LOCATION_LENGTH ? null : location;
}

/** No key, or no location: the site is not set up for ordering. */
export const NOT_CONFIGURED: ErrorBody = {
  status: 500,
  code: 'NOT_CONFIGURED',
  message: 'Ordering is not configured.',
};

/** The query is not one the route takes. */
export function invalidRequest(message: string): ErrorBody {
  return { status: 400, code: 'INVALID_REQUEST', message };
}

const UNAVAILABLE_NOW = 'Ordering is not available right now.';

/**
 * A failed Medal read in the site's words. `notFound` answers a Medal 404
 * (`null`: a 404 is a Medal failure like any other).
 *
 * - `ORDERING_NOT_ENABLED` → `404`: the workspace has no online ordering, and
 *   a 5xx would tell clients and CDNs to keep retrying something that will
 *   not come back on its own.
 * - `400` → `400 INVALID_REQUEST`.
 * - `429` → `503 SERVICE_UNAVAILABLE`: the site's own key is over its limit,
 *   not the visitor.
 * - anything else (5xx, network, timeout, a rejected key) →
 *   `502 SERVICE_UNAVAILABLE`.
 */
export function readFailure(error: unknown, notFound: ErrorBody | null): ErrorBody {
  const failure = apiFailure(error);
  if (failure) {
    if (failure.code === 'ORDERING_NOT_ENABLED') {
      return {
        status: 404,
        code: 'ORDERING_NOT_ENABLED',
        message: 'Online ordering is not enabled.',
      };
    }
    if (failure.status === 404 && notFound) return notFound;
    if (failure.status === 400) return invalidRequest('The request was not valid.');
    if (failure.status === 429) {
      return { status: 503, code: 'SERVICE_UNAVAILABLE', message: UNAVAILABLE_NOW };
    }
  }
  return { status: 502, code: 'SERVICE_UNAVAILABLE', message: UNAVAILABLE_NOW };
}

/** What a read route does with one request. */
export interface ReadSpec<Client, Args> {
  /** The checked query, or the error to answer without calling Medal. */
  parse(request: Request): { args: Args } | { error: ErrorBody };
  /** The Medal call. */
  call(api: Client | Medal, args: Args, signal: AbortSignal): Promise<{ data: unknown }>;
  /** What a Medal 404 means here, or `null`. */
  notFound: ErrorBody | null;
  /** `Cache-Control` of a success. */
  cacheControl: string;
}

/**
 * A `GET` handler that checks the query, calls Medal once (the SDK's own
 * retries aside) within the read deadline or until the visitor leaves, and
 * answers `{ data }` or a fixed-word error.
 */
export function readRoute<Client, Args>(
  options: RouteBaseOptions<Client>,
  spec: ReadSpec<Client, Args>
): (request: Request) => Promise<Response> {
  const medal = lazyClient(options);
  const report = reporter(options.onError);
  return async function GET(request: Request): Promise<Response> {
    const parsed = spec.parse(request);
    if ('error' in parsed) return errorResponse(parsed.error);
    const api = medal();
    if (!api) {
      report(new Error('The Medal API key is not configured'));
      return errorResponse(NOT_CONFIGURED);
    }
    try {
      const { data } = await spec.call(api, parsed.args, deadline(request, READ_DEADLINE_MS));
      return dataResponse(data, spec.cacheControl);
    } catch (error) {
      report(error);
      return errorResponse(readFailure(error, spec.notFound));
    }
  };
}
