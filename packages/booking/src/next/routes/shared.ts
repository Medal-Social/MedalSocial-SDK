/**
 * What the booking routes are allowed to say to a browser.
 *
 * The wizard reads `error` straight into `WizardState.error`, which is a closed
 * union — `'maxParty' | 'slotTaken' | 'conflict' | 'invalidInput' |
 * 'unconfigured' | 'upstreamError'` — so the spelling here is load-bearing
 * rather than descriptive.
 *
 * `upstreamError` is the catch-all. Something has to be in the field either
 * way, because `NextResponse.json({ error: undefined })` serialises to `{}`
 * and reads as a failure with no reason at all.
 *
 * Only the create route is held to the union. `catalogueErrorResponse` also
 * relays the upstream's own code where there is one, so the read routes can
 * say words the wizard has never heard of — which is safe precisely because
 * nothing is reading them into `WizardState`.
 *
 * `message` appears only when THIS file wrote it. Medal's own error bodies are
 * written for the integrator holding the API key — they name workspaces, ids
 * and internal field paths — and none of that belongs in front of a visitor.
 */

import { MedalApiError } from '@medalsocial/sdk';
import { NextResponse } from 'next/server';
import { MedalConfigError } from '../medal';
import type { BookingRuntime } from '../runtime';

export function bookingErrorResponse(code: string, status: number, message?: string): NextResponse {
  return NextResponse.json(message === undefined ? { error: code } : { error: code, message }, {
    status,
  });
}

/**
 * The catch for the read routes, in one place because it is one behaviour.
 *
 * The upstream *status* is relayed rather than flattened, because it is the
 * part that says what to do — a 404 means this service no longer exists and
 * the wizard should reload the catalogue, a 429 means back off, a 403 means
 * the plan lost the bookings module. The upstream *message* is not.
 *
 * A `MedalApiError` already carries its own explanation on both sides of the
 * wire; a missing API key and an unrecognised throw do not, and those two are
 * logged.
 */
export function catalogueErrorResponse(
  rt: Pick<BookingRuntime, 'logger'>,
  error: unknown,
  endpoint: string
): NextResponse {
  if (error instanceof MedalConfigError) {
    rt.logger.error({ err: error, endpoint }, 'Booking API is not configured');
    return bookingErrorResponse('unconfigured', 503);
  }
  if (error instanceof MedalApiError) {
    return bookingErrorResponse(error.code ?? 'upstreamError', error.status);
  }
  rt.logger.error({ err: error, endpoint }, 'Unexpected booking API failure');
  return bookingErrorResponse('upstreamError', 502);
}

/** What a service id looks like: Medal's ids are word characters and dashes. */
const SERVICE_ID_SHAPE = /^[\w-]{1,64}$/;

/**
 * A `service_id` from the query string, checked before it can reach a cache
 * key or a cache tag: the right shape, and a service the catalogue actually
 * has. Otherwise every invented id would be a Medal call and a cache entry.
 *
 * The catalogue read is the cached one, so a real id costs nothing extra.
 */
export async function knownServiceId(
  rt: Pick<BookingRuntime, 'logger' | 'catalogue'>,
  raw: string
): Promise<{ serviceId: string } | { error: NextResponse }> {
  if (!SERVICE_ID_SHAPE.test(raw)) {
    return { error: bookingErrorResponse('invalidInput', 400, 'service_id is malformed') };
  }
  let services: Array<{ id: string }>;
  try {
    services = await rt.catalogue.cachedServices();
  } catch (error) {
    return { error: catalogueErrorResponse(rt, error, 'services') };
  }
  if (!services.some((service) => service.id === raw)) {
    return { error: bookingErrorResponse('invalidInput', 400, 'Unknown service_id') };
  }
  return { serviceId: raw };
}

/**
 * How many services one person's visit may add after the first — the engine's
 * own bound (four services in all), refused here so a visitor's query string
 * cannot make it a Medal call.
 */
export const MAX_EXTRA_SERVICES = 3;

