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

/**
 * What a booking must have paid before the business honours it: nothing, a
 * reservation taken at booking time and captured later, or the full amount up
 * front.
 */
export type BookingPaymentMode = "none" | "reserve" | "prepay";

/**
 * The state of one attempt at paying for a booking.
 *
 * This is Medal's vocabulary, not the wallet's — a Vipps payment stays
 * `AUTHORIZED` after a capture, so read the øre aggregates on
 * {@link BookingPayment} to learn what actually moved.
 */
export type BookingPaymentState =
  | "created"
  | "authorized"
  | "captured"
  | "cancelled"
  | "refunded"
  | "failed"
  | "expired";

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
  /** The {@link ContactPerson} this booking was made for, if any. */
  booked_for_person_id: string | null;
  /** The {@link BookingEvent} this booking is a registration for, if any. */
  event_id: string | null;
  /** Position of this booking within its event's registrations, if any. */
  event_order: number | null;
  /** Shared by every booking created in the same party request. */
  party_sequence_id: string | null;
  status: BookingStatus;
  cancelled_by: BookingCancelledBy | null;
  cancel_reason: string | null;
  /** Set on the booking a reschedule created, pointing at the one it replaced. */
  rescheduled_from_id: string | null;
  payment_status: BookingPaymentStatus;
  /**
   * What this booking required when it was made — frozen at creation, so
   * changing the workspace or service rule later does not rewrite history.
   * `payment_status` alone cannot tell "owes nothing" from "has not paid yet";
   * this is the field that does.
   */
  payment_mode: BookingPaymentMode;
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
  /**
   * Per-service payment requirement. `null` means "no override" — the
   * workspace rule decides.
   */
  payment: BookingPaymentMode | null;
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

/**
 * One date a service can be booked on, from `bookings.schedule(...)`.
 *
 * `date` is the workspace's own calendar date (`YYYY-MM-DD`), not a timestamp.
 * `last_start_ts` is the last start this service could occupy on that date —
 * not the closing time; a 30-minute service at a salon closing 17:00 has its
 * last start at 16:30 — and is `null` for a date with posted hours that is
 * shut outright (a public holiday). A date ABSENT from the list is closed.
 */
