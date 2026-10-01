import type { BaseClient, RequestOptions } from "../client";
import { sleep } from "../client";
import type {
  Booking,
  BookingActionResult,
  BookingAttentionFeed,
  BookingAvailabilityOptions,
  BookingCreateResult,
  BookingEvent,
  BookingEventHost,
  BookingEventRegistrationResult,
  BookingEventRemoveResult,
  BookingPayment,
  BookingPaymentStart,
  BookingPaymentState,
  BookingRescheduleResult,
  BookingResource,
  BookingScheduleDay,
  BookingScheduleOptions,
  BookingService,
  BookingSlot,
  BookingsPage,
  BookingsToday,
  BookingsTodayOptions,
  CancelBookingInput,
  ContactPerson,
  ContactRelations,
  CreateBookingEventHostInput,
  CreateBookingEventInput,
  CreateBookingInput,
  CreateContactPersonInput,
  CreateContactRelationInput,
  CreateContactRelationResult,
  ListBookingEventRegistrationsResult,
  ListBookingEventsOptions,
  ListBookingServicesOptions,
  ListBookingsOptions,
  ManageSummary,
  RegisterBookingEventInput,
  RescheduleBookingInput,
  StartBookingPaymentInput,
  UpdateBookingEventHostInput,
  UpdateBookingInput,
  WaitForSettlementOptions,
} from "../types/bookings";
import type { ApiResponse } from "../types/common";

/** Default poll gap on the booking-id route, which shares the `apiRead` bucket. */
const SETTLEMENT_POLL_MS = 2500;
/**
 * Default poll gap on the manage-token route. Faster on purpose: that route has
 * its own `apiBookingPoll` bucket (600/min) so a customer-facing return page can
 * poll while they are still in the Vipps app.
 */
const MANAGE_SETTLEMENT_POLL_MS = 1000;
/** Ten minutes — a Vipps payment expires before that, so waiting longer is waiting for nothing. */
const SETTLEMENT_TIMEOUT_MS = 600_000;

/**
 * Payment states that will not change on their own.
 *
 * `authorized` counts: the money is reserved and the capture is the business's
 * own next act, not the wallet's. `created` is the only live state — the
 * customer has not finished in the wallet yet.
 */
const SETTLED_PAYMENT_STATES = new Set<BookingPaymentState>([
  "authorized",
  "captured",
  "cancelled",
  "refunded",
  "failed",
  "expired",
]);

/**
 * Poll `read` until the payment reaches a state that will not change by itself.
 *
 * Modelled on `scan.waitForResult`: it RESOLVES for every settled state,
 * including the unhappy ones (check `state` and `failure_code`), and throws only
 * when the deadline passes with the payment still `created`. A 404 — the booking
 * has no payment at all — propagates as the `MedalApiError` it is, rather than
 * being polled as if a payment were on its way.
 */
async function waitForPaymentSettlement(
  read: () => Promise<ApiResponse<BookingPayment>>,
  label: string,
  defaultIntervalMs: number,
  options: WaitForSettlementOptions = {},
): Promise<BookingPayment> {
  const rawInterval = options.intervalMs ?? defaultIntervalMs;
  const rawTimeout = options.timeoutMs ?? SETTLEMENT_TIMEOUT_MS;
  // Guard against NaN, which would disable the deadline and poll forever. An
  // explicit zero or negative timeout is preserved: one poll, then give up.
  const intervalMs =
    Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : defaultIntervalMs;
  const timeoutMs = Number.isFinite(rawTimeout) ? rawTimeout : SETTLEMENT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastState: BookingPaymentState = "created";

  for (;;) {
    const { data } = await read();
    if (SETTLED_PAYMENT_STATES.has(data.state)) return data;
    lastState = data.state;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
    if (Date.now() >= deadline) break;
  }

  throw new Error(
    `Payment for ${label} did not settle within ${timeoutMs}ms (state: ${lastState})`,
  );
}

/**
 * Payments on a booking addressed by BOOKING ID — the business starting or
 * inspecting a payment for one of its own bookings.
 *
 * The outcome reaches your system through Medal, never through the browser: a
 * customer can close the tab, hit back, or edit the return URL, so treat the
 * return redirect as a hint to re-read and nothing more. Poll {@link get} on
 * your return page, or read the booking's `payment_status`.
 *
 * @example
 * ```ts
 * const { data } = await medal.bookings.payment.start("bk_1", {
 *   return_url: "https://example.no/retur",
 *   terms_accepted: true,
 * });
 * // Hand data.redirect_url to the Vipps Widget SDK, unchanged.
 * ```
 */
