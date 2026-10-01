/**
 * «Neste ledige» — the business's next free time — fetched once and shared by
 * every component on the page that shows it (a sticky bar, a hero chip), but
 * only briefly: a minute at most, never past the start it quotes, and a
 * failure is not kept.
 *
 * The endpoint is `<paths.api>/next-free`, answered by `/next`'s handler (P4)
 * from the booking seed. The React hook that schedules this after idle lives in
 * `/react`; this is the part with no React in it.
 */

import type { BookingConfig } from './config';

export interface NextFree {
  startTs: number;
  /** `i dag 11:00`, on the business's clock. */
  label: string;
}

/**
 * How long an answer is trusted: the booking seed it comes from turns over
 * every 30 s, so a minute keeps the bar honest without a request per render.
 */
export const NEXT_FREE_TTL_MS = 60_000;

export interface NextFreeClient {
  readonly endpoint: string;
  fetchNextFree(now?: number): Promise<NextFree | null>;
  /** Test seam: forget the cached answer. */
  resetNextFree(): void;
}

/**
 * One request in flight, and one answer shared by every caller of this client
 * — but only for `NEXT_FREE_TTL_MS`, and never past the start it quotes.
 */
export function createNextFree(config: Pick<BookingConfig, 'paths'>): NextFreeClient {
  const endpoint = `${config.paths.api}/next-free`;
  let inFlight: Promise<NextFree | null> | null = null;
  let cached: { value: NextFree; until: number } | null = null;

  function fetchNextFree(now: number = Date.now()): Promise<NextFree | null> {
    if (cached && now < cached.until) return Promise.resolve(cached.value);
    cached = null;
    inFlight ??= fetch(endpoint)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { startTs?: unknown; label?: unknown } | null) =>
        typeof body?.startTs === 'number' && typeof body.label === 'string'
          ? { startTs: body.startTs, label: body.label }
          : null
      )
      .catch(() => null)
      .then((value) => {
        inFlight = null;
        if (value !== null) {
          cached = { value, until: Math.min(Date.now() + NEXT_FREE_TTL_MS, value.startTs) };
        }
        return value;
      });
    return inFlight;
  }

  function resetNextFree() {
    inFlight = null;
    cached = null;
  }

  return { endpoint, fetchNextFree, resetNextFree };
}
