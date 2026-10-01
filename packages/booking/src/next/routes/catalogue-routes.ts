/**
 * The read routes the wizard asks while it is on screen: the price list, the
 * stylists (with each one's next opening), free slots, opening hours, the
 * next free start and a stylist's photo.
 *
 * Every guard answers before Medal is called, and every read goes through the
 * data cache (`catalogue.ts`), which the site's own writes expire. There is
 * deliberately no way for a visitor to skip it.
 */

import { NextResponse } from 'next/server';
import { RESOURCE_ID_SHAPE } from '../../core/dto';
import { earliestOpening } from '../../core/next-available';
import type { MedalResource } from '../../core/wire';
import type { BookingRuntime } from '../runtime';
import { bookingErrorResponse, catalogueErrorResponse, knownServiceId, parseRange } from './shared';

/**
 * The full price list, in the order Medal returns it. Nothing is filtered: a
 * service with `bookable_online: false` is still a service the business sells,
 * and hiding it here would leave the printed price list and the website
 * disagreeing. Read through the catalogue cache (at most ~10 min old).
 */
export async function servicesRoute(rt: BookingRuntime): Promise<Response> {
  try {
    const services = await rt.catalogue.cachedServices();
    return NextResponse.json({ services: services.map(rt.dto.toBookingServiceDto) });
  } catch (error) {
    return catalogueErrorResponse(rt, error, 'services');
  }
}

/**
 * The window the caller asked about, never one this route invents: «next
 * free» has to agree with the day strip on the time step, and the wizard owns
 * that horizon.
 *
 * Best effort, and never fatal. A stylist list with no «next free» lines is a
 * working step; a 502 here would be a screen with nobody on it.
 */
async function firstOpeningPerResource(
  rt: BookingRuntime,
  serviceId: string,
  range: { fromTs: number; toTs: number }
): Promise<Record<string, number>> {
  try {
    // Unfiltered by resource, deliberately: the whole point is one entry per
    // stylist, and `resource_id` would collapse the answer to that one.
    const slots = await rt.catalogue.cachedAvailability({ serviceId, ...range });
    const earliest: Record<string, number> = {};
    for (const slot of slots) {
      // A slot with no stylist cannot fill anybody's line, and an unparseable
      // start would render «Invalid Date».
      if (slot.resource_id === null || slot.start_ts === null) continue;
      const startTs = Date.parse(slot.start_ts);
      if (!Number.isFinite(startTs)) continue;
      const seen = earliest[slot.resource_id];
      if (seen === undefined || startTs < seen) earliest[slot.resource_id] = startTs;
    }
    return earliest;
  } catch (error) {
    rt.logger.warn({ err: error, serviceId }, 'Could not read next-available times for step 2');
    return {};
  }
}

/**
 * The stylists step 2 offers, and — when asked about a service — the first
 * minute each of them is free. Two answers from one round trip, because step 2
 * is one screen. The availability read is the SAME cached entry the
 * availability route and the booking page use for this service and window.
 */
export async function resourcesRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawServiceId = searchParams.get('service_id')?.trim();

  // The range is only meaningful alongside a service to ask about. Without one
  // this route is the catalogue alone, and a stray `from_ts` is not worth a 400.
  let range: { fromTs: number; toTs: number } | null = null;
  let serviceId: string | null = null;
  if (rawServiceId) {
    const parsed = parseRange(searchParams);
    if ('error' in parsed) return parsed.error;
    range = parsed;
    const known = await knownServiceId(rt, rawServiceId);
    if ('error' in known) return known.error;
    serviceId = known.serviceId;
  }

  // Started before the stylist list is awaited, so the two reads overlap.
  // `firstOpeningPerResource` never rejects.
  const nextAvailable =
    serviceId !== null && range !== null
      ? firstOpeningPerResource(rt, serviceId, range)
      : Promise.resolve({});

  let resources: MedalResource[];
  try {
    resources = await rt.catalogue.cachedResources();
  } catch (error) {
    return catalogueErrorResponse(rt, error, 'resources');
  }

  return NextResponse.json({
    // Unsorted, in the order Medal returned it: step 2 sorts by `sortOrder`
    // itself, and the party seating uses first-encounter order as its
    // tie-break.
    resources: resources.map(rt.dto.toBookingResourceDto),
    nextAvailableTs: await nextAvailable,
  });
}

/**
 * Free slots for one service over one range, optionally narrowed to the
 * stylist chosen on step 2. Read through the slot cache (at most ~60 s old),
 * which the site's own create / move / cancel routes expire on success.
 */
export async function availabilityRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const rawServiceId = searchParams.get('service_id')?.trim();
  if (!rawServiceId) {
    return bookingErrorResponse('invalidInput', 400, 'service_id is required');
  }

  const range = parseRange(searchParams);
  if ('error' in range) return range.error;

  const known = await knownServiceId(rt, rawServiceId);
  if ('error' in known) return known.error;
  const { serviceId } = known;

  const resourceId = searchParams.get('resource_id')?.trim();

  try {
    const slots = await rt.catalogue.cachedAvailability({
      serviceId,
      // Omitted rather than passed as an empty string: `?resource_id=` with
      // nothing after it means «first available».
      ...(resourceId ? { resourceId } : {}),
      fromTs: range.fromTs,
      toTs: range.toTs,
    });
    return NextResponse.json({ slots: slots.flatMap(rt.dto.toBookingSlotDto) });
  } catch (error) {
    return catalogueErrorResponse(rt, error, 'availability');
  }
}

