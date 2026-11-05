import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  PortalOrderingAddressInput,
  PortalOrderingOrder,
  PortalOrderingPreferences,
  PortalOrderingPreferencesPatch,
  PortalOrderingReorder,
} from "../types/portal-ordering";

/**
 * Named so the client calls below carry a flat type argument — the OpenAPI
 * coverage gate matches `this.client.<verb><T>(` without nested generics.
 */
type PreferencesEnvelope = ApiResponse<PortalOrderingPreferences>;
type OrdersEnvelope = ApiResponse<PortalOrderingOrder[]>;
type ReorderEnvelope = ApiResponse<PortalOrderingReorder>;

/** The API's cap on a saved-address, product or order id. */
const MAX_PATH_ID_LENGTH = 64;

/** The per-request options a session-bound portal call sends. */
function withSession(session: string): RequestOptions {
  return { headers: { "x-portal-session": session } };
}

/**
 * Same as `withSession`, sent exactly once: for writes whose first attempt may
 * have SUCCEEDED while the response was lost, where a retry would repeat a
 * consent event, save the address twice or report a removal as a 404.
 */
function once(session: string): RequestOptions {
  return { ...withSession(session), retry: false };
}

/**
 * Check an id before it goes into a path.
 *
 * @throws RangeError for a blank, over-long or dot-segment value.
 */
function checkPathId(method: string, name: string, value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > MAX_PATH_ID_LENGTH) {
    throw new RangeError(
      `${method}: ${name} must be 1-${MAX_PATH_ID_LENGTH} characters, got ${JSON.stringify(value)}`,
    );
  }
  // `encodeURIComponent` leaves `.` and `..` alone and URL parsing resolves
  // them as path segments, so `..` would send the call to another route.
  if (trimmed === "." || trimmed === "..") {
    throw new RangeError(`${method}: ${name} must not be ${JSON.stringify(trimmed)}`);
  }
  return trimmed;
}

/** The ordering profile itself: `medal.portal.ordering.preferences`. */
export class PortalOrderingPreferencesApi {
  constructor(private client: BaseClient) {}

  /** The signed-in customer's ordering profile. */
  async get(session: string): Promise<PreferencesEnvelope> {
    return this.client.get<PreferencesEnvelope>(
      "/api/v1/portal/ordering/preferences",
      undefined,
      withSession(session),
    );
  }

  /**
   * Change the allergy note, the cutlery and contactless defaults, the whole
   * favourites list or the marketing consent. Only the supplied fields
   * change; `allergy_note: null` (or blank) removes the note. Answers the
   * profile as it is after the change.
   *
   * Sent exactly once: a `marketing_consent` change records a dated consent
   * event, which a retry after a committed-but-lost response would repeat.
   * Errors: `400 VALIDATION_ERROR`, `422 FAVOURITE_LIMIT`,
   * `422 PRODUCT_NOT_FOUND`.
   */
  async update(
    session: string,
    patch: PortalOrderingPreferencesPatch,
  ): Promise<PreferencesEnvelope> {
    return this.client.put<PreferencesEnvelope>(
      "/api/v1/portal/ordering/preferences",
      patch,
      once(session),
    );
  }
}

/** Saved delivery addresses: `medal.portal.ordering.addresses`. */
export class PortalOrderingAddresses {
  constructor(private client: BaseClient) {}

  /**
   * Save a verified delivery address (from
   * `POST /api/v1/delivery/addresses/resolve`) to the profile. `door_code` is
   * stored encrypted and never returned. Answers the profile (201).
   *
   * At most five addresses: `422 ADDRESS_LIMIT`. An `address_id` that is not
   * a verified address: `422 ADDRESS_NOT_VERIFIED`. Sent exactly once: a
   * retry after a committed-but-lost response would save it twice.
   */
  async add(session: string, input: PortalOrderingAddressInput): Promise<PreferencesEnvelope> {
    return this.client.post<PreferencesEnvelope>(
      "/api/v1/portal/ordering/addresses",
      input,
      once(session),
    );
  }

  /**
   * Remove a saved address by its `id`. Answers the profile. Another
   * customer's address and an unknown id are the same
   * `404 ADDRESS_NOT_FOUND`. Sent exactly once: a retry would report the
   * completed removal as that 404.
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async remove(session: string, addressId: string): Promise<PreferencesEnvelope> {
    const id = checkPathId("portal.ordering.addresses.remove", "addressId", addressId);
    return this.client.delete<PreferencesEnvelope>(
      `/api/v1/portal/ordering/addresses/${encodeURIComponent(id)}`,
      once(session),
    );
  }
}

/** Favourite products, one at a time: `medal.portal.ordering.favourites`. */
export class PortalOrderingFavourites {
  constructor(private client: BaseClient) {}

  /**
   * Mark a product as a favourite. Adding one that is already there changes
   * nothing, so a retry is safe. Answers the profile. At most 30:
   * `422 FAVOURITE_LIMIT`; a product that is not active:
   * `422 PRODUCT_NOT_FOUND`.
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async add(session: string, productId: string): Promise<PreferencesEnvelope> {
    const product_id = checkPathId("portal.ordering.favourites.add", "productId", productId);
    return this.client.put<PreferencesEnvelope>(
      `/api/v1/portal/ordering/favourites/${encodeURIComponent(product_id)}`,
      undefined,
      withSession(session),
    );
  }

  /**
   * Unmark a favourite. Removing one that is not there changes nothing, so a
   * retry is safe. Answers the profile.
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async remove(session: string, productId: string): Promise<PreferencesEnvelope> {
    const product_id = checkPathId("portal.ordering.favourites.remove", "productId", productId);
    return this.client.delete<PreferencesEnvelope>(
      `/api/v1/portal/ordering/favourites/${encodeURIComponent(product_id)}`,
      withSession(session),
    );
  }
}

/** Order history and «order again»: `medal.portal.ordering.orders`. */
export class PortalOrderingOrders {
  constructor(private client: BaseClient) {}