/**
 * `extra_service_ids` from the query string — the rest of ONE person's visit
 * after `service_id`, comma-separated, in order. Blank entries are dropped, so
 * an absent, empty or `,`-only value is a one-service visit (`[]`).
 *
 * Held to everything the engine would refuse with a 422 (more than three, one
 * twice, `service_id` again) and to what `knownServiceId` holds `service_id` to
 * (the shape, and a service the catalogue has), for the same reason: every id
 * here lands in a cache key and a cache tag. Call it after `knownServiceId`.
 */
export async function knownExtraServiceIds(
  rt: Pick<BookingRuntime, 'logger' | 'catalogue'>,
  raw: string | null,
  serviceId: string
): Promise<{ extraServiceIds: string[] } | { error: NextResponse }> {
  const ids = (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) return { extraServiceIds: [] };
  const refuse = (message: string) => ({
    error: bookingErrorResponse('invalidInput', 400, message),
  });
  if (ids.length > MAX_EXTRA_SERVICES) {
    return refuse(`extra_service_ids must name at most ${MAX_EXTRA_SERVICES} services`);
  }
  if (new Set(ids).size !== ids.length) return refuse('extra_service_ids names a service twice');
  if (ids.includes(serviceId)) return refuse('extra_service_ids repeats service_id');
  if (!ids.every((id) => SERVICE_ID_SHAPE.test(id))) {
    return refuse('extra_service_ids is malformed');
  }
  let services: Array<{ id: string }>;
  try {
    services = await rt.catalogue.cachedServices();
  } catch (error) {
    return { error: catalogueErrorResponse(rt, error, 'services') };
  }
  const known = new Set(services.map((service) => service.id));
  if (!ids.every((id) => known.has(id))) return refuse('Unknown service in extra_service_ids');
  return { extraServiceIds: ids };
}

/**
 * The engine's «that slot is no longer free».
 *
 * It arrives as `CONFLICT` with `SLOT_TAKEN` in the message: the SDK exposes no
 * finer code (`MedalApiError.code` is the generic `CONFLICT`, shared with a
 * duplicate key and an unseatable party). The message is read HERE and nowhere
 * else, so the day the engine grows a structured code there is one line to
 * change.
 */
export function isSlotTaken(error: unknown): boolean {
  return (
    error instanceof MedalApiError &&
    error.code === 'CONFLICT' &&
    error.message.includes('SLOT_TAKEN')
  );
}

/**
 * 62 days. A bound on what a visitor-controlled query string may ask the site
 * to fetch on their behalf — not the engine's own limit, which clamps rather
 * than refuses. The wizard asks for a week at a time.
 */
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

/**
 * Epoch milliseconds or an ISO 8601 string — the same two forms the engine's
 * own parser accepts, so a bound this site admits is one Medal would have
 * admitted too. `null` for anything it cannot read as a time.
 */
function parseTimestamp(raw: string | null): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * The `from_ts`/`to_ts` pair the read routes take, validated before Medal is
 * called. Every guard answers a request the engine would also refuse, and an
 * unreadable bound would otherwise throw inside the client and surface as an
 * opaque 502 pointing at Medal for a typo in our own query string.
 */
export function parseRange(
  searchParams: URLSearchParams
): { fromTs: number; toTs: number } | { error: NextResponse } {
  const fromTs = parseTimestamp(searchParams.get('from_ts'));
  const toTs = parseTimestamp(searchParams.get('to_ts'));
  if (fromTs === null || toTs === null) {
    return {
      error: bookingErrorResponse(
        'invalidInput',
        400,
        'from_ts and to_ts must be Unix milliseconds or ISO 8601 date-times'
      ),
    };
  }
  if (toTs <= fromTs) {
    return { error: bookingErrorResponse('invalidInput', 400, 'to_ts must be after from_ts') };
  }
  if (toTs - fromTs > MAX_RANGE_MS) {
    return { error: bookingErrorResponse('invalidInput', 400, 'Range must not exceed 62 days') };
  }
  return { fromTs, toTs };
}

/** SHA-256, hex — for idempotency keys that must never carry what they hash. */
export async function digestOf(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
