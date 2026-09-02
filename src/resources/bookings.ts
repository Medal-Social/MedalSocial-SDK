import type { BaseClient, RequestOptions } from "../client";
import type {
  Booking,
  BookingActionResult,
  BookingAvailabilityOptions,
  BookingCreateResult,
  BookingRescheduleResult,
  BookingResource,
  BookingScheduleDay,
  BookingScheduleOptions,
  BookingService,
  BookingSlot,
  BookingsPage,
  CancelBookingInput,
  CreateBookingInput,
  ListBookingServicesOptions,
  ListBookingsOptions,
  ManageSummary,
  RescheduleBookingInput,
  UpdateBookingInput,
} from "../types/bookings";
import type { ApiResponse } from "../types/common";

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
  constructor(private client: BaseClient) {}

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

  constructor(private client: BaseClient) {
    this.manage = new BookingsManage(client);
  }

  /** List the bookable service catalogue. Active-only unless asked otherwise. */
  async listServices(options?: ListBookingServicesOptions): Promise<ApiResponse<BookingService[]>> {
    const params: Record<string, string | undefined> = {};
    if (options?.include_inactive !== undefined) {
      params.include_inactive = String(options.include_inactive);
    }
    return this.client.get("/api/v1/bookings/services", params);
  }

  /** List the bookable resources — staff, rooms, and equipment. */
  async listResources(): Promise<ApiResponse<BookingResource[]>> {
    return this.client.get("/api/v1/bookings/resources");
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
   */
  async list(options?: ListBookingsOptions): Promise<BookingsPage> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    if (options?.status) params.status = options.status;
    if (options?.resource_id) params.resource_id = options.resource_id;
    if (options?.from_ts !== undefined) params.from_ts = String(options.from_ts);
    if (options?.to_ts !== undefined) params.to_ts = String(options.to_ts);
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