/**
 * The open dates over one range, optionally narrowed to one stylist — the half
 * availability cannot answer: it returns free slots and nothing else, so a
 * closed Sunday, an evening after closing and a booked-out Thursday all arrive
 * as the same empty array. A date ABSENT from the response is one the business
 * keeps no hours on. Opening hours are per stylist, so the filter matters here
 * as much as on availability.
 */
export async function scheduleRoute(rt: BookingRuntime, request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const rawServiceId = searchParams.get('service_id')?.trim();
  if (!rawServiceId) {
    return bookingErrorResponse('invalidInput', 400, 'service_id is required');
  }

  const range = parseRange(searchParams);
  if ('error' in range) return range.error;

  const known = await knownServiceId(rt, rawServiceId);
  if ('error' in known) return known.error;
  const { serviceId } = known;

  const resourceId = searchParams.get('resource_id')?.trim();

  try {
    const days = await rt.catalogue.cachedSchedule({
      ...(resourceId ? { resourceId } : {}),
      serviceId,
      fromTs: range.fromTs,
      toTs: range.toTs,
    });
    return NextResponse.json({ days: days.flatMap(rt.dto.toBookingDayDto) });
  } catch (error) {
    return catalogueErrorResponse(rt, error, 'schedule');
  }
}

/**
 * «Next free: today 11:00» — the next free start for the default prefetch
 * set, for a sticky booking bar or a hero. Read from the booking seed the
 * booking page itself renders from, so it costs no Medal call of its own and
 * cannot name a time the wizard will not show. `startTs: null` when nothing is
 * free or the seed cannot be read: the callers then simply say nothing.
 *
 * The label is formatted here, on the business's clock, so a visitor abroad
 * and the server agree on what «today» means.
 */
export async function nextFreeRoute(rt: BookingRuntime): Promise<Response> {
  const now = Date.now();
  try {
    const seed = await rt.seed.loadBookingSeed(undefined, now);
    const startTs = earliestOpening(seed.slots, now);
    return NextResponse.json(
      { startTs, label: startTs === null ? null : rt.clock.when(startTs, now) },
      // Short and private: the answer turns over with the seed's 30 s bucket.
      { headers: { 'Cache-Control': 'private, max-age=30' } }
    );
  } catch (error) {
    rt.logger.warn({ err: error }, 'next-free: booking seed unavailable');
    return NextResponse.json(
      { startTs: null, label: null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

const AVATAR_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

function uncached(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** How long the photo host gets before the card falls back to initials: a hung
 * read must not hold a request open. */
const UPSTREAM_TIMEOUT_MS = 5000;

/** FNV-1a, 32-bit, twice with different seeds — synchronous and plenty for a
 * cache validator; nothing here is a secret. */
function etagFor(objectKey: string): string {
  const hash = (seed: number) => {
    let h = seed;
    for (let i = 0; i < objectKey.length; i += 1) {
      h ^= objectKey.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  return `"${hash(0x811c9dc5)}${hash(0x01000193)}"`;
}

/**
 * The object, without the signature: origin and path.
 *
 * ASSUMPTION: the ETag is only a content validator because Medal stores each
 * uploaded avatar under a fresh key, so a new photo is a new path.
 */
function objectKeyOf(photoUrl: string): string | null {
  try {
    const url = new URL(photoUrl);
    return url.protocol === 'https:' ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

function etagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === etag || value === '*');
}

/**
 * A stylist's photo, from a URL the browser can cache.
 *
 * Medal returns `photo_url` as a presigned URL that is signed afresh on every
 * read, so the wizard used to download every photo on every visit. This route
 * looks the stylist up in the cached catalogue, fetches the object server-side
 * and hands it back under one stable address with a day of browser cache and
 * an ETag keyed to the OBJECT (the URL without its signature).
 */
export async function avatarRoute(
  rt: BookingRuntime,
  request: Request,
  resourceId: string
): Promise<Response> {
  if (!RESOURCE_ID_SHAPE.test(resourceId)) return uncached(400);

  let photoUrl: string | null | undefined;
  try {
    photoUrl = (await rt.catalogue.cachedResources()).find(
      (resource) => resource.id === resourceId
    )?.photo_url;
  } catch (error) {
    rt.logger.warn({ err: error, resourceId }, 'Could not read the stylists for an avatar');
    return uncached(502);
  }
  const objectKey = photoUrl ? objectKeyOf(photoUrl) : null;
  if (!photoUrl || objectKey === null) return uncached(404);

  const etag = etagFor(objectKey);
  if (etagMatches(request.headers.get('If-None-Match'), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': AVATAR_CACHE_CONTROL },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(photoUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    rt.logger.warn({ err: error, resourceId }, 'Could not fetch a stylist photo');
    return uncached(502);
  }
  const contentType = upstream.headers.get('Content-Type') ?? '';
  // Only images are relayed. Whatever the bucket answers is served from THIS
  // origin, and an HTML or SVG body here would be script on the site.
  if (!upstream.ok || !contentType.startsWith('image/') || contentType.includes('svg')) {
    if (upstream.ok) {
      rt.logger.warn({ resourceId, contentType }, 'Stylist photo is not a raster image');
    }
    await upstream.body?.cancel();
    return uncached(502);
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': AVATAR_CACHE_CONTROL,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
