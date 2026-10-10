/**
 * Meda card wrappers that stamp the wizard's stable `data-testid`s onto the
 * interactive root. Wrappers are cached per inner component so their identity
 * is stable across renders — recreating them each paint remounted the chips
 * mid-click and blocked slot picks.
 *
 * Stylist cards take a `ref` on the radio button, so the id lands there
 * directly (a wrapping span sits between radiogroup and radio in jsdom, which
 * does not flatten `display: contents`). Service / day / slot cards stamp the
 * first child after mount the same way.
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
import { type ComponentType, type ReactNode, type Ref, useLayoutEffect, useRef } from 'react';
import { BOOKING_SLOTS_EMPTY_MARKER, BOOKING_TEST_IDS } from './test-ids';

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function stampAttrs(node: Element | null, attrs: Record<string, string>): void {
  if (!(node instanceof HTMLElement)) return;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
}

const SERVICE_WRAPS = new WeakMap<
  ComponentType<ServiceCardProps>,
  ComponentType<ServiceCardProps>
>();
const STYLIST_WRAPS = new WeakMap<
  ComponentType<StylistCardProps>,
  ComponentType<StylistCardProps>
>();
const DAY_WRAPS = new WeakMap<ComponentType<DayChipProps>, ComponentType<DayChipProps>>();
const SLOT_WRAPS = new WeakMap<ComponentType<TimeChipProps>, ComponentType<TimeChipProps>>();

function wrapService(Inner: ComponentType<ServiceCardProps>): ComponentType<ServiceCardProps> {
  function ServiceOption(props: ServiceCardProps) {
    const hostRef = useRef<HTMLSpanElement>(null);
    const attrs = {
      'data-testid': BOOKING_TEST_IDS.serviceOption,
      'data-service-id': props.service.id,
    };
    useLayoutEffect(() => {
      stampAttrs(hostRef.current?.firstElementChild ?? null, attrs);
    });
    return (
      <span ref={hostRef} className="contents">
        <Inner {...props} />
      </span>
    );
  }
  ServiceOption.displayName = 'BookingServiceOption';
  return ServiceOption;
}

function wrapStylist(Inner: ComponentType<StylistCardProps>): ComponentType<StylistCardProps> {
  function StylistOption(props: StylistCardProps) {
    const attrs = {
      'data-testid': BOOKING_TEST_IDS.stylistOption,
      'data-resource-id': props.option.resourceId ?? 'first',
    };
    return (
      <Inner
        {...props}
        ref={(node) => {
          stampAttrs(node, attrs);
          assignRef(props.ref, node);
        }}
      />
    );
  }
  StylistOption.displayName = 'BookingStylistOption';
  return StylistOption;
}

function wrapDay(Inner: ComponentType<DayChipProps>): ComponentType<DayChipProps> {
  function Day(props: DayChipProps) {
    const hostRef = useRef<HTMLSpanElement>(null);
    const attrs = {
      'data-testid': BOOKING_TEST_IDS.day,
      'data-day-ts': String(props.dayTs),
    };
    useLayoutEffect(() => {
      stampAttrs(hostRef.current?.firstElementChild ?? null, attrs);
    });
    return (
      <span ref={hostRef} className="contents">
        <Inner {...props} />
      </span>
    );
  }
  Day.displayName = 'BookingDay';
  return Day;
}

function wrapSlot(Inner: ComponentType<TimeChipProps>): ComponentType<TimeChipProps> {
  function Slot(props: TimeChipProps) {
    const hostRef = useRef<HTMLSpanElement>(null);
    const attrs = {
      'data-testid': BOOKING_TEST_IDS.slot,
      'data-start-ts': String(props.startTs),
    };
    useLayoutEffect(() => {
      stampAttrs(hostRef.current?.firstElementChild ?? null, attrs);
    });
    return (
      <span ref={hostRef} className="contents">
        <Inner {...props} />
      </span>
    );
  }
  Slot.displayName = 'BookingSlot';
  return Slot;
}

function cached<P>(
  map: WeakMap<ComponentType<P>, ComponentType<P>>,
  Inner: ComponentType<P>,
  wrap: (inner: ComponentType<P>) => ComponentType<P>
): ComponentType<P> {
  const known = map.get(Inner);
  if (known) return known;
  const built = wrap(Inner);
  map.set(Inner, built);
  return built;
}

/** Wrap a site override (or the meda default) so the test id always lands. */
export function withServiceOptionTestId(
  Inner?: ComponentType<ServiceCardProps>
): ComponentType<ServiceCardProps> {
  return cached(SERVICE_WRAPS, Inner ?? DefaultServiceCard, wrapService);
}

export function withStylistOptionTestId(
  Inner?: ComponentType<StylistCardProps>
): ComponentType<StylistCardProps> {
  return cached(STYLIST_WRAPS, Inner ?? DefaultStylistCard, wrapStylist);
}

export function withDayTestId(Inner?: ComponentType<DayChipProps>): ComponentType<DayChipProps> {
  return cached(DAY_WRAPS, Inner ?? DefaultDayChip, wrapDay);
}

export function withSlotTestId(Inner?: ComponentType<TimeChipProps>): ComponentType<TimeChipProps> {
  return cached(SLOT_WRAPS, Inner ?? DefaultTimeChip, wrapSlot);
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
