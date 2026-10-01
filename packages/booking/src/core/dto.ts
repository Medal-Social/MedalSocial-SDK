/**
 * Where Medal's wire shape becomes this site's — one definition per shape.
 *
 * `medal-client.ts` deliberately refuses to do this. It types the wire honestly,
 * nullable throughout, and leaves what a missing price or duration ought to mean
 * to the layer that renders it. This is that layer, and it is a module rather
 * than a private function in one route because four places now need the same
 * answers: the services route, the resources route, the manage page and the
 * booking page.
 *
 * The defaults are chosen to be visibly wrong rather than plausibly wrong. A
 * missing duration is `0`, not 30: a wrong-but-believable number would size a
 * slot against a service the salon never described. `maxPerBooking` is the one
 * that must not be `0` — `partyLimit` takes `Math.min` over it, JS coerces
 * `null` to 0 there, and a limit of zero silently refuses to add the second
 * child to a family booking. `1` is the conservative reading of a service nobody
 * has set a party size for: bookable, but alone.
 *
 * Types only from the SDK (`./wire`), never values: the service step imports
 * `normaliseServiceCategory` from here into the browser, and `import type` is
 * erased, so the client bundle never carries the SDK.
 *
 * `createDto(config)` binds the three that read the site's config — the
 * category list, the fallback category and the avatar path.
 */

import { normaliseCategory } from './categories';
import type { BookingConfig } from './config';
import type { BookingDayDto, BookingResourceDto, BookingServiceDto, BookingSlotDto } from './types';
import type { MedalResource, MedalScheduleDay, MedalService, MedalSlot } from './wire';

type DtoConfig = Pick<BookingConfig, 'categories' | 'fallbackCategory' | 'paths'>;

/**
 * `category` is a free string on the wire, and the salon can add one in the
 * dashboard at any time. Grouping strictly by the five known keys would drop
 * that service off whichever page is grouping — bookable, priced, and invisible
 * — so anything unrecognised joins the catch-all the seed already uses for
 * threading, machine cuts and ear piercing.
 */
function normaliseServiceCategory(config: DtoConfig, category: string): string {
  return normaliseCategory(config, category);
}

/**
 * `category` stays a free string here rather than being narrowed: `WizardService`
 * types it as one, and the two consumers group by it with their own labels.
 * `normaliseServiceCategory` is what either of them applies at the point of
 * grouping.
 */
function toBookingServiceDto(config: DtoConfig, service: MedalService): BookingServiceDto {
  return {
    id: service.id,
    name: service.name ?? '',
    category: service.category ?? config.fallbackCategory,
    durationMinutes: service.duration_minutes ?? 0,
    // Zero is the wire's own default and the ordinary value, so unlike
    // `durationMinutes` there is nothing visibly wrong about coalescing to it.
    bufferBeforeMinutes: service.buffer_before_minutes ?? 0,
    bufferAfterMinutes: service.buffer_after_minutes ?? 0,
    priceOre: service.price_ore ?? 0,
    maxPerBooking: service.max_per_booking ?? 1,
    weekendSurchargePct: service.weekend_surcharge_pct ?? 0,
    bookableOnline: service.bookable_online,
    // Absent rather than null, the wizard's rule: a service with no range is
    // for everybody, and a nonsense value is treated as no range at all.
    ...ageBound('ageMinYears', service.age_min_years),
    ...ageBound('ageMaxYears', service.age_max_years),
  };
}

function ageBound<K extends 'ageMinYears' | 'ageMaxYears'>(
  key: K,
  value: unknown
): Partial<Record<K, number>> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 120
    ? ({ [key]: value } as Record<K, number>)
    : {};
}

/** What a resource id may look like before the avatar route will look it up
 * — and before this module will build a URL out of it. */
export const RESOURCE_ID_SHAPE = /^[\w-]{1,64}$/;

/**
 * The stylist's photo on THIS site, not Medal's presigned R2 URL.
 *
 * The presigned URL is re-signed on every read, so the browser saw a new URL
 * per page and cached nothing; the proxy route gives each stylist one stable,
 * cacheable address. An id the route would refuse gets no photo (initials)
 * rather than a broken image.
 */
function avatarPath(config: DtoConfig, resourceId: string): string | null {
  return RESOURCE_ID_SHAPE.test(resourceId) ? `${config.paths.avatar}/${resourceId}` : null;
}

