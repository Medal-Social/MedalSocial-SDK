import { afterEach, beforeEach, vi } from "vitest";

// The retry, Retry-After and polling paths genuinely sleep, and the suite
// asserts on those waits (e.g. "elapsed >= the server's Retry-After"). Run them
// on virtual time: `nextTimerAsync` jumps straight to the next pending timer
// once the current macrotask settles, and `Date` moves with it, so every wait
// is still taken in the same order and measured — it just costs no wall time.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setTimerTickMode("nextTimerAsync");
});

afterEach(() => {
  vi.useRealTimers();
});
