/**
 * `@medalsocial/booking/next/cache/noop` — a cache that never holds anything.
 *
 * Every read is a miss and every write is dropped, and its `key()` answers
 * `null`, so the booking seed takes its «no cache here» path (`bypass`) and
 * reads Medal through the data cache. For tests, draft mode, and a site that
 * wants every request live.
 */

import 'server-only';

import type { BookingCacheAdapter } from '../options';

export function noopCacheAdapter(): BookingCacheAdapter {
  return {
    async get() {
      return undefined;
    },
    async put() {},
    async delete() {},
    async expireTag() {},
    key: () => null,
  };
}
