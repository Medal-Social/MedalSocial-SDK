/**
 * Hard cap on `config.window.rangeDays` and on what the availability routes
 * will fetch. One named constant so the clock, the zod schema and the route
 * parser cannot disagree about the number.
 */
export const WINDOW_MAX_RANGE_DAYS = 62;

/**
 * Millisecond bound matching {@link WINDOW_MAX_RANGE_DAYS} × 24h.
 *
 * A window built from calendar midnights can be a little longer than this
 * across a DST fall-back — Europe/Oslo gains an hour on the last Sunday of
 * October — so both `Clock.window` and the route parser clamp `toTs` to
 * `fromTs + MAX_RANGE_MS` rather than 400ing a legal 62-day ask. A span that
 * still overshoots after {@link MAX_RANGE_OVERSHOOT_MS} is refused as
 * genuinely oversized.
 */
export const MAX_RANGE_MS = WINDOW_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * How far past {@link MAX_RANGE_MS} a visitor-controlled `to_ts` may still be
 * accepted (and then clamped). One hour covers a single DST fall-back; anything
 * wider is a genuinely oversized range and answers 400.
 */
export const MAX_RANGE_OVERSHOOT_MS = 60 * 60 * 1000;
