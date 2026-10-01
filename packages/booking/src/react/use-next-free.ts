import { useEffect, useState } from 'react';
import type { BookingConfig } from '../core/config';
import {
  createNextFree,
  NEXT_FREE_TTL_MS,
  type NextFree,
  type NextFreeClient,
} from '../core/next-free';
import { useBookingKit } from './Provider';

export type { NextFree };

/** One client per site (keyed on its `paths`), so every caller shares one answer. */
const CLIENTS = new WeakMap<object, NextFreeClient>();

/** The shared `createNextFree` client for this config's `paths`. */
export function nextFreeClient(config: Pick<BookingConfig, 'paths'>): NextFreeClient {
  let client = CLIENTS.get(config.paths);
  if (client === undefined) {
    client = createNextFree(config);
    CLIENTS.set(config.paths, client);
  }
  return client;
}

type IdleWindow = {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * The business's next free time, fetched after the page is idle — never in
 * the way of the LCP or the first tap — or `null` until then (and while
 * nothing is free). Re-asked when the answer's minute is up or the quoted time
 * starts, so a visitor who lingers never reads an hour that has passed.
 * `enabled: false` asks nothing: a site whose bookings go to another provider
 * must not quote Medal's diary.
 *
 * `config` is the site's, or the nearest `BookingProvider`'s.
 */
export function useNextFree(enabled: boolean, config?: Readonly<BookingConfig>): NextFree | null {
  const client = nextFreeClient(useBookingKit({ config }).kit.config);
  const [nextFree, setNextFree] = useState<NextFree | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let refresh = 0;

    const run = () => {
      void client.fetchNextFree().then((answer) => {
        if (!alive) return;
        // A quoted time that has started is not «next free» any more.
        setNextFree(answer !== null && answer.startTs > Date.now() ? answer : null);
        const until =
          answer === null
            ? NEXT_FREE_TTL_MS
            : Math.min(NEXT_FREE_TTL_MS, answer.startTs - Date.now());
        refresh = window.setTimeout(run, Math.max(until, 1_000));
      });
    };

    const { requestIdleCallback: idle, cancelIdleCallback: cancelIdle } = window as IdleWindow;
    const handle = idle ? idle(run) : window.setTimeout(run, 1_500);
    return () => {
      alive = false;
      window.clearTimeout(refresh);
      if (idle && cancelIdle) cancelIdle(handle);
      else window.clearTimeout(handle);
    };
  }, [enabled, client]);

  return nextFree;
}
