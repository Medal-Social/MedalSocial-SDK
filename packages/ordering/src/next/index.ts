/**
 * `@medalsocial/ordering/next` — the server half of a Medal ordering site.
 * Server-only: importing it from a client component fails the build.
 *
 * Each factory returns a Next App Router handler built on Web
 * `Request`/`Response` only; the workspace API key stays on the server, and
 * every failure is a fixed-word `{ error: { code, message } }` (see
 * `OrderingRouteErrorCode` in `/core`) that never carries the key.
 *
 * - `createMenuRoute(options)` — `GET` the menu, cached and revalidated with
 *   Medal's ETag; the browser and CDN get `ETag`/`304` and a public
 *   `Cache-Control`.
 * - `createLocationsRoute(options)` — `GET` the locations and their open
 *   state, kept 15 s.
 * - `createSlotsRoute(options)` — `GET ?channel=&date=` the pickup or
 *   delivery slots of the configured location.
 * - `createTableRoute(options)` — `GET ?t=` a table QR token's location and label.
 * - `createPlaceOrderRoute(options)` — `POST` the guest's order (same-origin
 *   JSON with an `Idempotency-Key`); the location and Vipps return page come
 *   from the options, never the browser.
 * - `createOrderRoute(options)` / `createOrderStatusRoute(options)` —
 *   `GET ?id=` an order for the receipt, or its status to poll.
 * - `createVippsReturnRoute(options)` — `GET` where Vipps sends the guest
 *   back: a `303` to the receipt page.
 */

import 'server-only';

export type { LocationsClient, LocationsRouteOptions } from './locations-route';
export { createLocationsRoute } from './locations-route';
export type { MenuCacheEntry, MenuClient, MenuRouteOptions, MenuStore } from './menu-route';
export { createMenuRoute, DEFAULT_REVALIDATE_SECONDS } from './menu-route';
export type {
  OrderClient,
  OrderRouteOptions,
  OrderStatusClient,
  OrderStatusRouteOptions,
} from './order-routes';
export { createOrderRoute, createOrderStatusRoute } from './order-routes';
export type { PlaceOrderClient, PlaceOrderRouteOptions } from './place-order-route';
export { createPlaceOrderRoute } from './place-order-route';
export type { RouteBaseOptions } from './shared';
export type { SlotsClient, SlotsRouteOptions } from './slots-route';
export { createSlotsRoute } from './slots-route';
export type { TableClient, TableRouteOptions } from './table-route';
export { createTableRoute } from './table-route';
export type { VippsReturnClient, VippsReturnRouteOptions } from './vipps-return-route';
export { createVippsReturnRoute } from './vipps-return-route';