export interface BookingScheduleDay {
  date: string | null;
  opens_ts: string | null;
  closes_ts: string | null;
  last_start_ts: string | null;
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
  /** Book this line on behalf of a {@link ContactPerson} rather than the contact. */
  booked_for_person_id?: string;
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
/** Provenance an API caller may claim. `dashboard` and `walk_in` are staff-only and rejected. */
export type BookingClaimableCreatedVia = "web" | "api";

export interface CreateBookingInput {
  items: CreateBookingItemInput[];
  contact: BookingContactInput;
  notes?: string;
  /**
   * Defaults to `api`. A workspace's OWN website should send `web`, so "how
   * many bookings did the site bring in" is answerable; integrations leave it
   * unset. `dashboard` and `walk_in` are refused with 400 — a bearer token
   * proves which workspace is calling, not that a member typed it in.
   */
  created_via?: BookingClaimableCreatedVia;
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
  /**
   * What this booking requires. `payment_status: "none"` is the same answer
   * for a booking that owes nothing and one that has not paid yet, so this is
   * what a manage page checks before offering «Betal nå».
   */
  payment_mode: BookingPaymentMode;
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
 * One payment attempt on a booking.
 *
 * Money is integer øre, and the four aggregates are numbers rather than nulls:
 * "nothing has been captured" is `0`, so summing them never needs a null
 * guard. `redirect_url` is deliberately absent — it is handed over once by
 * {@link BookingPaymentStart} and never re-read.
 */
export interface BookingPayment {
  reference: string;
  provider: "vipps";
  state: BookingPaymentState;
  mode: Exclude<BookingPaymentMode, "none">;
  /** 1 for the first attempt on this booking, incrementing per retry. */
  attempt: number;
  /** The amount the attempt is for, in integer øre. */
  amount_ore: number;
  authorized_ore: number;
  captured_ore: number;
  refunded_ore: number;
  cancelled_ore: number;
  currency: "NOK";
  /**
   * The last moment a capture is GUARANTEED to succeed. The card behind the
   * wallet may release the reservation after this, so a capture past it can
   * fail even though the payment still looks authorized. Null until the
   * customer has approved.
   */
  capture_guaranteed_until: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  /**
   * The wallet's numeric error code from the last failed operation. Branch on
   * this; the human-readable reason and the trace id stay in Medal's own logs.
   */
  failure_code: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** What `payment.start(...)` hands back. The redirect URL is shown ONCE. */
export interface BookingPaymentStart {
  reference: string;
  /**
   * Send the customer here UNCHANGED — hand it to the Vipps Widget SDK, do not
   * put it in an iframe of your own and do not rewrite it. It is not returned
   * again by `payment.get(...)`: the payment behind it expires after ten
   * minutes, so a cached redirect leads into a payment that no longer exists.
   * Start a new attempt instead of caching this.
   */
  redirect_url: string;
  state: BookingPaymentState;
}

/** Input for `bookings.payment.start(...)` and its manage-token twin. */
export interface StartBookingPaymentInput {
  /**
   * Where the wallet returns the customer. Must be a URL one of your own sites
   * vouches for — anything else is refused with 422, not 400: the URL is
   * well-formed, it is just not yours.
   */
  return_url: string;
  /**
   * REQUIRED, and must be `true`. The customer has to actively accept your
   * terms BEFORE a payment is initiated — sending them to a payment link with
   * no acceptance step makes the integration non-compliant, so the API refuses
   * a body that omits it or sends `false` with a 400.
   */
  terms_accepted: true;
  /** Your own version label for the terms they accepted. */
  terms_version?: string;
  /** The exact text they accepted, stored with the consent record. */
  terms_text?: string;
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
  /**
   * Only bookings with this provenance. Unlike `create`, EVERY value the
   * column holds is filterable here — asking about walk-ins is not the same
   * as claiming to be one. Any other value is a `400`.
   */
  created_via?: BookingCreatedVia;
}

/** Options for listing the service catalogue. The endpoint is not paginated. */
export interface ListBookingServicesOptions {
  /** Include services with `active: false`. Defaults to active-only. */
  include_inactive?: boolean;
}

/**
 * Options for `bookings.schedule(...)`. Same shape as availability, and for
 * the same reason: the last bookable start depends on the service's duration
 * and buffers, so a 30-minute cut and a 90-minute colour run out at different
 * hours of the same afternoon.
 */
export interface BookingScheduleOptions {
  service_id: string;
  from_ts: BookingTimestampInput;
  /** Must be after `from_ts`. */
  to_ts: BookingTimestampInput;
  /** Restrict to one resource's hours. */
  resource_id?: string;
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

/** How a {@link ContactPerson} or {@link ContactRelation} relates to a contact. */
export type RelationType = "guardian" | "owner" | "employer" | "caregiver" | "partner" | "custom";

/** A person a contact books for — a child, a pet, an employee. No login of its own. */
export interface ContactPerson {
  person_id: string;
  contact_id: string;
  name: string;
  birth_year: number | null;
  relation_type: RelationType;
  relation_label: string | null;
  notes: string | null;
  active: boolean;
  promoted_to_contact_id: string | null;
  /** ISO 8601. */
  created_at: string;
  /** ISO 8601. */
  updated_at: string;
}

/** Input for `bookings.persons.create(...)`. */
export interface CreateContactPersonInput {
  contact_id: string;
  name: string;
  birth_year?: number;
  relation_type: RelationType;
  relation_label?: string;
  notes?: string;
}

/** One directional relation between two contacts. */
export interface ContactRelation {
  relation_id: string;
  from_contact_id: string;
  to_contact_id: string;
  type: RelationType;
  custom_label: string | null;
  since: number | null;
  note: string | null;
  /** Empty string when the counterpart contact no longer exists. */
  counterpart_name: string;
  /** ISO 8601. */
  created_at: string;
}

/** Relations a contact holds, split by direction. */
export interface ContactRelations {
  outgoing: ContactRelation[];
  incoming: ContactRelation[];
}

/** Input for `bookings.relations.create(...)`. */
export interface CreateContactRelationInput {
  from_contact_id: string;
  to_contact_id: string;
  type: RelationType;
  custom_label?: string;
  since?: number;
  note?: string;
}

/** Result of `bookings.relations.create(...)`. */
export interface CreateContactRelationResult {
  relation_id: string;
}

/** Lifecycle state of an arrangement. */
export type BookingEventStatus = "draft" | "open" | "closed" | "completed" | "cancelled";

/** Which prebuilt template an arrangement was created from. */
export type BookingEventTemplateKey =
  | "kindergarten_visit"
  | "company_day"
  | "class"
  | "open_day"
  | "custom";

/** An arrangement — a scheduled group session bookings register against. */
export interface BookingEvent {
  event_id: string;
  template_id: string;
  host_id: string | null;
  /** yyyy-mm-dd in the workspace time zone. */
  date: string;
  window_start_minute: number;
  window_end_minute: number;
  place: "at_host" | "in_house";
  capacity: number;
  minimum: number;
  registered_count: number;
  service_ids: string[];
  resource_ids: string[];
  price_override_ore: number | null;
  status: BookingEventStatus;
  /** ISO 8601. */
  registration_closes_at: string;
  slug: string;
  /** ISO 8601. */
  created_at: string;
  /** ISO 8601. */
  updated_at: string;
}

/** Options for `bookings.events.list(...)`. The window is `yyyy-mm-dd`, inclusive. */
export interface ListBookingEventsOptions {
  from: string;
  to: string;
  status?: BookingEventStatus;
  /** Restrict to arrangementer at one host. */
  host_id?: string;
}

/** Input for `bookings.events.create(...)`. */
export interface CreateBookingEventInput {
  template_key: BookingEventTemplateKey;
  host_id?: string;
  date: string;
  window_start_minute: number;
  window_end_minute?: number;
  place: "at_host" | "in_house";
  capacity?: number;
  minimum?: number;
  service_ids: string[];
  resource_ids: string[];
}

/** The guardian registering a child for an arrangement. Phone is the CRM dedupe key. */
export interface RegisterBookingEventGuardianInput {
  name: string;
  email?: string;
  phone?: string;
}

/** The child being registered. Birth year, not a birthdate — the age bracket is all that is stored. */
export interface RegisterBookingEventChildInput {
  name: string;
  birth_year: number;
}

/**
 * Input for `bookings.events.register(...)` — a guardian registering a child
 * for an arrangement. Lands as a {@link Booking} with `event_id` set and
 * `event_order` recording its position in the roster.
 */
export interface RegisterBookingEventInput {
  guardian: RegisterBookingEventGuardianInput;
  child: RegisterBookingEventChildInput;
  service_id: string;
  note?: string;
  /**
   * REQUIRED, and must be `true`. Mirrors {@link StartBookingPaymentInput.terms_accepted}:
   * the guardian has to actively consent before the registration is recorded.
   */
  consent_accepted: true;
  /** Your own version label for the consent wording shown; defaults server-side to `event-consent-v1`. */
  consent_version?: string;
  /** The exact wording shown, stored on the consent record. */
  consent_text?: string;
  /** Where the wallet returns the guardian, when the registration starts a payment. Must be a URL one of your own sites vouches for. */
  return_url?: string;
}

/**
 * A payment could not be started for a registration that otherwise succeeded.
 * The booking itself is still created — read `code`/`message` to decide
 * whether to retry `bookings.payment.start(...)` on the returned booking.
 */
export interface BookingEventRegistrationPaymentError {
  code: string;
  message: string;
}

/**
 * Result of `bookings.events.register(...)`.
 *
 * `payment` is `null` when the registration's service needs no payment.
 * `manage_token` is SHOW-ONCE, exactly like {@link CreatedBooking.manage_token}
 * — persist it here or it is gone. It is present on every fresh registration;
 * an idempotent replay omits it (only its hash is stored, so a replay cannot
 * reproduce the plaintext).
 */
export interface BookingEventRegistrationResult {
  booking: Booking;
  manage_token?: string;
  /** The guardian's contact, created or reused. */
  contact_id: string;
  /** The child's {@link ContactPerson}, created or reused. */
  person_id: string;
  payment: BookingPaymentStart | null;
  payment_error?: BookingEventRegistrationPaymentError;
}

/**
 * One row of an arrangement's roster (SP10a).
 *
 * A PROJECTION, not a snapshot: `contact_name` / `participant_name` /
 * `participant_birth_year` come from the live contact and person, so a child
 * renamed since registering reads as they are now.
 */
export interface BookingEventRegistration {
  booking_id: string | null;
  /** Position of this booking within the arrangement's registrations. */
  event_order: number | null;
  contact_id: string | null;
  contact_name: string | null;
  /** The {@link ContactPerson} this registration was made for, if any. */
  person_id: string | null;
  participant_name: string | null;
  participant_birth_year: number | null;
  service_id: string | null;
  resource_id: string | null;
  start_ts: string | null;
  status: BookingStatus | null;
  amount_ore: number | null;
  payment_status: BookingPaymentStatus;
}

/**
 * Result of `bookings.events.registrations(id)` — an arrangement's roster,
 * ordered by `event_order`. Cancelled registrations are returned, not
 * filtered — the event's `registered_count` answers the capacity question
 * separately.
 */
export interface ListBookingEventRegistrationsResult {
  registrations: BookingEventRegistration[];
  /**
   * The roster is capped at 300 rows; `true` means the page was cut and the
   * `event_order` ordering can no longer be trusted.
   */
  truncated: boolean;
}

// ── Operating reads (Medal Bookings SP12) ─────────────────────

/** Where the money on one local day came from. */
export type BookingRevenueProvider = "in_house" | "vipps";

/** One provider's share of a day's takings, in integer øre. */
export interface BookingRevenueByProvider {
  provider: BookingRevenueProvider;
  /** Integer øre. */
  amount_ore: number;
  /** Bookings behind `amount_ore`. */
  count: number;
}

/** The next stretch a resource is free, as both minutes-of-day and an instant. */
export interface BookingNextGap {
  resource_id: string;
  /** Minutes since midnight in the workspace time zone. */
  start_minute: number;
  end_minute: number;
  /** ISO 8601 — the same moment as `start_minute`, resolved through the salon's clock. */
  start_ts: string;
}

/**
 * The salon's operating summary for ONE local date — Medal's own «I dag» board
 * over the API.
 *
 * The date is the WORKSPACE's, not the caller's: omit `date_key` and the
 * workspace time zone decides which Thursday this is. `truncated` says a source
 * hit its read cap, so the counts are floors rather than totals.
 */
export interface BookingsToday {
  /** `yyyymmdd` in the workspace time zone. */
  date_key: number;
  /** IANA zone the minutes below are counted in, e.g. `Europe/Oslo`. */
  time_zone: string;
  /** Minutes since midnight the first resource comes on duty, or `null` when nobody does. */
  opens_minute: number | null;
  closes_minute: number | null;
  /**
   * Past the last opening window of a day that DID open. A day nobody works at
   * all is `opens_minute: null` with `on_duty_count: 0` instead.
   */
  closed_for_today: boolean;
  /** Set only alongside `closed_for_today` — when the salon opens again. */
  next_open: { start_ts: string } | null;
  on_duty_count: number;
  total: number;
  completed: number;
  remaining: number;
  no_show: number;
  cancelled: number;
  next_gap: BookingNextGap | null;
  revenue: {
    /** Integer øre. */
    total_ore: number;
    by_provider: BookingRevenueByProvider[];
  };
  /** A source stopped at its cap, so the counts above are floors. */
  truncated: boolean;
}

/** Options for `bookings.today(...)`. */
export interface BookingsTodayOptions {
  /**
   * `yyyymmdd` in the WORKSPACE time zone. Defaults to the salon's today, so a
   * caller in another zone still reads the salon's day.
   */
  date_key?: number;
}

/**
 * What kind of open item needs a human.
 *
 * No prose crosses the wire: the sentence is the caller's to render, so the
 * same feed reads correctly for a salon, a vet and a consultancy.
 */
export type BookingAttentionKind =
  | "payment_failed"
  | "payment_released"
  | "payment_partial_capture"
  | "waitlist_offer_expiring"
  | "event_consent_missing"
  | "booking_attachment"
  | "no_show_today";

/**
 * One «Trenger deg» item. Derived on every call from facts recorded elsewhere,
 * so ids and timestamps are all it carries; every optional field answers `null`
 * rather than being omitted, so one shape destructures for every `kind`.
 */
export interface BookingAttentionItem {
  /** Stable within one answer, so a list key survives a refetch. */
  id: string;
  kind: BookingAttentionKind;
  /** ISO 8601. */
  occurred_at: string | null;
  booking_id: string | null;
  event_id: string | null;
  contact_id: string | null;
  resource_id: string | null;
  /** Money the item is about, in integer øre. */
  amount_ore: number | null;
  /** How many of a thing the item is about — unconsented registrations, say. */
  count: number | null;
  /** ISO 8601 — when the window closes. */
  deadline_at: string | null;
}

/**
 * The attention feed. NOT a page: `truncated` is a read budget, not a cursor,
 * and `total` is exact only while it is false (a lower bound otherwise).
 */
export interface BookingAttentionFeed {
  data: BookingAttentionItem[];
  truncated: boolean;
  total: number;
}

// ── Arrangement hosts (D57) ───────────────────────────────────

/** A place an arrangement is held — the address a confirmation e-mail prints. */
export interface BookingEventHost {
  id: string;
  name: string;
  /** Stable public URL segment; never changes after creation. */
  slug: string;
  address: string | null;
  /** The half-sentence an address cannot carry («inngang B, ring på»). */
  note: string | null;
  /** `true` once the host is retired — events already pointing at it still resolve. */
  retired: boolean;
}

/** Input for `bookings.events.hosts.create(...)` — find-or-create by name. */
export interface CreateBookingEventHostInput {
  /** 1–120 characters. An existing host with the same name is returned unchanged. */
  name: string;
  address?: string;
  note?: string;
}

/**
 * Input for `bookings.events.hosts.update(...)`. At least one field is required.
 * `null` ERASES `address` / `note`; an omitted key leaves the stored value alone.
 */
export interface UpdateBookingEventHostInput {
  name?: string;
  address?: string | null;
  note?: string | null;
  retired?: boolean;
}

/**
 * What removing an arrangement day reports. `hard` means the row itself is
 * gone; `soft` means cancelled registrations still point at it and it was kept
 * as an invisible tombstone. Either way the day is gone from every read.
 */
export interface BookingEventRemoveResult {
  success: boolean;
  mode: "hard" | "soft";
}

/**
 * Options for `bookings.payment.waitForSettlement(...)` and its manage-token
 * twin.
 */
export interface WaitForSettlementOptions {
  /**
   * How long to wait between polls. Defaults to 2500 ms on the booking-id route
   * (which shares the workspace's `apiRead` bucket) and 1000 ms on the
   * manage-token route, which has its own `apiBookingPoll` bucket at 600/min
   * precisely so a return page can poll while the customer is in the Vipps app.
   */
  intervalMs?: number;
  /** Give up after this long. Defaults to 600000 ms (ten minutes). */
  timeoutMs?: number;
}
