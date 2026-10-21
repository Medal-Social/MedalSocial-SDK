import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  OrderingChannel,
  OrderingInstantInput,
  OrderingLocations,
  OrderingMenu,
  OrderingMenuOptions,
  OrderingMenuResult,
  OrderingSlots,
  OrderingSlotsOptions,
} from "../types/ordering";

/**
 * Named so the client call below carries a flat type argument — the OpenAPI
 * coverage gate matches `this.client.<verb><T>(` without nested generics.
 */
type MenuEnvelope = ApiResponse<OrderingMenu>;
type LocationsEnvelope = ApiResponse<OrderingLocations>;
type SlotsEnvelope = ApiResponse<OrderingSlots>;

const CHANNELS: readonly OrderingChannel[] = ["dine_in", "takeaway", "delivery"];
/** The API's cap on a location id. */
const MAX_LOCATION_ID_LENGTH = 64;

/** Per-call options for ordering reads. */
export type OrderingReadOptions = Pick<RequestOptions, "signal">;

/**
 * The wire form of `at`: a `Date` as `toISOString()`, Unix milliseconds as
 * digits, a string unchanged.
 *
 * @throws RangeError for a number that is not a non-negative integer — the API
 * only takes whole milliseconds as digits, so `1.5` or `-1` would be a 400.
 */
function serialiseInstant(at: OrderingInstantInput): string {
  if (at instanceof Date) return at.toISOString();
  if (typeof at === "number") {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new RangeError(`ordering.menu: at must be whole Unix milliseconds, got ${at}`);
    }
    return String(at);
  }
  return at;
}

/**
 * Check `ordering.slots()` input before sending it, so a typo fails with a
 * clear message instead of a round trip to a 400.
 *
 * @throws RangeError for a blank or over-long location, an unknown channel,
 * or a date that is not a real `yyyy-mm-dd` calendar date.
 */
function checkSlotsOptions(options: OrderingSlotsOptions): OrderingSlotsOptions {
  const location = options.location.trim();
  if (!location || location.length > MAX_LOCATION_ID_LENGTH) {
    throw new RangeError(
      `ordering.slots: location must be 1-${MAX_LOCATION_ID_LENGTH} characters, got ${JSON.stringify(options.location)}`,
    );
  }
  if (!CHANNELS.includes(options.channel)) {
    throw new RangeError(
      `ordering.slots: channel must be one of ${CHANNELS.join(", ")}, got ${JSON.stringify(options.channel)}`,
    );
  }
  const date = options.date.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(
      `ordering.slots: date must be a real calendar date as yyyy-mm-dd, got ${JSON.stringify(options.date)}`,
    );
  }
  return { location, channel: options.channel, date };
}

/**
 * Restaurant online ordering, for the restaurant's own site. Call it
 * server-side with the workspace API key (scope `ordering.storefront.read`).
 *
 * A workspace without the online-ordering module answers every call with
 * `403 ORDERING_NOT_ENABLED`.
 */
export class Ordering {
  constructor(private client: BaseClient) {}

  /**
   * What a guest can order on one channel at one instant: active dishes in
   * open categories and time windows, with their modifier groups. Sold-out
   * dishes and options stay listed with `sold_out: true`.
   *
   * The API marks the menu `Cache-Control: private, no-store`, so cache it
   * yourself and revalidate with the ETag:
   *
   * ```ts
   * const first = await medal.ordering.menu({ channel: "takeaway" });
   * // later
   * const next = await medal.ordering.menu({ channel: "takeaway", ifNoneMatch: first.etag });
   * const menu = next.notModified ? cached : next.menu;
   * ```
   *
   * @throws RangeError before any request when `at` is a number that is not
   * whole Unix milliseconds, or an invalid `Date`.
   */
  async menu(
    options: OrderingMenuOptions,
    request?: OrderingReadOptions,
  ): Promise<OrderingMenuResult> {
    const res = await this.client.getConditional<MenuEnvelope>(
      "/api/v1/ordering/menu",
      {
        channel: options.channel,
        location: options.location,
        at: options.at === undefined ? undefined : serialiseInstant(options.at),
      },
      { signal: request?.signal, ifNoneMatch: options.ifNoneMatch },
    );
    if (res.notModified) {
      // A 304 only answers an If-None-Match, so the tag we sent is current
      // even when a proxy stripped the header from the response.
      return { notModified: true, etag: res.etag ?? options.ifNoneMatch?.trim() ?? "" };
    }
    const menu = res.body.data;
    return { notModified: false, etag: res.etag ?? menu.etag, menu };
  }

  /**
   * Every location that takes online orders, with each channel's state right
   * now (`enabled`, `open`, and when closed the `reason` and next
   * `opens_at`), payment methods, `preorder_days` and `slot_minutes`.
   * Instants are ISO 8601 UTC; render them in `data.time_zone`.
   *
   * The API marks the response `Cache-Control: private, no-store`: the open
   * state changes by the minute, so read it per request.
   */
  async locations(request?: OrderingReadOptions): Promise<LocationsEnvelope> {
    return this.client.get<LocationsEnvelope>("/api/v1/ordering/locations", undefined, {
      signal: request?.signal,
    });
  }

  /**
   * The pickup or delivery slots a guest can pick on one service date for
   * one channel at one location. `date` is in the workspace time zone and
   * must be today through today + the location's `preorder_days`
   * (`400 VALIDATION_ERROR` otherwise); an unknown location is
   * `404 NOT_FOUND`. A channel that is off or a closed day gives an empty
   * `slots` list.
   *
   * ```ts
   * const { data } = await medal.ordering.locations();
   * const loc = data.locations[0];
   * const { data: day } = await medal.ordering.slots({
   *   location: loc.id,
   *   channel: "takeaway",
   *   date: "2026-10-21",
   * });
   * ```
   *
   * @throws RangeError before any request for a blank or over-long
   * `location`, an unknown `channel`, or a `date` that is not a real
   * `yyyy-mm-dd` date.
   */
  async slots(
    options: OrderingSlotsOptions,
    request?: OrderingReadOptions,
  ): Promise<SlotsEnvelope> {
    const params = checkSlotsOptions(options);
    return this.client.get<SlotsEnvelope>(
      "/api/v1/ordering/slots",
      { location: params.location, channel: params.channel, date: params.date },
      { signal: request?.signal },
    );
  }
}
