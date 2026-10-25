import { afterAll, beforeAll } from 'vitest';

/**
 * Runs the calling test file under a process clock nothing like the
 * restaurant's (as in @medalsocial/booking). Kiritimati is UTC+14, twelve
 * hours off Oslo. Node re-reads `process.env.TZ` on assignment, so this moves
 * `Date`'s local-time getters without moving any formatter that names its zone.
 */
export function pinAForeignViewerClock(timeZone = 'Pacific/Kiritimati'): void {
  const original = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = timeZone;
  });

  afterAll(() => {
    // Assigning `undefined` would set the literal string "undefined".
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}
