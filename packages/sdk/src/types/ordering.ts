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
   * Ordering location id from `ordering.locations()`. Dishes and options sold
   * out at that location carry `sold_out: true`; an unknown id is ignored.
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
   * Opaque — pass back what an earlier call returned; surrounding whitespace is trimmed before it is sent.
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

/** Why a channel is not open right now. */
export type OrderingChannelReason = Schemas["OrderingChannelReason"];

/**
 * One channel of a location, right now: `enabled` (offered at all), `open`
 * (takes orders now) and, when closed, the `reason` and the next `opens_at`.
 * Instants are ISO 8601 UTC; optional fields are omitted, never null.
 */
export type OrderingChannelState = Schemas["OrderingChannelState"];

/** A location's postal address. `region_code` is ISO 3166-1 alpha-2. */
export type OrderingLocationAddress = Schemas["OrderingLocationAddress"];

/** The state of each channel of a location, keyed by channel. */
export type OrderingLocationChannels = Schemas["OrderingLocationChannels"];

/** Which ways a guest can pay at a location. */
export type OrderingPaymentMethods = Schemas["OrderingPaymentMethods"];

/**
 * A location that takes online orders. Pass `id` as `location` to
 * `ordering.slots()`; `preorder_days` (0–7) is how far ahead it can be booked.
 */
export type OrderingLocation = Schemas["OrderingLocation"];

/** Every ordering location, and the workspace's IANA `time_zone`. */
export type OrderingLocations = Schemas["OrderingLocations"];

/** A pickup or delivery slot. `start` and `end` are ISO 8601 UTC. */
export type OrderingSlot = Schemas["OrderingSlot"];

/** The slots of one location, channel and service date. */
export type OrderingSlots = Schemas["OrderingSlots"];

/** Input for `ordering.slots()`. */
export interface OrderingSlotsOptions {
  /** Location id from `ordering.locations()`. */
  location: string;
  /** Which channel to list slots for. */
  channel: OrderingChannel;
  /**
   * Service date, `yyyy-mm-dd`, in the workspace time zone. The API accepts
   * today through today + the location's `preorder_days`; anything else is a
   * `400 VALIDATION_ERROR`.
   */
  date: string;
}