class BookingsPayment {
  constructor(private client: BaseClient) {}

  /**
   * Reserve (or charge) the booking's amount and get the wallet redirect.
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so its own
   * 5xx retries replay instead of reserving twice. One live payment per
   * booking — starting a second while one is outstanding answers 409; wait for
   * the first to be approved, aborted, or to expire (ten minutes).
   *
   * A `return_url` the workspace's own sites do not vouch for is refused with
   * 422, not 400: the URL parses, it is just not yours.
   */
  async start(
    id: string,
    input: StartBookingPaymentInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingPaymentStart>> {
    return this.client.postOnce(
      `/api/v1/bookings/${encodeURIComponent(id)}/payment`,
      input,
      options,
    );
  }

  /**
   * The newest payment attempt on the booking.
   *
   * Throws `MedalApiError` with status 404 when the booking has no payment at
   * all — "not started" and "unknown booking" answer alike, so this is not an
   * existence oracle. Earlier attempts are not returned; attempt N+1 is what
   * "the payment" means to a caller polling a retry.
   */
  async get(id: string): Promise<ApiResponse<BookingPayment>> {
    return this.client.get(`/api/v1/bookings/${encodeURIComponent(id)}/payment`);
  }

  /**
   * Poll {@link get} until the payment settles — the loop every return page had
   * to hand-roll, including remembering that `authorized` is already an outcome
   * and that a payment expires after ten minutes.
   *
   * Resolves for EVERY settled state (`authorized`, `captured`, `cancelled`,
   * `refunded`, `failed`, `expired`), so branch on `state` and `failure_code`
   * rather than on whether this threw. It throws only when the deadline passes
   * with the customer still in the wallet; a 404 (no payment on the booking)
   * propagates unchanged.
   *
   * @example
   * ```ts
   * const payment = await medal.bookings.payment.waitForSettlement(bookingId);
   * if (payment.state !== "authorized" && payment.state !== "captured") {
   *   return renderRetry(payment.failure_code);
   * }
   * ```
   */
  async waitForSettlement(id: string, options?: WaitForSettlementOptions): Promise<BookingPayment> {
    return waitForPaymentSettlement(
      () => this.get(id),
      `booking ${id}`,
      SETTLEMENT_POLL_MS,
      options,
    );
  }
}

/**
 * The same two payment operations, authorized by the customer's manage token
 * instead of by booking id — for relaying a click on their own confirmation
 * link. Identical wire shapes; only the credential differs.
 */
class BookingsManagePayment {
  constructor(private client: BaseClient) {}

  /** Start a payment on the customer's behalf. See {@link BookingsPayment.start}. */
  async start(
    token: string,
    input: StartBookingPaymentInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingPaymentStart>> {
    return this.client.postOnce(
      `/api/v1/bookings/manage/${encodeURIComponent(token)}/payment`,
      input,
      options,
    );
  }

  /** Read the payment on the customer's own booking. 404 when there is none. */
  async get(token: string): Promise<ApiResponse<BookingPayment>> {
    return this.client.get(`/api/v1/bookings/manage/${encodeURIComponent(token)}/payment`);
  }

  /**
   * Poll the customer's own payment until it settles. See
   * {@link BookingsPayment.waitForSettlement}; this one defaults to a 1 s gap
   * because the manage-token poll has its own `apiBookingPoll` bucket (600/min)
   * and cannot drain the salon's shared read quota.
   */
  async waitForSettlement(
    token: string,
    options?: WaitForSettlementOptions,
  ): Promise<BookingPayment> {
    return waitForPaymentSettlement(
      () => this.get(token),
      "the manage token",
      MANAGE_SETTLEMENT_POLL_MS,
      options,
    );
  }
}

/**
 * Customer-side booking management, addressed by the show-once manage token
 * from `bookings.create(...)` rather than by booking id.
 *
 * These are NOT the staff routes with a different lookup key: possession of
 * the token is the customer's own authorization, so the workspace's cancel and
 * reschedule windows are ENFORCED here (they are bypassed on
 * `bookings.cancel` / `bookings.reschedule`), and a cancel is attributed to
 * the customer rather than to staff. Relay a customer's click on their
 * confirmation-email link through these; act as the business through the
 * id-addressed methods.
 */
class BookingsManage {
  /** Payments authorized by the manage token rather than by booking id. */
  readonly payment: BookingsManagePayment;

