/**
 * How far one booking read may reach — shared by the config schema
 * (`window.rangeDays`), the read routes' range guard (`parseRange`) and the
 * catalogue's cache horizon, so the three cannot disagree.
 */

/**
 * The longest calendar window a booking page may ask for, in days — the
 * `window.rangeDays` ceiling.
 */
export const MAX_RANGE_DAYS = 62;

/**
 * The longest stretch, in milliseconds, a booking read may cover: the widest
 * `window()` there is, at its worst.
 *
 * NOT `MAX_RANGE_DAYS × 24 h`. `window()` ends at a business midnight, and a
 * stretch of calendar days holding the autumn clock change is an hour longer
 * than its days × 24 h. A page opened just after midnight with the widest
 * window would ask for 62 days and up to an hour more — which a bare
 * `62 × 24 h` cap refused, every night for the eight weeks before the change,
 * for every service the page had not been seeded with. The one DST hour is
 * the most any zone's clock change adds (Lord Howe's is half that).
 *
 * The config schema, the read routes' range guard and the catalogue's cache
 * horizon all read these two constants, so they cannot drift apart again;
 * `tests/next/range-bound.test.ts` pins the window to the guard.
 */
export const MAX_RANGE_MS = MAX_RANGE_DAYS * 86_400_000 + 3_600_000;
