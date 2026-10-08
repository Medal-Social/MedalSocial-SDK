/**
 * The booking seam: everything a booking site asks Medal, in the site's own
 * terms.
 *
 * Backed by `@medalsocial/sdk`, which owns the wire format, auth, timeouts and
 * 429/5xx retries. What stays here is the handful of decisions that are the
 * deployment's to make and must not become a per-call option for whoever
 * calls in: `created_via: 'web'` forced last, a 200 that is not JSON treated
 * as a failure, the manage summary narrowed, and a missing or placeholder key
 * failing loudly as `MedalConfigError` instead of a confusing 401.
 *
 * THE KEY IS THE APP'S. The package reads no environment variable. A site
 * passes its key — or, where the platform only fills `process.env` per
 * request (OpenNext on Cloudflare Workers), a function that reads it — and
 * the seam reads it again on every call, re-keying its client when it
 * changes rather than pinning the first one an isolate saw.
 */

import type {
  BookingClaimableCreatedVia,
  CreateBookingInput,
  RecordConsentInput,
} from '@medalsocial/sdk';
import { Medal, MedalApiError } from '@medalsocial/sdk';
import type {
  MedalManageSummary,
  MedalResource,
  MedalScheduleDay,
  MedalService,
  MedalSlot,
} from '../core/wire';
import { redactSession } from './redact';

export { MedalApiError };

export class MedalConfigError extends Error {
  constructor(message: string) {
    super(message);
    // `extends Error` leaves `name` as "Error"; an uncaught one in a Workers
    // log would then say nothing about where to look.
    this.name = 'MedalConfigError';
  }
}

/**
 * Medal's HTTP-actions origin. `app.medalsocial.com` is the dashboard and
 * answers `/api/v1/...` with its own 200 HTML "Page not found", so a wrong
 * value fails as a JSON parse error several layers from the cause. A
 * deployment should pass its origin explicitly; this is only ever reached by
 * a run started without one — exactly when a wrong default costs most.
 */
export const DEFAULT_MEDAL_ENDPOINT = 'https://io.medalsocial.com';

/** A value, or a function that reads it when it is needed. */
type Lazy<T> = T | (() => T);

export interface MedalSeamOptions {
  apiKey: Lazy<string | undefined>;
  baseUrl?: Lazy<string | undefined>;
}

/**
 * Whether a key is a secret manager's placeholder rather than a key. Secret
 * stores seed new folders with values like `pending…`, so a deployment can
 * hold a syntactically present key Medal will reject; treated as absent, it
 * fails as an obvious config error rather than a 401.
 */
export function looksLikePlaceholderKey(key: string): boolean {
  return /^(?:pending|placeholder|changeme|change-me|todo|replace-me|<)/i.test(key.trim());
}

/**
 * A 200 whose body is not JSON is not a success. The SDK hands a non-JSON body
 * back as-is, so `data` is `undefined` — and, undetected, that travels into
 * whichever route tried to `.map` over it and surfaces there, pointing at a
 * file with nothing wrong in it. The reachable trigger is an endpoint aimed at
 * a host that answers with an HTML page (the dashboard does).
 */
export function unwrap<T>(response: { data: T } | undefined, path: string): T {
  const data = response?.data;
  if (data === undefined) {
    throw new MedalApiError(200, 'NON_JSON_BODY', `Medal returned a non-JSON body from ${path}`);
  }
  return data;
}

export interface RangeArgs {
  serviceId: string;
  /**
   * The rest of ONE person's visit after `serviceId`, in order — absent (or
   * empty) for a one-service visit. With it the engine answers for the whole
   * visit: slots as long as every service together, on stylists who perform
   * all of them, and a schedule whose last start leaves room for the lot.
   */
  extraServiceIds?: readonly string[];
  resourceId?: string;
  fromTs: number;
  toTs: number;
}

/**
 * No `created_via` here: the site is unambiguously `'web'`, so `createBooking`
 * sets it rather than taking it. Provenance is a fact about the deployment,
 * not a per-call option.
 *
 * `booked_for_name` and `contact.name` are validated `.min(1)` by the engine
 * (`''` is a 400) while `contact.email` is not, so whatever maps wizard state
 * onto this body must coalesce blanks to `undefined` before calling in.
 */
