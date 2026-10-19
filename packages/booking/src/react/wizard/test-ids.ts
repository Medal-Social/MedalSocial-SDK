/**
 * Stable `data-testid` values on the wizard for synthetic monitoring and
 * promote gates. Naming: `booking-` prefix, then the role (`step-…`,
 * `…-option`, `day`, `slot`, `slots-error`, `slots-empty`). Option nodes may
 * also carry a identifying data attribute (`data-service-id`,
 * `data-resource-id`, `data-day-ts`, `data-start-ts`).
 *
 * `booking-day` is on each day-strip chip (the primary day picker). The optional
 * month grid shows the same days; monitors should prefer the strip.
 */

export const BOOKING_TEST_IDS = {
  stepWho: 'booking-step-who',
  stepService: 'booking-step-service',
  stepStylist: 'booking-step-stylist',
  stepCalendar: 'booking-step-calendar',
  serviceOption: 'booking-service-option',
  stylistOption: 'booking-stylist-option',
  day: 'booking-day',
  slot: 'booking-slot',
  slotsError: 'booking-slots-error',
  slotsEmpty: 'booking-slots-empty',
} as const;

export type BookingTestId = (typeof BOOKING_TEST_IDS)[keyof typeof BOOKING_TEST_IDS];

/** Class stamped onto meda's empty-day card so we can attach {@link BOOKING_TEST_IDS.slotsEmpty}. */
export const BOOKING_SLOTS_EMPTY_MARKER = 'booking-slots-empty-marker';
