/**
 * The portal suites' share of the test-only label fixture (see `labels.ts`):
 * the exact strings their moved assertions read, for keys the components
 * under `src/react` own. No business named.
 */

import type { BookingLabelsInput } from '../../src/react/labels';

export const PORTAL_TEST_LABELS: BookingLabelsInput = {
  'portal.tab.family': 'Mine barn',
  'portal.family.heading': 'Mine barn',
  'portal.family.lead':
    'Vi husker hva som fungerer for hvert barn, så du slipper å forklare på nytt hver gang.',
};
