import type { PaginationOptions } from "./common";

/**
 * A timestamp on the way IN to the booking API: Unix milliseconds, or an
 * ISO 8601 date-time string.
 *
 * Both are accepted so a caller can book by echoing back the `start_ts` of a
 * slot it just fetched — responses render every timestamp as ISO, requests
 * take either. The API normalises to milliseconds server-side.
 */
export type BookingTimestampInput = number | string;

/** Lifecycle state of a booking. */
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

/**
 * Who cancelled a booking. `staff` is a cancel made through
 * `bookings.cancel(id)`, `customer` one made through
 * `bookings.manage.cancel(token)`, `system` an automated one.
 */
export type BookingCancelledBy = "customer" | "staff" | "system";

/** Payment state of a booking. */
export type BookingPaymentStatus = "none" | "reserved" | "captured" | "refunded";

/** Surface a booking was created through. API-created bookings are `api`. */
export type BookingCreatedVia = "web" | "dashboard" | "walk_in" | "api";

/** Kind of bookable resource a booking lands on. */
export type BookingResourceType = "staff" | "room" | "equipment";

/**
 * One appointment: a contact holding a service slot on a resource.
 *
 * Money is `amount_ore` — an INTEGER number of øre, never a float and never
 * kroner. Timestamps are ISO 8601 strings.
 */
export interface Booking {
  id: string;
  contact_id: string | null;
  service_id: string | null;
  resource_id: string | null;
  start_ts: string | null;
  end_ts: string | null;
  booked_for_name: string | null;
  /** Birth year (not a birthdate) of whoever the appointment is for. */
  booked_for_birth_year: number | null;
  /** Shared by every booking created in the same party request. */
  party_sequence_id: string | null;
  status: BookingStatus;
  cancelled_by: BookingCancelledBy | null;
  cancel_reason: string | null;
  /** Set on the booking a reschedule created, pointing at the one it replaced. */
  rescheduled_from_id: string | null;
  payment_status: BookingPaymentStatus;
  /** Price in integer øre. */
  amount_ore: number | null;
  /** Customer-visible note. */
  notes: string | null;
  /** Staff-only note; never shown to the customer. */
  internal_notes: string | null;
  created_via: BookingCreatedVia | null;
  created_at: string | null;
  updated_at: string | null;
}

