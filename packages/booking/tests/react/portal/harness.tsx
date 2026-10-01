/**
 * Renders a wired portal piece the way `<PortalDashboard>` does: with the kit
 * for the parity config and the test label fixture.
 */

import type { ReactNode } from 'react';
import { type ResolvedBooking, useBookingKit } from '../../../src/react/Provider';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

export function Kit({ children }: { children: (booking: ResolvedBooking) => ReactNode }) {
  return <>{children(useBookingKit({ config: PARITY_CONFIG, labels: TEST_LABELS }))}</>;
}