/**
 * A stylist nobody has given a position lands after everyone who has one.
 *
 * `MAX_SAFE_INTEGER` rather than `0`, which is what a coalesce-to-falsy would
 * produce: step 2 sorts ascending, so a zero would put the salon's least
 * configured stylist at the top of the list, above the person they deliberately
 * ordered first.
 *
 * The name is `''` for the same reason the services route leaves a nameless
 * service `''` — the salon can see the blank and fix it, where dropping the row
 * would make a stylist they configured unbookable with nothing on screen to say
 * why.
 */
function toBookingResourceDto(config: DtoConfig, resource: MedalResource): BookingResourceDto {
  return {
    id: resource.id,
    name: resource.name ?? '',
    photoUrl: resource.photo_url ? avatarPath(config, resource.id) : null,
    bio: resource.bio,
    serviceIds: resource.service_ids,
    sortOrder: resource.sort_order ?? Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Zero or one slot, so a timeless one is dropped rather than emitted.
 *
 * `start_ts` is nullable on the wire like every other timestamp. A `NaN` carried
 * through would render as an «Invalid Date» chip that books nothing, and would
 * reach `createBooking` as a `start_ts` the engine rejects.
 */
export function toBookingSlotDto(slot: MedalSlot): BookingSlotDto[] {
  const startTs = slot.start_ts === null ? Number.NaN : Date.parse(slot.start_ts);
  if (!Number.isFinite(startTs)) return [];
  return [{ startTs, resourceId: slot.resource_id }];
}

/**
 * Zero or one open day, so a date the wire could not describe is dropped rather
 * than emitted.
 *
 * Dropping is the SAFE failure here, and it is worth being explicit about why,
 * because the two directions are not symmetric. A date missing from this list
 * reads downstream as «the salon keeps no hours then», which at worst shows
 * «Stengt» beside a day that had none of its slots taken — visible, and it
 * costs the visitor a tap on another day. A date emitted with a nonsense
 * `opensTs` reads as open, and `NaN` compares false against every clock check
 * the step makes, so the day would silently fall through to «Fullt» — the exact
 * false claim about the business this whole path exists to stop.
 *
 * `lastStartTs` is the one field allowed to be null after this: there, null is
 * an ANSWER (open on paper, shut on the day) rather than an unreadable value.
 */
export function toBookingDayDto(day: MedalScheduleDay): BookingDayDto[] {
  if (day.date === null) return [];
  const opensTs = day.opens_ts === null ? Number.NaN : Date.parse(day.opens_ts);
  const closesTs = day.closes_ts === null ? Number.NaN : Date.parse(day.closes_ts);
  if (!Number.isFinite(opensTs) || !Number.isFinite(closesTs)) return [];

  // A `last_start_ts` that is present but unreadable becomes null rather than
  // NaN: null already means «shut on the day», which is the conservative thing
  // to say about a value we cannot read, and it is a case the step handles.
  const parsedLastStart = day.last_start_ts === null ? Number.NaN : Date.parse(day.last_start_ts);
  return [
    {
      dayKey: day.date,
      opensTs,
      closesTs,
      lastStartTs: Number.isFinite(parsedLastStart) ? parsedLastStart : null,
    },
  ];
}

export interface Dto {
  /** A free-string Medal category as one of the configured keys, or the fallback. */
  normaliseServiceCategory(category: string): string;
  toBookingServiceDto(service: MedalService): BookingServiceDto;
  /** This site's stable avatar URL for a stylist, or `null` for an id the route would refuse. */
  avatarPath(resourceId: string): string | null;
  toBookingResourceDto(resource: MedalResource): BookingResourceDto;
  toBookingSlotDto: typeof toBookingSlotDto;
  toBookingDayDto: typeof toBookingDayDto;
}

export function createDto(config: DtoConfig): Dto {
  return {
    normaliseServiceCategory: (category) => normaliseServiceCategory(config, category),
    toBookingServiceDto: (service) => toBookingServiceDto(config, service),
    avatarPath: (resourceId) => avatarPath(config, resourceId),
    toBookingResourceDto: (resource) => toBookingResourceDto(config, resource),
    toBookingSlotDto,
    toBookingDayDto,
  };
}
