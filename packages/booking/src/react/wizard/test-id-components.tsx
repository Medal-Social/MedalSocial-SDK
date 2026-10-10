/**
 * Meda card wrappers that add the wizard's stable `data-testid`s without
 * changing layout or behaviour. A `display: contents` span keeps flex/grid
 * geometry identical to an unwrapped card.
 */

import {
  type DayChipProps,
  DefaultDayChip,
  DefaultServiceCard,
  DefaultStylistCard,
  DefaultTimeChip,
  type ServiceCardProps,
  type StylistCardProps,
  type TimeChipProps,
} from '@medalsocial/meda/booking';
import { type ComponentType, type ReactNode, useLayoutEffect, useRef } from 'react';
import { BOOKING_SLOTS_EMPTY_MARKER, BOOKING_TEST_IDS } from './test-ids';

function TestIdShell({
  testId,
  attrs,
  children,
}: {
  testId: string;
  attrs?: Record<string, string | undefined>;
  children: ReactNode;
}) {
  return (
    <span data-testid={testId} className="contents" {...attrs}>
      {children}
    </span>
  );
}

/** Wrap a site override (or the meda default) so the test id always lands. */
export function withServiceOptionTestId(
  Inner?: ComponentType<ServiceCardProps>
): ComponentType<ServiceCardProps> {
  const Card = Inner ?? DefaultServiceCard;
  function ServiceOption(props: ServiceCardProps) {
    return (
      <TestIdShell
        testId={BOOKING_TEST_IDS.serviceOption}
        attrs={{ 'data-service-id': props.service.id }}
      >
        <Card {...props} />
      </TestIdShell>
    );
  }
  ServiceOption.displayName = 'BookingServiceOption';
  return ServiceOption;
}

export function withStylistOptionTestId(
  Inner?: ComponentType<StylistCardProps>
): ComponentType<StylistCardProps> {
  const Card = Inner ?? DefaultStylistCard;
  function StylistOption(props: StylistCardProps) {
    return (
      <TestIdShell
        testId={BOOKING_TEST_IDS.stylistOption}
        attrs={{ 'data-resource-id': props.option.resourceId ?? 'first' }}
      >
        <Card {...props} />
      </TestIdShell>
    );
  }
  StylistOption.displayName = 'BookingStylistOption';
  return StylistOption;
}

export function withDayTestId(Inner?: ComponentType<DayChipProps>): ComponentType<DayChipProps> {
  const Chip = Inner ?? DefaultDayChip;
  function Day(props: DayChipProps) {
    return (
      <TestIdShell testId={BOOKING_TEST_IDS.day} attrs={{ 'data-day-ts': String(props.dayTs) }}>
        <Chip {...props} />
      </TestIdShell>
    );
  }
  Day.displayName = 'BookingDay';
  return Day;
}

export function withSlotTestId(Inner?: ComponentType<TimeChipProps>): ComponentType<TimeChipProps> {
  const Chip = Inner ?? DefaultTimeChip;
  function Slot(props: TimeChipProps) {
    return (
      <TestIdShell
        testId={BOOKING_TEST_IDS.slot}
        attrs={{ 'data-start-ts': String(props.startTs) }}
      >
        <Chip {...props} />
      </TestIdShell>
    );
  }
  Slot.displayName = 'BookingSlot';
  return Slot;
}

/**
 * Meda's empty-day card only accepts a className. Mark it, then promote the
 * marker to {@link BOOKING_TEST_IDS.slotsEmpty} whenever the time step paints
 * (including day taps that stay inside TimeScreen).
 */
export function StampSlotsEmptyTestId({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stamp = () => {
      for (const el of root.querySelectorAll(`.${BOOKING_SLOTS_EMPTY_MARKER}`)) {
        if (el.getAttribute('data-testid') !== BOOKING_TEST_IDS.slotsEmpty) {
          el.setAttribute('data-testid', BOOKING_TEST_IDS.slotsEmpty);
        }
      }
    };
    stamp();
    const observer = new MutationObserver(stamp);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={rootRef} className="contents">
      {children}
    </div>
  );
}
