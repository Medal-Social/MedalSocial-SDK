import { defineConfig } from 'vitest/config';

/**
 * Two projects: `node` for everything that must run without a DOM (which is
 * nearly all of `/core`), `jsdom` for the browser-storage and address-bar
 * helpers (`*.dom.test.ts`).
 *
 * TZ is pinned to the parity fixture's own zone, as the suite these tests
 * came from pinned it; the files that care about the VIEWER's clock move it
 * away again with `pinAForeignViewerClock()`.
 */
const env = { TZ: 'Europe/Oslo' };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.dom.test.ts'],
          env,
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/**/*.dom.test.ts'],
          setupFiles: ['tests/support/dom-setup.ts'],
          env,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/core/types.ts', 'src/core/wire.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