export type CreateBookingBody = Omit<CreateBookingInput, 'created_via'>;

/**
 * Deliberately no `start_ts`: the create response carries only the new id and
 * the one-time manage token per booking. `manage_token` is OPTIONAL: it is
 * minted exactly once, and an idempotent replay returns the same ids WITHOUT
 * it.
 */
export interface CreateBookingResult {
  bookings: Array<{ id: string; manage_token?: string }>;
}

/**
 * The marketing box, filed where a consent belongs. This endpoint is scoped
 * `write:contacts` where the booking endpoints are scoped to bookings: a key
 * minted for bookings alone will 403 here.
 */
export type RecordConsentBody = RecordConsentInput & { consent_type: 'marketing_email' };

/**
 * What a completed move hands back. A reschedule is an insert plus a cancel,
 * so `manage_token` is the only way to reach the new booking; it is minted
 * once and absent from an idempotent replay.
 */
export interface RescheduleResult {
  booking_id?: string;
  manage_token?: string;
}

export interface MedalSeam {
  /** The client, or `null` when the deployment has no usable key. */
  getMedal(): Medal | null;
  /** The client, or a loud `MedalConfigError`. */
  requireMedal(): Medal;
  /** `requireMedal()` with a shorter per-attempt deadline than the SDK's 30 s. */
  requireMedalWithTimeout(timeout: number): Medal;
  /** The key and origin, for the few raw routes the SDK lacks. */
  requireMedalConfig(): { key: string; base: string };
  listServices(): Promise<MedalService[]>;
  listResources(): Promise<MedalResource[]>;
  listAvailability(args: RangeArgs): Promise<MedalSlot[]>;
  listSchedule(args: RangeArgs): Promise<MedalScheduleDay[]>;
  /**
   * `opts.portalSession` — the logged-in parent's portal session, sent as
   * `X-Portal-Session` so Medal books on THAT contact. Never logged: a throw
   * is scrubbed of it before it leaves.
   */
  createBooking(
    body: CreateBookingBody,
    idempotencyKey: string,
    opts?: { portalSession?: string }
  ): Promise<CreateBookingResult>;
  recordConsent(body: RecordConsentBody): Promise<unknown>;
  getManage(token: string): Promise<MedalManageSummary>;
  cancelManage(token: string, reason?: string, idempotencyKey?: string): Promise<unknown>;
  rescheduleManage(
    token: string,
    startTs: number,
    idempotencyKey: string
  ): Promise<RescheduleResult>;
}

const SITE_PROVENANCE: BookingClaimableCreatedVia = 'web';

