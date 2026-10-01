/**
 * The login suites' share of the test-only label fixture (see `labels.ts`):
 * the exact strings their moved assertions read, for keys the components
 * under `src/react` own. No business named.
 */

import type { BookingLabelsInput } from '../../src/react/labels';

export const LOGIN_TEST_LABELS: BookingLabelsInput = {
  'loginPage.vipps.needsEmailLogin':
    'Vi fant flere profiler på deg. Logg inn med e-post denne gangen, så kobler vi Vipps etterpå.',
  'loginPage.vipps.failed':
    'Vipps-innloggingen ble avbrutt. Prøv igjen, eller logg inn med e-post.',
};
