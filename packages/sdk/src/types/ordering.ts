import type { components } from "../openapi.generated";

type Schemas = components["schemas"];

/** The channel a menu is read for. Closed: anything else is a 400. */
export type OrderingChannel = Schemas["OrderingChannel"];

/** The 14 EU-declarable allergens (Regulation 1169/2011, Annex II). */
export type OrderingAllergen = Schemas["OrderingAllergen"];

/** Dietary labels a dish can carry. */
export type OrderingDietary = Schemas["OrderingDietary"];

/** One choice inside a modifier group. `price_delta_ore` is added to the dish price. */
export type OrderingModifierOption = Schemas["OrderingModifierOption"];

/** A group of options on a dish, with how many the guest must/may pick. */
export type OrderingModifierGroup = Schemas["OrderingModifierGroup"];

/**
 * A dish as a guest sees it on one channel. Money is integer øre, VAT
 * included; `vat_bp` is the channel's rate in basis points (1500 = 15 %).
 * `description` and `image_url` are omitted when unset.
 */
export type OrderingMenuItem = Schemas["OrderingMenuItem"];

/** A menu category and the dishes in it. */
export type OrderingMenuCategory = Schemas["OrderingMenuCategory"];

/** The menu for one channel at one instant. `at` is ISO 8601. */
export type OrderingMenu = Schemas["OrderingMenu"];

/**
 * The instant to read the menu at: a `Date`, an ISO 8601 date-time with `Z`
 * or an explicit offset, or Unix milliseconds. The API accepts one day back to
 * 60 days ahead; anything else is a `400 VALIDATION_ERROR`.
 */
export type OrderingInstantInput = Date | string | number;

/** Input for `ordering.menu()`. */
export interface OrderingMenuOptions {
  /** Which channel to read the menu for. */
  channel: OrderingChannel;
  /**
   * Ordering location id. Accepted but ignored by the API until multi-location
   * ordering ships.
   */
  location?: string;
  /**
   * Read the menu as it will be at this instant (a scheduled pickup or
   * delivery time). Defaults to now on the server.
   */
  at?: OrderingInstantInput;
  /**
   * The `etag` of a menu you already hold. When it is still current the call
   * resolves `{ notModified: true }` without downloading the menu again.
   * Opaque — pass back exactly what an earlier call returned.
   */
  ifNoneMatch?: string;
}

/**
 * What `ordering.menu()` resolves to: either a fresh menu and its ETag, or
 * `notModified: true` when the `ifNoneMatch` you sent is still current — keep
 * using the menu you have.
 */
export type OrderingMenuResult =
  | { notModified: false; etag: string; menu: OrderingMenu }
  | { notModified: true; etag: string };
