import { useEffect, useState } from 'react';

/**
 * «Now» for the time step's day labels: the seed window's start for the
 * server render and the first client paint, which must agree (a deferred
 * chunk hydrating on a later `Date.now()` is React #418), then the wall clock,
 * every minute, so a wizard left open across midnight stops calling yesterday
 * «I dag».
 */
export function useWallClock(seedTs: number): number {
  const [now, setNow] = useState(seedTs);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