  constructor(private client: BaseClient) {
    this.payment = new BookingsManagePayment(client);
  }

  /**
   * Read what the holder of a manage token may see and do. Honour
   * `can_cancel` / `can_reschedule` — they already apply the policy windows.
   */
  async get(token: string): Promise<ApiResponse<ManageSummary>> {
    return this.client.get(`/api/v1/bookings/manage/${encodeURIComponent(token)}`);
  }

  /** Cancel on the customer's behalf. Rejected outside the cancel window. */
  async cancel(
    token: string,
    input?: CancelBookingInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingActionResult>> {
    return this.client.postOnce(
      `/api/v1/bookings/manage/${encodeURIComponent(token)}/cancel`,
      input ?? {},
      options,
    );
  }

  /**
   * Move the booking on the customer's behalf. Rejected outside the reschedule
   * window. Returns a NEW booking id and a new manage token — the old token
   * stops working, so relay the new one into whatever link you send next.
   */
  async reschedule(
    token: string,
    input: RescheduleBookingInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingRescheduleResult>> {
    return this.client.postOnce(
      `/api/v1/bookings/manage/${encodeURIComponent(token)}/reschedule`,
      input,
      options,
    );
  }
}

/**
 * Persons a contact books for — children, pets, employees. Each has no login
 * of its own; bookings made on their behalf still hang off the contact via
 * `booked_for_person_id`.
 */
class BookingsPersons {
  constructor(private client: BaseClient) {}

  /** Persons a contact books for. Active-only unless `include_inactive`. */
  async list(
    contactId: string,
    options?: { include_inactive?: boolean },
  ): Promise<ApiResponse<ContactPerson[]>> {
    const params: Record<string, string | undefined> = { contact_id: contactId };
    if (options?.include_inactive !== undefined) {
      params.include_inactive = String(options.include_inactive);
    }
    return this.client.get("/api/v1/bookings/persons", params);
  }

  /** Add a person under a contact. */
  async create(
    input: CreateContactPersonInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<ContactPerson>> {
    return this.client.postOnce("/api/v1/bookings/persons", input, options);
  }
}

/** Directional relations between contacts — guardian, partner, employer, and so on. */
class BookingsRelations {
  constructor(private client: BaseClient) {}

  /** Relations a contact holds, split into outgoing and incoming. */
  async list(contactId: string): Promise<ApiResponse<ContactRelations>> {
    return this.client.get("/api/v1/bookings/relations", { contact_id: contactId });
  }

  /** Create a relation from one contact to another. */
  async create(
    input: CreateContactRelationInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<CreateContactRelationResult>> {
    return this.client.postOnce("/api/v1/bookings/relations", input, options);
  }
}

/**
 * Places an arrangement is held (D57) — a kindergarten, a clubhouse, the salon
 * itself. The host's address is what the confirmation e-mail prints, which is
 * why it has a route that can correct it.
 */
class BookingEventHosts {
  constructor(private client: BaseClient) {}

  /**
   * Every host, name-sorted. A public landing page resolves one by `slug`, so
   * the host id never has to appear in a URL.
   */
  async list(): Promise<ApiResponse<BookingEventHost[]>> {
    return this.client.get("/api/v1/bookings/events/hosts");
  }

  /**
   * Find-or-create a host BY NAME: `201` when a row was inserted, `200` when an
   * existing host answered the name match.
   *
   * A matched host comes back UNCHANGED — a corrected `address` sent here is
   * silently dropped, so use {@link update} to fix one.
   *
   * Automatically idempotent: the match is on name, so a retry cannot create a
   * second host, and the key makes the server replay the original response
   * rather than re-run the scan.
   */
  async create(
    input: CreateBookingEventHostInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingEventHost>> {
    return this.client.postOnce("/api/v1/bookings/events/hosts", input, options);
  }

  /**
   * Correct a host's name, address, access note or retired flag — the only
   * write that changes an EXISTING host over the API.
   *
   * `address: null` and `note: null` ERASE; an omitted key leaves the stored
   * value alone. `slug` is not patchable: it is a stable public URL segment.
   * Retiring is `{ retired: true }`, not a delete — events already point at it.
   */
  async update(
    id: string,
    input: UpdateBookingEventHostInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingEventHost>> {
    return this.client.patch(
      `/api/v1/bookings/events/hosts/${encodeURIComponent(id)}`,
      input,
      options,
    );
  }
}

/**
 * Arrangementer — scheduled group sessions bookings register against.
 */
class BookingsEvents {
  /** Places arrangementer are held. */
  readonly hosts: BookingEventHosts;

  constructor(private client: BaseClient) {
    this.hosts = new BookingEventHosts(client);
  }

  /** Arrangementer in a date range (`yyyy-mm-dd`, inclusive), optionally narrowed to one host or status. */
  async list(options: ListBookingEventsOptions): Promise<ApiResponse<BookingEvent[]>> {
    const params: Record<string, string | undefined> = { from: options.from, to: options.to };
    if (options.status) params.status = options.status;
    if (options.host_id) params.host_id = options.host_id;
    return this.client.get("/api/v1/bookings/events", params);
  }

  /** Get an arrangement by ID. */
  async get(id: string): Promise<ApiResponse<BookingEvent>> {
    return this.client.get(`/api/v1/bookings/events/${encodeURIComponent(id)}`);
  }

  /** Create an arrangement from a template. */
  async create(
    input: CreateBookingEventInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingEvent>> {
    return this.client.postOnce("/api/v1/bookings/events", input, options);
  }

  /**
   * Register a child for an arrangement. The registration lands as a
   * {@link Booking} with `event_id` set; when the arrangement's service
   * requires payment, `payment` carries the same show-once redirect
   * {@link BookingsPayment.start} does — hand it to the Vipps Widget SDK
   * unchanged. `payment` is `null` when nothing is owed.
   *
   * A payment failure does not undo the registration: check `payment_error`
   * and retry with `bookings.payment.start(booking.id, ...)` on the returned
   * booking rather than registering again.
   *
   * `contact_id` / `person_id` are the guardian's contact and the child's
   * {@link ContactPerson}, created or reused.
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so its own
   * 5xx retries replay instead of registering twice.
   */
  async register(
    id: string,
    input: RegisterBookingEventInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingEventRegistrationResult>> {
    return this.client.postOnce(
      `/api/v1/bookings/events/${encodeURIComponent(id)}/registrations`,
      input,
      options,
    );
  }

  /**
   * An arrangement's roster, ordered by `event_order`. Names come from the
   * live contact and person, not the booking's snapshot, so a renamed child
   * reads as they are now.
   *
   * Cancelled registrations are returned, not filtered — the event's
   * `registered_count` answers the capacity question separately. Capped at
   * 300 rows; `truncated: true` means the `event_order` ordering can no
   * longer be trusted.
   */
  async registrations(id: string): Promise<ApiResponse<ListBookingEventRegistrationsResult>> {
    return this.client.get(`/api/v1/bookings/events/${encodeURIComponent(id)}/registrations`);
  }

  /**
   * Remove an arrangement DAY. The one delete on the bookings surface — a
   * booking is never deleted, it is cancelled (`bookings.cancel`), which keeps
   * the row and its money trail.
   *
   * **OAuth callers need the workspace `admin` role** (`403` otherwise): the
   * dashboard's own action is admin-only, and an OAuth app acting for an
   * ordinary member must not reach further through the API than that member
   * reaches in the UI. A workspace API key is an admin-minted credential and is
   * not held to the role floor.
   *
   * A `completed` day is `422`; a day with any non-cancelled registration is
   * `409` — cancel those registrations first, which is what releases each
   * participant's place and payment hold. Unknown, malformed, cross-workspace
   * and already-removed ids are all the same `404`.
   *
   * `mode` says whether the row itself went (`hard`) or was kept as a tombstone
   * for cancelled registrations (`soft`); either way the day is gone from every
   * read.
   */
  async remove(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingEventRemoveResult>> {
    return this.client.delete(`/api/v1/bookings/events/${encodeURIComponent(id)}`, options);
  }

  /** `delete` reads better at some call sites; identical to {@link remove}. */
  async delete(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingEventRemoveResult>> {
    return this.remove(id, options);
  }
}

/** The bookable service catalogue. */
class BookingServices {
  constructor(private client: BaseClient) {}

  /** List the bookable service catalogue. Active-only unless asked otherwise. */
  async list(options?: ListBookingServicesOptions): Promise<ApiResponse<BookingService[]>> {
    const params: Record<string, string | undefined> = {};
    if (options?.include_inactive !== undefined) {
      params.include_inactive = String(options.include_inactive);
    }
    return this.client.get("/api/v1/bookings/services", params);
  }
}

/** The bookable resources — staff, rooms, and equipment. */
class BookingResources {
  constructor(private client: BaseClient) {}

  /** List the bookable resources — staff, rooms, and equipment. */
  async list(): Promise<ApiResponse<BookingResource[]>> {
    return this.client.get("/api/v1/bookings/resources");
  }
}

/**
 * Appointment bookings: the service catalogue, free slots, and the bookings
 * themselves.
 *
 * Every method here acts as the BUSINESS — policy windows are bypassed and a
 * cancel is recorded against staff. To relay a customer's own action on their
 * confirmation-email link, use {@link Bookings.manage} instead.
 *
 * Money is always integer øre (`amount_ore`, `price_ore`). Timestamps come
 * back as ISO 8601 strings; on the way in, either Unix milliseconds or an ISO
 * string is accepted.
 *
 * @example
 * ```ts
 * const { data: slots } = await medal.bookings.availability({
 *   service_id: "svc_1",
 *   from_ts: Date.now(),
 *   to_ts: Date.now() + 7 * 86_400_000,
 * });
 * const { data } = await medal.bookings.create({
 *   items: [{ service_id: "svc_1", start_ts: slots[0].start_ts! }],
 *   contact: { phone: "+4790000000", name: "Ida" },
 * });
 * ```
 */
export class Bookings {
  /** Customer-side actions addressed by manage token. */
  readonly manage: BookingsManage;
  /** Persons a contact books for — children, pets, employees. */
  readonly persons: BookingsPersons;
  /** Directional relations between contacts. */
  readonly relations: BookingsRelations;
  /** Arrangementer — scheduled group sessions bookings register against. */
  readonly events: BookingsEvents;
  /** Vipps payments on a booking, as the business. */
  readonly payment: BookingsPayment;
  /** The bookable service catalogue — `services.list()` is `listServices()`. */
  readonly services: BookingServices;
  /** The bookable resources — `resources.list()` is `listResources()`. */
  readonly resources: BookingResources;

  constructor(private client: BaseClient) {
    this.manage = new BookingsManage(client);
    this.persons = new BookingsPersons(client);
    this.relations = new BookingsRelations(client);
    this.events = new BookingsEvents(client);
    this.payment = new BookingsPayment(client);
    this.services = new BookingServices(client);
    this.resources = new BookingResources(client);
  }

  /**
   * The salon's operating summary for one local date — counts, opening window,
   * the next free gap, and the day's takings split by provider.
   *
   * The date is the WORKSPACE's: omit `date_key` and the workspace time zone
   * decides which day this is, so a caller in another zone still reads the
   * salon's Thursday.
   */
  async today(options?: BookingsTodayOptions): Promise<ApiResponse<BookingsToday>> {
    const params: Record<string, string | undefined> = {};
    if (options?.date_key !== undefined) params.date_key = String(options.date_key);
    return this.client.get("/api/v1/bookings/today", params);
  }

  /**
   * The open items a human has to act on — a failed payment, a released hold, a
   * waitlist offer about to expire, an arrangement missing consent.
   *
   * Derived on every call, and capped: `truncated` says the list is not
   * exhaustive and `total` is then a lower bound. It is NOT a page — there is no
   * cursor, because a caller that hits the cap should be clearing items rather
   * than reading further. Items carry no prose: render the sentence from `kind`.
   */
  async attention(): Promise<BookingAttentionFeed> {
    return this.client.get("/api/v1/bookings/attention");
  }

  /** List the bookable service catalogue. Active-only unless asked otherwise. */
  async listServices(options?: ListBookingServicesOptions): Promise<ApiResponse<BookingService[]>> {
    return this.services.list(options);
  }

  /** List the bookable resources — staff, rooms, and equipment. */
  async listResources(): Promise<ApiResponse<BookingResource[]>> {
    return this.resources.list();
  }

  /**
   * List free slots for a service over a window. Slots reflect opening hours,
   * time off, buffers, and existing bookings at the moment of the call — they
   * are not held, so a slot can be taken before you book it.
   */
  async availability(options: BookingAvailabilityOptions): Promise<ApiResponse<BookingSlot[]>> {
    const params: Record<string, string | undefined> = {
      service_id: options.service_id,
      from_ts: String(options.from_ts),
      to_ts: String(options.to_ts),
    };
    if (options.resource_id) params.resource_id = options.resource_id;
    return this.client.get("/api/v1/bookings/availability", params);
  }

  /**
   * The dates a service can be booked on — the half `availability` cannot
   * answer. Availability returns free slots and nothing else, so a closed day,
   * an evening past closing and a fully booked day are all the same empty
   * array. A date absent from this list is closed; on a listed date, compare
   * `last_start_ts` against the clock to tell "too late today" from "full".
   */
  async schedule(options: BookingScheduleOptions): Promise<ApiResponse<BookingScheduleDay[]>> {
    const params: Record<string, string | undefined> = {
      service_id: options.service_id,
      from_ts: String(options.from_ts),
      to_ts: String(options.to_ts),
    };
    if (options.resource_id) params.resource_id = options.resource_id;
    return this.client.get("/api/v1/bookings/schedule", params);
  }

  /**
   * List bookings with cursor-based pagination and optional filters.
   *
   * Check `pagination.truncated`: when true the read window was clipped and
   * matching bookings exist that no cursor reaches — narrow `from_ts`/`to_ts`.
   *
   * Deliberately has no `iter()` twin, unlike `contacts` / `deals` / `posts`:
   * an iterator hides `pagination`, and hiding `truncated` would turn "there
   * are bookings you cannot reach from here" into silence. Page this one by
   * hand and read the flag.
   */
  async list(options?: ListBookingsOptions): Promise<BookingsPage> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.resource_id) params.resource_id = options.resource_id;
    if (options?.from_ts !== undefined) params.from_ts = String(options.from_ts);
    if (options?.to_ts !== undefined) params.to_ts = String(options.to_ts);
    if (options?.created_via) params.created_via = options.created_via;
    return this.client.get("/api/v1/bookings", params);
  }

  /**
   * Book a party — every item succeeds or none do (max 50).
   *
   * Each created booking comes back with a `manage_token` exactly once; only
   * its hash is stored, so persist it if you need the customer's manage link.
   *
   * Automatically idempotent: the SDK mints an `Idempotency-Key` so its own
   * 5xx retries replay rather than book the slot twice. Supply
   * `options.idempotencyKey` to deduplicate across your OWN retries too — the
   * server keys on it for 24 hours, so re-sending the same key after a network
   * timeout returns the original bookings instead of a second set.
   */
  async create(
    input: CreateBookingInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingCreateResult>> {
    return this.client.postOnce("/api/v1/bookings", input, options);
  }

  /** Get a booking by ID. */
  async get(id: string): Promise<ApiResponse<Booking>> {
    return this.client.get(`/api/v1/bookings/${encodeURIComponent(id)}`);
  }

  /**
   * Annotate a booking. At least one of `notes` (customer-visible) or
   * `internal_notes` (staff-only) is required; `""` clears a field.
   */
  async update(
    id: string,
    input: UpdateBookingInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<Booking>> {
    return this.client.patch(`/api/v1/bookings/${encodeURIComponent(id)}`, input, options);
  }

  /** Cancel as the business — the cancel window is bypassed. */
  async cancel(
    id: string,
    input?: CancelBookingInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingActionResult>> {
    return this.client.postOnce(
      `/api/v1/bookings/${encodeURIComponent(id)}/cancel`,
      input ?? {},
      options,
    );
  }

  /**
   * Move a booking as the business — the reschedule window is bypassed.
   * Returns a NEW booking id and a new manage token; the old booking is
   * cancelled and its token stops working.
   */
  async reschedule(
    id: string,
    input: RescheduleBookingInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingRescheduleResult>> {
    return this.client.postOnce(
      `/api/v1/bookings/${encodeURIComponent(id)}/reschedule`,
      input,
      options,
    );
  }

  /** Mark a booking as a no-show. */
  async markNoShow(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<BookingActionResult>> {
    return this.client.postOnce(
      `/api/v1/bookings/${encodeURIComponent(id)}/no-show`,
      undefined,
      options,
    );
  }
}
