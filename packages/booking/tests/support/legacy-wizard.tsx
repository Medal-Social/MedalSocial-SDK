/**
 * The wizard under the props the moved suites were written against — the
 * source app's `<BookingWizard services phone address initialSlots …>` — so
 * their render calls stay as they were. It maps them onto the package's
 * `config` / `seed` / `labels` / `actions` and changes nothing else.
 *
 * `phone` and `address` default to `null`, as the source's did; the parity
 * config is rebuilt with them as its contact (one config per pair, so a
 * re-render keeps the same kit).
 */

import { resolveBookingConfig } from '../../src/core/config';
import type {
  BookingDayDto,
  BookingGuardian,
  BookingResourceDto,
  BookingServiceDto,
  BookingSlotDto,
} from '../../src/core/types';
import type { PortalActions } from '../../src/react/actions';
import { BookingWizard as PackageWizard } from '../../src/react/BookingWizard';
import { TEST_LABELS } from './labels';
import { PARITY_CONFIG } from './parity-config';

export interface LegacyWizardProps {
  services: BookingServiceDto[];
  phone?: string | null;
  address?: string | null;
  initialSlots?: Record<string, BookingSlotDto[]>;
  initialResources?: BookingResourceDto[] | null;
  initialNextAvailable?: Record<string, Record<string, number>>;
  initialSchedule?: Record<string, BookingDayDto[]>;
  rangeStart?: number;
  rangeDays?: number;
  guardian?: BookingGuardian | null;
  /** `config.account.required` — a booking only for a logged-in parent. */
  accountRequired?: boolean;
}

const CONFIGS = new Map<string, ReturnType<typeof resolveBookingConfig>>();

/** The parity config with this contact. */
export function parityConfigWith(
  phone: string | null,
  address: string | null,
  accountRequired = false
) {
  const key = JSON.stringify([phone, address, accountRequired]);
  let config = CONFIGS.get(key);
  if (config === undefined) {
    config = resolveBookingConfig({
      ...PARITY_CONFIG,
      contact: { ...PARITY_CONFIG.contact, phone, address },
      account: { required: accountRequired },
    });
    CONFIGS.set(key, config);
  }
  return config;
}

let ACTIONS: Pick<PortalActions, 'startLogin' | 'startVipps'> = {
  startLogin: async () => ({ status: 'sent' }),
};

/** The login actions every legacy render hands the wizard (the suites mock them). */
export function setLegacyWizardActions(actions: Pick<PortalActions, 'startLogin' | 'startVipps'>) {
  ACTIONS = actions;
}

export function BookingWizard({
  services,
  phone = null,
  address = null,
  initialSlots,
  initialResources,
  initialNextAvailable,
  initialSchedule,
  rangeStart,
  rangeDays,
  guardian,
  accountRequired = false,
}: LegacyWizardProps) {
  return (
    <PackageWizard
      config={parityConfigWith(phone, address, accountRequired)}
      labels={TEST_LABELS}
      actions={ACTIONS}
      seed={{
        services,
        resources: initialResources,
        slots: initialSlots,
        nextAvailable: initialNextAvailable,
        schedules: initialSchedule,
        fromTs: rangeStart,
      }}
      rangeDays={rangeDays}
      guardian={guardian}
    />
  );
}