function read<T>(value: Lazy<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

/** ISO on the wire — the engine parses either, but a millisecond epoch reads
 * as nothing in a request log. */
function rangeParams(args: RangeArgs) {
  return {
    service_id: args.serviceId,
    from_ts: new Date(args.fromTs).toISOString(),
    to_ts: new Date(args.toTs).toISOString(),
    ...(args.resourceId ? { resource_id: args.resourceId } : {}),
    // Only when there is a visit to describe: a one-service read asks exactly
    // what it asked before, so nothing about it changes on the wire.
    ...(args.extraServiceIds?.length ? { extra_service_ids: [...args.extraServiceIds] } : {}),
  };
}

export function createMedalSeam(options: MedalSeamOptions): MedalSeam {
  let cached: { key: string; base: string; medal: Medal } | null = null;
  let cachedQuick: { key: string; base: string; timeout: number; medal: Medal } | null = null;

  function readConfig(): { key: string; base: string } | null {
    const key = read(options.apiKey);
    if (!key || looksLikePlaceholderKey(key)) return null;
    return { key, base: read(options.baseUrl) || DEFAULT_MEDAL_ENDPOINT };
  }

  function getMedal(): Medal | null {
    const config = readConfig();
    if (!config) return null;
    if (cached && cached.key === config.key && cached.base === config.base) {
      return cached.medal;
    }
    cached = { ...config, medal: new Medal(config.key, { baseUrl: config.base }) };
    return cached.medal;
  }

  function requireMedal(): Medal {
    const medal = getMedal();
    if (!medal) throw new MedalConfigError('The Medal API key is not configured');
    return medal;
  }

  function requireMedalWithTimeout(timeout: number): Medal {
    const config = readConfig();
    if (!config) throw new MedalConfigError('The Medal API key is not configured');
    if (
      cachedQuick &&
      cachedQuick.key === config.key &&
      cachedQuick.base === config.base &&
      cachedQuick.timeout === timeout
    ) {
      return cachedQuick.medal;
    }
    cachedQuick = {
      ...config,
      timeout,
      medal: new Medal(config.key, { baseUrl: config.base, timeout }),
    };
    return cachedQuick.medal;
  }

  function requireMedalConfig(): { key: string; base: string } {
    const config = readConfig();
    if (!config) throw new MedalConfigError('The Medal API key is not configured');
    return config;
  }

  return {
    getMedal,
    requireMedal,
    requireMedalWithTimeout,
    requireMedalConfig,

    async listServices() {
      return unwrap(await requireMedal().bookings.listServices(), '/api/v1/bookings/services');
    },

    async listResources() {
      return unwrap(await requireMedal().bookings.listResources(), '/api/v1/bookings/resources');
    },

    async listAvailability(args) {
      return unwrap(
        await requireMedal().bookings.availability(rangeParams(args)),
        '/api/v1/bookings/availability'
      );
    },

    /**
     * The open dates over a range — the half availability cannot answer. A
     * date ABSENT from this response is one the business keeps no hours on.
     */
    async listSchedule(args) {
      return unwrap(
        await requireMedal().bookings.schedule(rangeParams(args)),
        '/api/v1/bookings/schedule'
      );
    },

    async createBooking(body, idempotencyKey, opts) {
      const portalSession = opts?.portalSession;
      let response: Awaited<ReturnType<Medal['bookings']['create']>>;
      try {
        response = await requireMedal().bookings.create(
          // `created_via` LAST, so it wins over anything a caller smuggled in.
          { ...body, created_via: SITE_PROVENANCE },
          portalSession ? { idempotencyKey, portalSession } : { idempotencyKey }
        );
      } catch (error) {
        // The session is never logged, and the create route logs what Medal threw.
        throw portalSession ? redactSession(error, portalSession) : error;
      }
      const result = unwrap(response, '/api/v1/bookings');
      return { bookings: result.bookings };
    },

    async recordConsent(body) {
      return unwrap(await requireMedal().gdpr.recordConsent(body), '/api/v1/gdpr/consent');
    },

    async getManage(token) {
      const path = '/api/v1/bookings/manage/<token>';
      const summary = unwrap(await requireMedal().bookings.manage.get(token), path);
      if (summary.status === null) {
        // Not a case the engine produces; if it ever does, a page that shows a
        // booking with no state is worse than the «cannot find» card this becomes.
        throw new MedalApiError(
          200,
          'MALFORMED_SUMMARY',
          `Medal returned a booking without a status from ${path}`
        );
      }
      return {
        ...summary,
        status: summary.status,
        service_name: summary.service_name ?? 'Unknown service',
        resource_name: summary.resource_name ?? 'Unknown resource',
      };
    },

    /**
     * `idempotencyKey` is optional only in the type — the caller derives one
     * from the token so a retry after a dropped response replays rather than
     * answering `CONFLICT` about a booking that is already cancelled.
     */
    async cancelManage(token, reason, idempotencyKey) {
      return unwrap(
        await requireMedal().bookings.manage.cancel(
          token,
          reason === undefined ? undefined : { reason },
          idempotencyKey ? { idempotencyKey } : undefined
        ),
        '/api/v1/bookings/manage/<token>/cancel'
      );
    },

    async rescheduleManage(token, startTs, idempotencyKey) {
      return unwrap(
        await requireMedal().bookings.manage.reschedule(
          token,
          { new_start_ts: new Date(startTs).toISOString() },
          { idempotencyKey }
        ),
        '/api/v1/bookings/manage/<token>/reschedule'
      );
    },
  };
}
