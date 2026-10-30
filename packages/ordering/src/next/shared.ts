/**
 * What every ordering route shares: the lazily built SDK client, how a Medal
 * failure is recognised, the `{ error: { code, message } }` answer, the
 * site's `onError` hook that must never break a response, and the checks a
 * browser `POST` passes before its body is read (same origin, JSON, a capped
 * body) with the strict-shape helpers its body is read with.
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
 * key on first use (and kept), else `undefined` while no key is set. Each
 * attempt gives up after `attemptTimeoutMs` (a quote waits longer).
 */
export function lazyClient<Client>(
  options: Pick<RouteBaseOptions<Client>, 'apiKey' | 'baseUrl' | 'medal'>,
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS
): () => Client | Medal | undefined {
  let client: Client | Medal | undefined = options.medal;
  return () => {
    if (client) return client;
    const key = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    if (key === '') return undefined;
    client = new Medal(key, { baseUrl: options.baseUrl, timeout: attemptTimeoutMs });
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

/**
 * The guest's IP from the site's `clientIp(request)`, trimmed, or `undefined`
 * without one (no header is trusted by default). A throw from it is reported
 * and counts as none.
 */
export function readClientIp(
  clientIp: ((request: Request) => string | null | undefined) | undefined,
  request: Request,
  report: (error: unknown) => void
): string | undefined {
  if (!clientIp) return undefined;
  try {
    return clientIp(request)?.trim() || undefined;
  } catch (error) {
    report(error);
    return undefined;
  }
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

/**
 * Whether a location is configured at all: `undefined` or blank is not, so a
 * route that may serve every location does; anything else is checked by
 * `configuredLocation`.
 */
export function locationIsSet(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
}

/** A configured location id, trimmed, or `null` when unset, blank or over 64 characters. */
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
  /** A failed call in the site's words. Default `readFailure(error, notFound)`. */
  failure?: (error: unknown) => ErrorBody;
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
      return errorResponse(spec.failure ? spec.failure(error) : readFailure(error, spec.notFound));
    }
  };
}

/** Which origins a browser `POST` may come from (the `POST` routes' options). */
export interface SiteOriginOptions {
  /**
   * The site's own origin, or several (`'https://www.example.no'`). When set,
   * a browser's `Origin` must be one of them. Set it whenever `request.url`
   * may not be the address the browser used (a proxy in front of the app).
   */
  siteOrigin?: string | readonly string[];
  /**
   * Also accept the origin named by `x-forwarded-host` (its first entry) and
   * `x-forwarded-proto`, or `host`. Only behind a proxy that sets and
   * overwrites those headers: anything else that reaches the app can send
   * them. Default `false`.
   */
  trustForwardedHost?: boolean;
}

/** An `http(s)` origin, or `null`. */
function originOf(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
}

/** The origin `x-forwarded-host` / `host` (and `x-forwarded-proto`) name, or `null`. */
function forwardedOrigin(request: Request): string | null {
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
    ?.split(',')[0]
    ?.trim();
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || (local ? 'http' : 'https');
  return originOf(`${proto}://${host}`);
}

/**
 * `siteOrigin` checked once, when a route is created: each entry must be an
 * absolute `http(s)` URL (`'https://www.example.no'`, a path is ignored), or
 * the factory throws a `RangeError` naming it. A dropped entry would refuse
 * every order without a word, so a wrong one stops the site at start-up.
 * Answers the options with `siteOrigin` as a list of origins.
 */
export function checkSiteOrigin(
  options: SiteOriginOptions,
  factory: string
): { siteOrigin?: readonly string[]; trustForwardedHost?: boolean } {
  if (options.siteOrigin === undefined) return { trustForwardedHost: options.trustForwardedHost };
  const entries: readonly unknown[] =
    typeof options.siteOrigin === 'string' ? [options.siteOrigin] : options.siteOrigin;
  if (entries.length === 0) {
    throw new RangeError(`${factory}: siteOrigin is empty; leave it out or name the site's origin`);
  }
  const siteOrigin = entries.map((entry) => {
    const origin = typeof entry === 'string' ? originOf(entry.trim()) : null;
    if (origin === null) {
      throw new RangeError(
        `${factory}: siteOrigin ${JSON.stringify(entry)} is not an http(s) origin such as 'https://www.example.no'`
      );
    }
    return origin;
  });
  return { siteOrigin, trustForwardedHost: options.trustForwardedHost };
}

