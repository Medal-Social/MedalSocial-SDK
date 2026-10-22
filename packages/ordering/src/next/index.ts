/**
 * `@medalsocial/ordering/next` — the server half of a Medal ordering site.
 * Server-only: importing it from a client component fails the build.
 *
 * - `createMenuRoute(options)` — the `GET` handler for the site's menu route
 *   (`app/api/ordering/menu/route.ts`): the API key stays on the server, the
 *   menu is cached and revalidated with Medal's ETag, and the browser and CDN
 *   get `ETag`/`304` and a public `Cache-Control`.
 */

import 'server-only';

export type { MenuCacheEntry, MenuClient, MenuRouteOptions, MenuStore } from './menu-route';
export { createMenuRoute, DEFAULT_REVALIDATE_SECONDS } from './menu-route';
