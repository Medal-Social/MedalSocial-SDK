import type { components } from "../openapi.generated";

type Schemas = components["schemas"];

/** The verified street address behind a saved address. */
export type PortalOrderingAddress = Schemas["PortalOrderingAddress"];

/**
 * A delivery address saved to the customer's ordering profile. Pass `id` as
 * `saved_address_id` to `ordering.orders.create()`. `address` is `null` when
 * the verified address can no longer be read. The door code is never
 * returned; `has_door_code` says whether one is stored. `last_used_at` is
 * ISO 8601 UTC.
 */
export type PortalOrderingSavedAddress = Schemas["PortalOrderingSavedAddress"];

/** The customer's explicit ordering marketing decision, with when (ISO 8601) and where it was given. */
export type PortalOrderingMarketingConsent = Schemas["PortalOrderingMarketingConsent"];

/**
 * The signed-in customer's ordering profile: saved delivery addresses, the
 * allergy note, the cutlery and contactless defaults, favourite product ids
 * and the ordering marketing consent. Every profile write answers it.
 */
export type PortalOrderingPreferences = Schemas["PortalOrderingPreferences"];

/**
 * The body of `portal.ordering.preferences.update()`. Partial and strict:
 * only the supplied fields change, and an unknown field is a
 * `400 VALIDATION_ERROR`. `allergy_note` is at most 200 characters after
 * trimming (`null` or blank removes it); `favourites` replaces the whole list
 * (at most 30 product ids); `marketing_consent` records an explicit decision.
 */
export type PortalOrderingPreferencesPatch = Schemas["PortalOrderingPreferencesPatch"];

/**
 * The body of `portal.ordering.addresses.add()`. `address_id` is a verified
 * address from `POST /api/v1/delivery/addresses/resolve`; `label` ≤ 40,
 * `door_code` ≤ 20 (stored encrypted, never returned), `floor` ≤ 20,
 * `comment` ≤ 200 characters.
 */
export type PortalOrderingAddressInput = Schemas["PortalOrderingAddressInput"];

/** One line of a past order: the dish, how many, and the option names as ordered. */
export type PortalOrderingOrderLine = Schemas["PortalOrderingOrderLine"];

/**
 * One of the customer's past orders, from `portal.ordering.orders.list()`.
 * `status` is the same `OrderingOrderStatus` as `medal.ordering`;
 * `created_at` is ISO 8601 UTC; money is integer øre, VAT included.
 */
export type PortalOrderingOrder = Schemas["PortalOrderingOrder"];

/** A cart line priced from today's menu. Money is integer øre, VAT included. */
export type PortalOrderingReorderLine = Schemas["PortalOrderingReorderLine"];

/** A line of the old order that cannot be ordered again, and why. */
export type PortalOrderingDroppedLine = Schemas["PortalOrderingDroppedLine"];

/**
 * An old order rebuilt as a cart on today's menu, from
 * `portal.ordering.orders.reorder()`. Nothing is placed: show the cart and
 * `dropped`, then place it with `ordering.orders.create()`.
 */
export type PortalOrderingReorder = Schemas["PortalOrderingReorder"];
