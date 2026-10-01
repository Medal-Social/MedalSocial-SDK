/**
 * Medal's wire shapes, as the booking core reads them.
 *
 * Type-only imports from `@medalsocial/sdk`: erased at build time, so no
 * bundle that imports `/core` carries the SDK client.
 */

import type {
  BookingResource,
  BookingScheduleDay,
  BookingService,
  BookingSlot,
  ManageSummary,
} from '@medalsocial/sdk';

/**
 * Wire types are the SDK's, `Pick`ed down to exactly the fields this site
 * reads: the SDK growing a column (it has several this site never looks at)
 * then neither widens what the routes pass to the browser nor breaks a
 * fixture, while a change to the TYPE of a field the site does read still
 * fails the build.
 *
 * Nullable, not optional: the serialiser emits every field as `value ?? null`,
 * so each key is always present and may be `null` — a different thing from
 * being absent. Coalescing the nulls away belongs in the route handler.
 */
export type MedalService = Pick<
  BookingService,
  | 'id'
  | 'name'
  | 'description'
  | 'category'
  | 'duration_minutes'
  | 'buffer_before_minutes'
  | 'buffer_after_minutes'
  | 'price_ore'
  | 'bookable_online'
  | 'max_per_booking'
  | 'weekend_surcharge_pct'
> &
  /**
   * SP10's service age range, inclusive whole years — `null` where the salon
   * set none. Optional here although the SDK's `BookingService` always has
   * them: a Medal that predates SP10 sends neither, and `toServiceDto` reads
   * them defensively.
   */
  Partial<Pick<BookingService, 'age_min_years' | 'age_max_years'>>;
export type MedalResource = Pick<
  BookingResource,
  'id' | 'name' | 'photo_url' | 'bio' | 'service_ids' | 'sort_order'
>;
export type MedalSlot = BookingSlot;
export type MedalScheduleDay = BookingScheduleDay;

/**
 * Three fields are narrower than the SDK's, on the engine's own word: it falls
 * back to «Unknown service» / «Unknown resource» rather than `null` when the
 * catalogue row is gone, and a booking always has a status. `getManage`
 * makes the narrowing true by construction instead of asserting it.
 */
export type MedalManageSummary = Omit<
  ManageSummary,
  'status' | 'service_name' | 'resource_name'
> & {
  status: NonNullable<ManageSummary['status']>;
  service_name: string;
  resource_name: string;
};
