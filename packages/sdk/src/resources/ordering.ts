import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  OrderingInstantInput,
  OrderingMenu,
  OrderingMenuOptions,
  OrderingMenuResult,
} from "../types/ordering";

/**
 * Named so the client call below carries a flat type argument — the OpenAPI
 * coverage gate matches `this.client.<verb><T>(` without nested generics.
 */
type MenuEnvelope = ApiResponse<OrderingMenu>;

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
      return { notModified: true, etag: res.etag ?? options.ifNoneMatch ?? "" };
    }
    const menu = res.body.data;
    return { notModified: false, etag: res.etag ?? menu.etag, menu };
  }
}
