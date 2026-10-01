/**
 * A `BookingRuntime` for the `/next` tests: the parity config, a silent but
 * recording logger, no caches, and every part replaceable — the moved tests
 * swap in exactly the seams their source mocked by module path.
 */

import { vi } from 'vitest';
import { noopCacheAdapter } from '../../src/next/cache/noop';
import type { BookingServerOptions } from '../../src/next/options';
import { type BookingRuntime, createBookingRuntime } from '../../src/next/runtime';
import { PARITY_CONFIG } from './parity-config';

type LogFn = ReturnType<typeof vi.fn<(meta: unknown, message?: string) => void>>;

export function testLogger(): { error: LogFn; warn: LogFn; info: LogFn } {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

export function testOptions(overrides: Partial<BookingServerOptions> = {}): BookingServerOptions {
  return {
    config: PARITY_CONFIG,
    medal: { apiKey: 'sk_test', baseUrl: 'https://api.example.com' },
    cache: {
      edge: noopCacheAdapter(),
      data: noopCacheAdapter(),
      prefix: 'demo-booking',
      environment: 'unknown',
    },
    logger: testLogger(),
    ...overrides,
  };
}

export function testRuntime(
  overrides: Partial<BookingRuntime> = {},
  options: Partial<BookingServerOptions> = {}
): BookingRuntime {
  return createBookingRuntime(testOptions(options), overrides);
}

/** An in-memory cookie jar with the calls recorded, for `options.cookies`. */
export function testCookieJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const jar = {
    get: vi.fn((name: string) => (values.has(name) ? { value: values.get(name) } : undefined)),
    set: vi.fn((name: string, value: string) => {
      values.set(name, value);
    }),
    delete: vi.fn((options: { name: string }) => {
      values.delete(options.name);
    }),
  };
  return { jar, values, source: async () => jar };
}