/**
 * The origins a browser `POST` may carry: the configured `siteOrigin`
 * (already checked by `checkSiteOrigin`), else `request.url`'s. Forwarded
 * headers count only with `trustForwardedHost`: a request that does not come
 * through a proxy that overwrites them could name any host there and so make
 * any `Origin` look like the site's own. They are never a fallback.
 */
function allowedOrigins(
  request: Request,
  options: ReturnType<typeof checkSiteOrigin>
): Set<string> {
  const allowed = new Set<string>(options.siteOrigin ?? [new URL(request.url).origin]);
  if (options.trustForwardedHost) {
    const forwarded = forwardedOrigin(request);
    if (forwarded) allowed.add(forwarded);
  }
  return allowed;
}

/** The media type of a `Content-Type`, without parameters, lower-cased. */
function mediaType(header: string | null): string {
  const [type = ''] = (header ?? '').split(';');
  return type.trim().toLowerCase();
}

/**
 * A browser `POST`'s first checks, before its body is read: an `Origin`, when
 * sent, must be the site's own (`allowedOrigins`; `crossOrigin`, a 403) — a page on another
 * site cannot post with the visitor's browser — and the body must be
 * `application/json` (`notJson`, a 415), which a cross-site form cannot send
 * without a CORS preflight. `null` when both pass.
 */
export function postGuard(
  request: Request,
  refusals: { crossOrigin: ErrorBody; notJson: ErrorBody },
  options: ReturnType<typeof checkSiteOrigin> = {}
): ErrorBody | null {
  const origin = request.headers.get('origin');
  if (origin !== null && !allowedOrigins(request, options).has(origin)) return refusals.crossOrigin;
  if (mediaType(request.headers.get('content-type')) !== 'application/json') {
    return refusals.notJson;
  }
  return null;
}

/** How long a `POST` body may take to arrive, all of it. */
export const BODY_DEADLINE_MS = 10_000;

/** The body did not arrive within the deadline, or the visitor left. */
export class BodyTimeoutError extends Error {
  constructor() {
    super('The request body did not arrive in time');
    this.name = 'BodyTimeoutError';
  }
}

/** A body that did not arrive in time: `408`, before any Medal call. */
export const SLOW_BODY: ErrorBody = {
  status: 408,
  code: 'INVALID_REQUEST',
  message: 'The request did not arrive in time.',
};

/**
 * The body as text, or `null` when it is over `maxBytes`. Read chunk by
 * chunk so an endless body stops at the cap; a declared `Content-Length`
 * over it is refused without reading. A body still arriving after
 * `deadlineMs`, or one the visitor abandons, is cancelled and rejects with
 * `BodyTimeoutError`, so a slow sender cannot hold the route open. Rejects
 * for a failing stream or bytes that are not UTF-8.
 */
export async function readBody(
  request: Request,
  maxBytes: number,
  deadlineMs: number = BODY_DEADLINE_MS
): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > maxBytes) return null;
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  if (request.body) {
    const reader = request.body.getReader();
    const stop = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)]);
    let reject!: (error: BodyTimeoutError) => void;
    const stopped = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const onStop = () => reject(new BodyTimeoutError());
    stop.addEventListener('abort', onStop, { once: true });
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), stopped]);
        if (done) break;
        if (length + value.byteLength > maxBytes) {
          await reader.cancel();
          return null;
        }
        bytes.set(value, length);
        length += value.byteLength;
      }
    } catch (error) {
      // Stop the stream on any failure, the deadline included; a cancel that fails changes nothing.
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      stop.removeEventListener('abort', onStop);
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
}

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A plain object with only these keys. */
export function only(value: unknown, keys: readonly string[]): value is Json {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

/** Absent, or a value `check` takes. `null` is not absent: Medal omits, never nulls. */
export function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

export const isString = (value: unknown): value is string => typeof value === 'string';
