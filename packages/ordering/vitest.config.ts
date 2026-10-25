import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Three projects, as in @medalsocial/booking: `node` for everything that must
 * run without a DOM (nearly all of `/core`), `jsdom` for the browser-storage
 * helpers (`*.dom.test.ts`), and `react` for the components (`tests/react/`).
 */
const env = { TZ: 'Europe/Oslo' };

/**
 * `/next` imports `server-only`, which throws outside an RSC build; and the
 * SDK resolves to its SOURCE here (as the typecheck does), so the suite needs
 * no SDK build first.
 */
const resolve = {
  alias: {
    'server-only': join(__dirname, 'tests/support/server-only.ts'),
    '@medalsocial/sdk': join(__dirname, '../sdk/src/index.ts'),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.dom.test.ts', 'tests/react/**'],
          env,
        },
      },
      {
        resolve,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/**/*.dom.test.ts'],
          env,
        },
      },
      {
        resolve,
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['tests/react/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/support/dom-setup.ts', 'tests/support/react-setup.ts'],
          env,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
