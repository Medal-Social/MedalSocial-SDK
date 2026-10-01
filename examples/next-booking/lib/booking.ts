import "server-only";

import { resolveBookingConfig } from "@medalsocial/booking/core";
import { createBookingServer } from "@medalsocial/booking/next";
import { memoryCacheAdapter } from "@medalsocial/booking/next/cache/memory";

/**
 * The whole server half of a booking site: one config, one Medal key, two
 * caches. On plain `next start` both caches are the in-process LRU; a site on
 * Cloudflare Workers would pass `workersCacheAdapter` (edge) and
 * `nextDataCacheAdapter` (data) instead.
 *
 * The key and the endpoint are read per call (functions, not values), the way
 * a platform that fills `process.env` per request needs.
 */
export const config = resolveBookingConfig({
  timeZone: "Europe/Oslo",
  contact: { name: "Salong Demo", phone: "22 33 44 55", address: "Torget 1, 0001 Oslo" },
  window: { prefetchCategory: "barn" },
});

export const booking = createBookingServer({
  config,
  medal: {
    apiKey: () => process.env.MEDAL_API_KEY,
    baseUrl: () => process.env.MEDAL_API_ENDPOINT,
  },
  cache: {
    edge: memoryCacheAdapter({ maxEntries: 200 }),
    data: memoryCacheAdapter({ maxEntries: 500 }),
    prefix: "example-booking",
    environment: process.env.APP_ENV ?? "local",
  },
  logger: console,
});