/** A bookable service in the workspace catalogue. */
export interface BookingService {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
  duration_minutes: number | null;
  buffer_before_minutes: number | null;
  buffer_after_minutes: number | null;
  /** Price in integer øre. */
  price_ore: number | null;
  weekend_surcharge_pct: number | null;
  /** Resource types this service needs, e.g. `["staff"]`. */
  resource_requirements: string[];
  bookable_online: boolean;
  max_per_booking: number | null;
  color: string | null;
  sort_order: number | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** Who or what performs a service: a staff member, a room, or equipment. */
export interface BookingResource {
  id: string;
  type: BookingResourceType | null;
  name: string | null;
  photo_url: string | null;
  bio: string | null;
  /** Services this resource can perform. */
  service_ids: string[];
  capacity: number | null;
  sort_order: number | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** One free slot returned by `bookings.availability(...)`. */
export interface BookingSlot {
  start_ts: string | null;
  end_ts: string | null;
  resource_id: string | null;
}

/** One line of a party booking — a single service on a single slot. */
export interface CreateBookingItemInput {
  service_id: string;
  /** Leave unset to let the engine pick a free resource. */
  resource_id?: string;
  start_ts: BookingTimestampInput;
  booked_for_name?: string;
  /** Birth year (not a birthdate) of whoever the appointment is for. */
  booked_for_birth_year?: number;
}

/** The person the booking is made under. Phone is the CRM dedupe key. */
export interface BookingContactInput {
  phone: string;
  email?: string;
  name?: string;
}

/**
 * Input for `bookings.create(...)`. `items` is a PARTY — one request books a
 * whole family in one all-or-nothing transaction (max 50 items).
 */
export interface CreateBookingInput {
  items: CreateBookingItemInput[];
  contact: BookingContactInput;
  notes?: string;
}

/** One entry of `BookingCreateResult.bookings`, in request order. */
export interface CreatedBooking {
  id: string;
  /**
   * Show-once secret for the customer's manage link.
   *
   * Only its SHA-256 hash is stored, so this response is the ONLY place it
   * ever appears — persist it here or it is gone. It is **absent** (the key is
   * dropped, not nulled) when the response is replayed from an
   * `Idempotency-Key`, since tokens are redacted from replays.
   *
   * A lost token cannot be recovered: {@link Booking} carries no token field,
   * so re-reading the booking will not produce it. Either reschedule the
   * booking (which mints a fresh token) or have staff act on it by id.
   */
  manage_token?: string;
}

/** Result returned after creating a booking or party. */
export interface BookingCreateResult {
  bookings: CreatedBooking[];
  contact_id: string;
}

/** Result of a cancel or no-show. */
export interface BookingActionResult {
  success: true;
}

/**
 * Result of a reschedule. A reschedule cancels the old booking and inserts a
 * new one, so `booking_id` is a NEW id — the one you passed in is now cancelled.
 */
export interface BookingRescheduleResult {
  success: true;
  booking_id: string;
  /**
   * Freshly minted manage token for the new booking. Same show-once rule as
   * {@link CreatedBooking.manage_token}: absent on an idempotent replay.
   */
  manage_token?: string;
}

/**
 * What the holder of a manage token may see and do — the payload behind a
 * customer's "manage my booking" link.
 *
 * `can_cancel` / `can_reschedule` already account for the workspace's policy
 * windows, so honour them rather than re-deriving from the window hours.
 */
export interface ManageSummary {
  booking_id: string;
  contact_id: string | null;
  status: BookingStatus | null;
  cancelled_by: BookingCancelledBy | null;
  cancel_reason: string | null;
  rescheduled_from_id: string | null;
  start_ts: string | null;
  end_ts: string | null;
  service_id: string | null;
  service_name: string | null;
  resource_id: string | null;
  resource_name: string | null;
  booked_for_name: string | null;
  party_sequence_id: string | null;
  /** Price in integer øre. */
  amount_ore: number | null;
  payment_status: BookingPaymentStatus | null;
  /** IANA zone the booking's local times should be rendered in. */
  time_zone: string | null;
  cancel_window_hours: number | null;
  reschedule_window_hours: number | null;
  can_cancel: boolean;
  can_reschedule: boolean;
}

/** The annotation fields a booking accepts. */
interface BookingNoteFields {
  /** Customer-visible note. Pass `""` to clear it. */
  notes?: string;
  /** Staff-only note; never shown to the customer. Pass `""` to clear it. */
  internal_notes?: string;
}

/**
 * Input for annotating a booking.
 *
 * At least one of `notes` or `internal_notes` must be present: the API's
 * `updateBookingSchema` refuses a body carrying neither with a 400, so the
 * union turns `update(id, {})` into a compile error rather than a wasted round
 * trip. Note that `""` is a meaningful value — it clears the field — which is
 * why the constraint is on presence, not on emptiness.
 */
export type UpdateBookingInput =
  | (BookingNoteFields & { notes: string })
  | (BookingNoteFields & { internal_notes: string });

/** Optional reason recorded against a cancellation. */
export interface CancelBookingInput {
  reason?: string;
}

/** Input for moving a booking to a new slot, and optionally a new resource. */
export interface RescheduleBookingInput {
  new_start_ts: BookingTimestampInput;
  new_resource_id?: string;
}

/**
 * Pagination for a bookings page.
 *
 * `truncated` is the extra statement this list carries: the underlying read is
 * capped, and when the cap binds there are matching bookings that no cursor
 * from this call reaches. Narrow `from_ts`/`to_ts` when you see it.
 */
export interface BookingsPagination {
  has_more: boolean;
  next_cursor: string | null;
  truncated: boolean;
}

/** A page of bookings. Carries `truncated` on top of the usual pagination. */
export interface BookingsPage {
  data: Booking[];
  pagination: BookingsPagination;
}

/** Options for listing bookings with pagination and filters. */
export interface ListBookingsOptions extends PaginationOptions {
  from_ts?: BookingTimestampInput;
  to_ts?: BookingTimestampInput;
  status?: BookingStatus;
  resource_id?: string;
}

/** Options for listing the service catalogue. The endpoint is not paginated. */
export interface ListBookingServicesOptions {
  /** Include services with `active: false`. Defaults to active-only. */
  include_inactive?: boolean;
}

/** Options for querying free slots. The window is required and half-open. */
export interface BookingAvailabilityOptions {
  service_id: string;
  from_ts: BookingTimestampInput;
  /** Must be after `from_ts`. */
  to_ts: BookingTimestampInput;
  /** Restrict slots to one resource. Defaults to every capable resource. */
  resource_id?: string;
}