  /** The customer's last 10 orders, newest first. */
  async list(session: string): Promise<OrdersEnvelope> {
    return this.client.get<OrdersEnvelope>(
      "/api/v1/portal/ordering/orders",
      undefined,
      withSession(session),
    );
  }

  /**
   * Rebuild one of the customer's orders as a cart on today's menu. Places
   * nothing: lines that cannot be ordered again are listed in `dropped`
   * (`sold_out`, `removed`, `unavailable`); place the cart with
   * `medal.ordering.orders.create()`. An order that is not this customer's is
   * `404 ORDER_NOT_FOUND`.
   *
   * ```ts
   * const { data: cart } = await medal.portal.ordering.orders.reorder(session, orderId);
   * if (cart.dropped.length) warn(cart.dropped.map((d) => d.name));
   * ```
   *
   * @throws RangeError before any request for a blank or over-long id.
   */
  async reorder(session: string, orderId: string): Promise<ReorderEnvelope> {
    const order_id = checkPathId("portal.ordering.orders.reorder", "orderId", orderId);
    return this.client.post<ReorderEnvelope>(
      `/api/v1/portal/ordering/orders/${encodeURIComponent(order_id)}/reorder`,
      undefined,
      withSession(session),
    );
  }
}

/**
 * The signed-in customer's restaurant ordering profile, history and reorder:
 * `medal.portal.ordering`. Same credentials as the rest of `medal.portal` —
 * the site's API key (`read:portal` / `write:portal`) and the session token,
 * passed FIRST and sent as `X-Portal-Session`. Every response is per customer
 * and `no-store`.
 *
 * A workspace without the online-ordering module answers
 * `403 ORDERING_NOT_ENABLED`; a missing or dead session
 * `401 PORTAL_SESSION_REQUIRED` / `PORTAL_SESSION_INVALID`.
 */
export class PortalOrdering {
  /** Allergy note, defaults, favourites list and marketing consent: `get`, `update`. */
  readonly preferences: PortalOrderingPreferencesApi;
  /** Saved delivery addresses: `add`, `remove`. */
  readonly addresses: PortalOrderingAddresses;
  /** Favourite products one at a time: `add`, `remove`. */
  readonly favourites: PortalOrderingFavourites;
  /** Order history and reorder: `list`, `reorder`. */
  readonly orders: PortalOrderingOrders;

  constructor(client: BaseClient) {
    this.preferences = new PortalOrderingPreferencesApi(client);
    this.addresses = new PortalOrderingAddresses(client);
    this.favourites = new PortalOrderingFavourites(client);
    this.orders = new PortalOrderingOrders(client);
  }
}

/**
 * `medal.portal.session(token).ordering` — the same calls with the session
 * token already bound, so an id and the token cannot be swapped. Every method
 * forwards to its flat twin on {@link PortalOrdering}; behaviour (including
 * which calls are sent exactly once) is identical.
 */
export class PortalOrderingSessionScope {
  constructor(
    private ordering: PortalOrdering,
    private token: string,
  ) {}

  /** The ordering profile. See {@link PortalOrderingPreferencesApi.get}. */
  async preferences(): Promise<PreferencesEnvelope> {
    return this.ordering.preferences.get(this.token);
  }

  /** Change the profile. See {@link PortalOrderingPreferencesApi.update}. */
  async updatePreferences(patch: PortalOrderingPreferencesPatch): Promise<PreferencesEnvelope> {
    return this.ordering.preferences.update(this.token, patch);
  }

  /** Save a verified address. See {@link PortalOrderingAddresses.add}. */
  async addAddress(input: PortalOrderingAddressInput): Promise<PreferencesEnvelope> {
    return this.ordering.addresses.add(this.token, input);
  }

  /** Remove a saved address. See {@link PortalOrderingAddresses.remove}. */
  async removeAddress(addressId: string): Promise<PreferencesEnvelope> {
    return this.ordering.addresses.remove(this.token, addressId);
  }

  /** Add a favourite. See {@link PortalOrderingFavourites.add}. */
  async addFavourite(productId: string): Promise<PreferencesEnvelope> {
    return this.ordering.favourites.add(this.token, productId);
  }

  /** Remove a favourite. See {@link PortalOrderingFavourites.remove}. */
  async removeFavourite(productId: string): Promise<PreferencesEnvelope> {
    return this.ordering.favourites.remove(this.token, productId);
  }

  /** The last 10 orders. See {@link PortalOrderingOrders.list}. */
  async orders(): Promise<OrdersEnvelope> {
    return this.ordering.orders.list(this.token);
  }

  /** Rebuild an order as a cart. See {@link PortalOrderingOrders.reorder}. */
  async reorder(orderId: string): Promise<ReorderEnvelope> {
    return this.ordering.orders.reorder(this.token, orderId);
  }
}
