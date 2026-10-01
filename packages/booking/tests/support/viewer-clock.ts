import { afterAll, beforeAll } from 'vitest';

/**
 * Runs the calling test file under a viewer clock nothing like the salon's.
 *
 * Every time the booking flow shows is pinned to `Europe/Oslo`, and the machine
 * this suite usually runs on sits in Oslo too — so a component that reached for
 * `Date`'s local-time getters would render exactly the same strings and no test
 * would notice until a parent booked from Spain. Kiritimati is UTC+14: twelve
 * hours off Oslo, and on the far side of midnight for most of the working day.
 *
 * Node re-reads `process.env.TZ` on assignment, so this moves `Date` without
 * moving any formatter that names its zone — which is precisely the difference
 * the assertions are looking for.
 */
export function pinAForeignViewerClock(timeZone = 'Pacific/Kiritimati'): void {
  const original = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = timeZone;
  });

  afterAll(() => {
    // Assigning `undefined` would set the literal string "undefined" and leave
    // every later file in this worker on an invalid zone.
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}
