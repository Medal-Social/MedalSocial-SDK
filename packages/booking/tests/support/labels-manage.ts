/**
 * The manage suites' share of the test-only label fixture (see `labels.ts`):
 * the exact strings their moved assertions read, for keys the components
 * under `src/react` own. No business named.
 */

import type { BookingLabelsInput } from '../../src/react/labels';

export const MANAGE_TEST_LABELS: BookingLabelsInput = {
  // The calendar entry's price line, as the source wrote it.
  'manage.ics.price': '{price} · betales i salongen',
};
