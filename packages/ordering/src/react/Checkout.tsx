/**
 * Checkout: one form, in the order a guest thinks it through — how they get
 * the food (shown only when there is a choice), when (as soon as possible, or
 * a slot) or where (a delivery's address and door), their details, allergies
 * and cutlery, and how they pay — then the order button with the total.
 *
 * Controlled through props: the page passes the location (from the locations
 * route), the resolved cart and `onPlace`, which sends the order (with
 * `placeOrder` and the draft's idempotency key) and resolves the route's
 * answer. On success `onPlaced` gets the created order — the page sends the
 * guest to `payment.redirect_url` for Vipps, or to the receipt. A refusal is
 * shown in the guest's words above the button; `onRefused` lets the page
 * react too (refetch the menu after `SOLD_OUT`, say).
 *
 * The details are checked as the Medal API checks them before anything is
 * sent; the first field at fault gets the focus. While an order is on its way
 * the button does nothing more, so a double press cannot send it twice.
 *
 * Delivery is offered when the location has it on and takes Vipps, and the
 * page passes `suggestAddress`, `resolveAddress` and `quoteDelivery` (the
 * site's delivery routes). It is as soon as possible and Vipps only. Once the
 * address is verified the price is asked for with the cart's subtotal, and
 * the fee, when it arrives and the total include it; the order button waits
 * for a price. A new price is asked for when the subtotal changes and before
 * the old one runs out (`quoteNeedsRefresh`; a price with no stated expiry
 * only when the subtotal changes). A new or cleared address drops the price,
 * a request for it still on its way, and its error. When the API refuses the
 * price all the same (`QUOTE_EXPIRED`, `QUOTE_NOT_USABLE`), a new one is
 * asked for and shown, and the guest presses again to accept it — never a
 * silent order at a price they did not see.
 */
import type {
  DeliveryQuote,
  DeliveryResolvedAddress,
  OrderingChannel,
  OrderingLocation,
  OrderingOrderCreated,
  OrderingPaymentMethod,
  OrderingSlot,
} from '@medalsocial/sdk';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { type ResolvedCart, toOrderLine } from '../core/cart';
import {
  CUSTOMER_LIMITS,
  type CustomerField,
  checkCustomer,
  type OrderingRouteError,
  type PlaceOrderRequest,
} from '../core/checkout';
import type { RouteResult } from '../core/client';
import {
  checkDelivery,
  DELIVERY_LIMITS,
  type DeliveryField,
  deliveryFeeOre,
  quoteNeedsRefresh,
  quoteRefreshDelay,
} from '../core/delivery';
import { refusalMessage } from '../core/errors';
import { addIsoDays, localIsoDate } from '../core/hours';
import { deliveryWindowLabel, labelLocale } from '../core/labels';
import { createMoney, type Money } from '../core/money';
import { openingLine, wallClock } from '../core/opening';
import { fill, mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { AddressCombobox, type AddressComboboxProps } from './AddressCombobox';
import { ClosedNotice } from './ClosedNotice';
import { cx } from './cx';

/** The channels this checkout offers, in the order it lists them. */
const OFFERED: readonly OrderingChannel[] = ['takeaway', 'dine_in', 'delivery'];

/** A refused price: ask for a new one and let the guest accept it. */
const REPRICE: ReadonlySet<string> = new Set(['QUOTE_EXPIRED', 'QUOTE_NOT_USABLE']);

/** A failed price that asking again may fix. */
const RETRY: ReadonlySet<string> = new Set(['QUOTE_TIMEOUT', 'SERVICE_UNAVAILABLE']);

const UNAVAILABLE: OrderingRouteError = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'The delivery price could not be fetched.',
};

export interface CheckoutDetails {
  name?: string;
  phone?: string;
  email?: string;
  allergyNote?: string;
  cutlery?: boolean;
  floor?: string;
  doorCode?: string;
  deliveryComment?: string;
  /** Leave a delivery at the door (`no_contact`). */
  contactless?: boolean;
}

export interface CheckoutProps {
  /** The ordering location, as the locations route answers it. */
  location: OrderingLocation;
  /** The restaurant's IANA time zone (`time_zone` of the locations answer). */
  timeZone: string;
  cart: ResolvedCart;
  /** The channel the page starts on (a `?c=` link, the block's setting). */
  channel?: OrderingChannel;
  /** A dine-in table from the table's QR code. Without one, dine-in is not offered. */
  table?: { token: string; label?: string };
  /** The free slots of a day, for a scheduled order. */
  loadSlots?: (query: { channel: OrderingChannel; date: string }) => Promise<OrderingSlot[]>;
  /**
   * Offer a chosen time (with `loadSlots`). Off by default: the Medal API
   * refuses scheduled orders (`PREORDER_DISABLED`) until the restaurant
   * takes orders ahead, so a guest is never led through the form to a
   * refusal. With it off a closed channel shows the closed notice.
   */
  allowScheduled?: boolean;
  /**
   * Delivery's address lookup and price (`fetchAddressSuggestions`,
   * `resolveAddress` and `requestDeliveryQuote` from `/core`, on the site's
   * routes). Delivery is offered only when all three are passed.
   */
  suggestAddress?: AddressComboboxProps['suggest'];
  resolveAddress?: AddressComboboxProps['resolve'];
  /** `order_total` is the cart's subtotal in øre. */
  quoteDelivery?: (input: {
    address_id: string;
    order_total: number;
  }) => Promise<RouteResult<DeliveryQuote>>;
  onPlace: (request: PlaceOrderRequest) => Promise<RouteResult<OrderingOrderCreated>>;
  /** May be async: a rejected promise is handled like a throw. */
  onPlaced: (order: OrderingOrderCreated) => void | Promise<void>;
  onRefused?: (error: OrderingRouteError) => void;
  /** What the form starts with (a returning guest's details). */
  initial?: CheckoutDetails;
  /** BCP 47. Default `nb`. */
  locale?: string;
  /** Default `createMoney({ locale })`. */
  money?: Money;
  labels?: Partial<OrderingLabels>;
  /** The clock, for tests. Default the browser's. */
  now?: Date;
  className?: string;
}

type FieldErrors = Partial<Record<CustomerField | DeliveryField | 'slot', string>>;

/** The fields in the order they are on screen: the first at fault gets the focus. */
const FIELD_ORDER = [
  'slot',
  'floor',
  'door_code',
  'delivery_comment',
  'name',
  'phone',
  'email',
  'allergy_note',
] as const;

/** A price and what it was asked for. */
interface HeldQuote {
  quote: DeliveryQuote;
  addressId: string;
  subtotalOre: number;
  /**
   * Already due by this device's clock when it arrived (a clock running
   * ahead of Medal's, or a short validity). Such a price is sent as it is
   * and Medal decides: asking again would bring another one due on arrival,
   * and the guest could never order.
   */
  dueOnArrival: boolean;
}

function channelLabel(channel: OrderingChannel, labels: OrderingLabels): string {
  if (channel === 'delivery') return labels.channelDelivery;
  return channel === 'dine_in' ? labels.channelDineIn : labels.channelTakeaway;
}

/** «I dag», «I morgen», then «fredag 31. oktober». */
function dayLabel(date: string, today: string, locale: string, labels: OrderingLabels) {
  if (date === today) return labels.today;
  if (date === addIsoDays(today, 1)) return labels.tomorrow;
  return new Intl.DateTimeFormat(labelLocale(locale) === 'nb' ? 'nb-NO' : 'en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function Checkout({
  location,
  timeZone,
  cart,
  channel: startChannel,
  table,
  loadSlots,
  allowScheduled = false,
  suggestAddress,
  resolveAddress,
  quoteDelivery,
  onPlace,
  onPlaced,
  onRefused,
  initial,
  locale = 'nb',
  money: moneyProp,
  labels: overrides,
  now,
  className,
}: CheckoutProps) {
  const labels = mergeLabels(locale, overrides);
  const defaultMoney = useMemo(() => createMoney({ locale }), [locale]);
  const money = moneyProp ?? defaultMoney;
  const id = useId();
  const clock = now ?? new Date();

  const deliveryOffered =
    suggestAddress !== undefined &&
    resolveAddress !== undefined &&
    quoteDelivery !== undefined &&
    location.payment_methods.vipps;
  const channels = OFFERED.filter(
    (c) =>
      location.channels[c].enabled &&
      (c !== 'dine_in' || table !== undefined) &&
      (c !== 'delivery' || deliveryOffered)
  );
  const [chosenChannel, setChannel] = useState<OrderingChannel | undefined>(startChannel);
  const channel = channels.find((c) => c === chosenChannel) ?? channels[0];
  const isDelivery = channel === 'delivery';
  const state = channel === undefined ? undefined : location.channels[channel];
  const canAsap = state?.open === true;
  // Delivery is as soon as possible: a price is for a courier booked now.
  const canSchedule = allowScheduled && loadSlots !== undefined && channel === 'takeaway';

  const [timingKind, setTimingKind] = useState<'asap' | 'scheduled'>('asap');
  const timing = canAsap ? (canSchedule ? timingKind : 'asap') : canSchedule ? 'scheduled' : null;

  const today = localIsoDate(clock.getTime(), timeZone);
  const days = Array.from({ length: location.preorder_days + 1 }, (_, i) => addIsoDays(today, i));
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<OrderingSlot[] | null>(null);
  const [slot, setSlot] = useState('');

  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [allergyNote, setAllergyNote] = useState(initial?.allergyNote ?? '');
  const [cutlery, setCutlery] = useState(initial?.cutlery ?? true);
  const [floor, setFloor] = useState(initial?.floor ?? '');
  const [doorCode, setDoorCode] = useState(initial?.doorCode ?? '');
  const [deliveryComment, setDeliveryComment] = useState(initial?.deliveryComment ?? '');
  const [contactless, setContactless] = useState(initial?.contactless ?? false);

  const [address, setAddress] = useState<DeliveryResolvedAddress | null>(null);
  const [quote, setQuote] = useState<HeldQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<OrderingRouteError | null>(null);
  // Bumped to ask for a price again: on a timer, a retry, or a refused price.
  const [quoteTick, setQuoteTick] = useState(0);
  // A refused price is being replaced: show the new one for the guest to accept.
  const [repricing, setRepricing] = useState(false);
  const held = useRef<HeldQuote | null>(null);
  const quoteTurn = useRef(0);
  // The latest prop, so a page passing a new function each render does not ask again.
  const quoteFn = useRef(quoteDelivery);
  useEffect(() => {
    quoteFn.current = quoteDelivery;
  });

  const methods: OrderingPaymentMethod[] = isDelivery
    ? ['vipps']
    : (['vipps', 'pay_at_counter'] as const).filter((m) => location.payment_methods[m]);
  const [chosenMethod, setMethod] = useState<OrderingPaymentMethod | undefined>(undefined);
  const method =
    chosenMethod !== undefined && methods.includes(chosenMethod) ? chosenMethod : methods[0];

  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  // A refused field to focus once the form is unlocked: a disabled one cannot take focus.
  const focusAfterPlacing = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (placing || focusAfterPlacing.current === null) return;
    focusAfterPlacing.current.focus();
    focusAfterPlacing.current = null;
  }, [placing]);
  const fields = useRef<Partial<Record<keyof FieldErrors, HTMLElement | null>>>({});
  const failureRef = useRef<HTMLParagraphElement>(null);

  // The latest loader: a page passing a new function each render must not
  // reload the slots and clear the guest's chosen time.
  const slotLoader = useRef(loadSlots);
  useEffect(() => {
    slotLoader.current = loadSlots;
  });
  const canLoadSlots = loadSlots !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `canLoadSlots` is the "a loader arrived" signal.
  useEffect(() => {
    const load = slotLoader.current;
    if (timing !== 'scheduled' || load === undefined || channel === undefined) return;
    let current = true;
    setSlots(null);
    setSlot('');
    load({ channel, date }).then(
      (found) => {
        if (current) setSlots(found);
      },
      () => {
        if (current) setSlots([]);
      }
    );
    return () => {
      current = false;
    };
  }, [timing, canLoadSlots, channel, date]);

  const opens =
    state === undefined ? null : openingLine(state.opens_at, clock, timeZone, locale, labels);
  const closed = channel === undefined || timing === null;
  const empty = cart.lines.length === 0;
  const subtotal = cart.totalOre;
  const addressId = address?.address_id;

  function keepQuote(next: HeldQuote | null) {
    held.current = next;
    setQuote(next);
  }

  /** A new or cleared address: the price, its request and its error were for the old one. */
  function changeAddress(next: DeliveryResolvedAddress | null) {
    setAddress(next);
    quoteTurn.current += 1;
    keepQuote(null);
    setQuoting(false);
    setQuoteError(null);
  }

  // Ask for a price for the address and the subtotal, unless the one held still holds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `quoteTick` is the ask-again signal.
  useEffect(() => {
    const ask = quoteFn.current;
    if (!isDelivery || addressId === undefined || empty || ask === undefined) return;
    const current = held.current;
    if (
      current?.addressId === addressId &&
      !quoteNeedsRefresh(current.quote, {
        subtotalOre: subtotal,
        quotedSubtotalOre: current.subtotalOre,
      })
    ) {
      // It fits again (the cart went back): a request for another subtotal no longer counts.
      quoteTurn.current += 1;
      setQuoting(false);
      return;
    }
    quoteTurn.current += 1;
    const mine = quoteTurn.current;
    const settle = (result: RouteResult<DeliveryQuote>) => {
      if (mine !== quoteTurn.current) return;
      setQuoting(false);
      if (result.ok) {
        keepQuote({
          quote: result.data,
          addressId,
          subtotalOre: subtotal,
          dueOnArrival: quoteRefreshDelay(result.data) === 0,
        });
      } else {
        keepQuote(null);
        setQuoteError(result.error);
      }
    };
    setQuoting(true);
    setQuoteError(null);
    ask({ address_id: addressId, order_total: subtotal }).then(settle, () =>
      settle({ ok: false, error: UNAVAILABLE })
    );
  }, [isDelivery, addressId, subtotal, empty, quoteTick]);

  // Ask again before the price runs out; a late answer after unmounting is dropped.
  useEffect(() => {
    const delay = quote === null ? null : quoteRefreshDelay(quote.quote);
    // A quote already due on arrival (a fast clock, a short validity) gets no
    // 0 ms timer: that would loop, a Wolt call each turn, and spend the route's
    // quote budget. It is sent as it is when the guest presses order.
    // Not while a new price is on its way: the old one's timer would ask a second time.
    if (!isDelivery || quoting || delay === null || delay === 0) return;
    const timer = setTimeout(() => setQuoteTick((t) => t + 1), delay);
    return () => clearTimeout(timer);
  }, [isDelivery, quote, quoting]);
  useEffect(
    () => () => {
      quoteTurn.current += 1;
    },
    []
  );

  /** Drop the held price and ask for a new one for the guest to accept. */
  function reprice() {
    keepQuote(null);
    setRepricing(true);
    setQuoteTick((t) => t + 1);
  }

  // A price counts only for this address and this subtotal, and not while a new one is coming.
  const usable =
    isDelivery &&
    !quoting &&
    quote !== null &&
    quote.addressId === addressId &&
    quote.subtotalOre === subtotal
      ? quote
      : null;
  const fee = usable === null ? 0 : deliveryFeeOre(usable.quote);
  const feeWords = fee === 0 ? labels.freeDelivery : money.formatOre(fee);
  const deliveredBy = usable?.quote.delivered_by;
  const price = money.formatOre(subtotal + fee);
  const notice =
    repricing && usable !== null ? fill(labels.deliveryNewPrice, { price: feeWords }) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (placing || closed || empty || channel === undefined || method === undefined) return;
    const customer = {
      name: name.trim(),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    const next: FieldErrors = {};
    if (timing === 'scheduled' && slot === '') next.slot = labels.chooseSlot;
    const door = {
      floor: floor.trim(),
      door_code: doorCode.trim(),
      comment: deliveryComment.trim(),
    };
    const doorField = isDelivery ? checkDelivery(door) : null;
    if (doorField !== null) {
      next[doorField] = refusalMessage(
        { code: 'INVALID_CUSTOMER', details: { reason: doorField } },
        labels
      );
    }
    const field = checkCustomer(customer, allergyNote);
    if (field !== null)
      next[field] = refusalMessage(
        { code: 'INVALID_CUSTOMER', details: { reason: field } },
        labels
      );
    setErrors(next);
    setFailure(null);
    setRepricing(false);
    const first = FIELD_ORDER.find((k) => next[k]);
    if (first !== undefined) {
      fields.current[first]?.focus();
      return;
    }
    // A price that ran out while the tab slept (timers wait then) is asked for again first.
    // One that was due when it arrived goes as it is: Medal's own clock decides
    // (`QUOTE_EXPIRED` asks again), or a fast device clock would block every order.
    if (
      usable !== null &&
      !usable.dueOnArrival &&
      quoteNeedsRefresh(usable.quote, { subtotalOre: subtotal, quotedSubtotalOre: subtotal })
    ) {
      reprice();
      return;
    }

    const note = allergyNote.trim();
    const base = {
      ...(timing === 'scheduled' ? { timing: { kind: 'scheduled' as const, at: slot } } : {}),
      ...(channel === 'dine_in' && table ? { table_token: table.token } : {}),
      lines: cart.lines.map(toOrderLine),
      customer,
      preferences: {
        cutlery: channel === 'dine_in' ? false : cutlery,
        ...(note ? { allergy_note: note } : {}),
        ...(isDelivery ? { no_contact: contactless } : {}),
      },
    };
    // A delivery without a price is never sent (the button waits for one; Enter does not).
    const request: PlaceOrderRequest | null =
      channel !== 'delivery'
        ? { ...base, channel, payment_method: method }
        : usable && {
            ...base,
            channel,
            payment_method: 'vipps',
            delivery: {
              verified_address_id: usable.addressId,
              quote_id: usable.quote.quote_id,
              ...(door.floor ? { floor: door.floor } : {}),
              ...(door.door_code ? { door_code: door.door_code } : {}),
              ...(door.comment ? { comment: door.comment } : {}),
            },
          };
    if (request === null) return;
    setPlacing(true);
    let result: RouteResult<OrderingOrderCreated>;
    try {
      result = await onPlace(request);
    } catch {
      result = { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'onPlace threw' } };
    }
    if (result.ok) {
      // The order is placed: if the page cannot move on, the form stays locked
      // (no second order) and the guest is told it was received rather than
      // left on a busy button. A throw and a rejected promise alike.
      const received = () =>
        setFailure(fill(labels.placedNoRedirect, { number: result.data.order_number }));
      try {
        const moving: unknown = onPlaced(result.data);
        if (moving instanceof Promise) moving.catch(received);
      } catch {
        received();
      }
      // The page navigates away; the button stays busy until it does.
      return;
    }
    setPlacing(false);
    const { error } = result;
    onRefused?.(error);
    if (isDelivery && REPRICE.has(error.code)) {
      reprice();
      return;
    }
    const reason = error.details?.reason as keyof FieldErrors | undefined;
    const target = reason === undefined ? undefined : fields.current[reason];
    if (error.code === 'INVALID_CUSTOMER' && reason && target) {
      setErrors({ [reason]: refusalMessage(error, labels) });
      focusAfterPlacing.current = target;
      return;
    }
    setFailure(refusalMessage(error, labels, { opens }));
  }

  // Focus the message once it is on screen: before the render it is empty
  // and hidden, and focusing a hidden element does nothing.
  const message = failure ?? notice;
  useEffect(() => {
    if (message !== null) failureRef.current?.focus();
  }, [message]);

  function described(field: keyof FieldErrors, hint?: string): string | undefined {
    const ids = [hint, errors[field] ? `${id}-${field}-error` : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  function errorText(field: keyof FieldErrors) {
    return errors[field] ? (
      <p id={`${id}-${field}-error`} className="text-sm font-medium text-destructive">
        {errors[field]}
      </p>
    ) : null;
  }

  const input =
    'min-h-11 rounded-lg border border-input bg-background px-3 aria-invalid:border-destructive';
  const choice = 'flex min-h-11 items-center gap-3';

  return (
    <form noValidate onSubmit={submit} className={cx('flex flex-col gap-6', className)}>
      {/* Locked while the order is on its way: what was sent is what the guest sees. */}
      <fieldset disabled={placing} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        {channels.length > 1 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">{labels.channelLegend}</legend>
            {channels.map((c) => (
              <label key={c} className={choice}>
                <input
                  type="radio"
                  name={`${id}-channel`}
                  checked={c === channel}
                  onChange={() => setChannel(c)}
                  className="size-5 accent-primary"
                />
                <span>
                  {channelLabel(c, labels)}
                  {c === 'dine_in' && table?.label
                    ? ` · ${fill(labels.atTable, { table: table.label })}`
                    : ''}
                </span>
              </label>
            ))}
          </fieldset>
        ) : channel === 'dine_in' && table?.label ? (
          <p className="font-medium">{fill(labels.atTable, { table: table.label })}</p>
        ) : null}

        {closed ? (
          <ClosedNotice
            nextOpenAt={state?.opens_at}
            timeZone={timeZone}
            locale={locale}
            labels={overrides}
            now={now}
          />
        ) : (
          <>
            {canAsap && canSchedule ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 font-medium">{labels.timingLegend}</legend>
                <label className={choice}>
                  <input
                    type="radio"
                    name={`${id}-timing`}
                    checked={timing === 'asap'}
                    onChange={() => setTimingKind('asap')}
                    className="size-5 accent-primary"
                  />
                  <span>{labels.asap}</span>
                </label>
                <label className={choice}>
                  <input
                    type="radio"
                    name={`${id}-timing`}
                    checked={timing === 'scheduled'}
                    onChange={() => setTimingKind('scheduled')}
                    className="size-5 accent-primary"
                  />
                  <span>{labels.scheduled}</span>
                </label>
              </fieldset>
            ) : null}
            {timing === 'scheduled' ? (
              <div className="flex flex-wrap gap-3">
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <label htmlFor={`${id}-day`} className="font-medium">
                    {labels.slotDay}
                  </label>
                  <select
                    id={`${id}-day`}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className={input}
                  >
                    {days.map((day) => (
                      <option key={day} value={day}>
                        {dayLabel(day, today, locale, labels)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <label htmlFor={`${id}-slot`} className="font-medium">
                    {labels.slotTime}
                  </label>
                  <select
                    id={`${id}-slot`}
                    ref={(node) => {
                      fields.current.slot = node;
                    }}
                    value={slot}
                    disabled={slots === null || slots.length === 0}
                    aria-invalid={errors.slot ? 'true' : undefined}
                    aria-describedby={described('slot', `${id}-slot-hint`)}
                    onChange={(event) => setSlot(event.target.value)}
                    className={input}
                  >
                    <option value="">{labels.chooseSlot}</option>
                    {(slots ?? []).map((s) => (
                      <option key={s.start} value={s.start}>
                        {wallClock(new Date(s.start), timeZone).time}
                      </option>
                    ))}
                  </select>
                  <p
                    id={`${id}-slot-hint`}
                    aria-live="polite"
                    className="text-sm text-muted-foreground"
                  >
                    {slots === null
                      ? labels.slotsLoading
                      : slots.length === 0
                        ? labels.noSlots
                        : ''}
                  </p>
                  {errorText('slot')}
                </div>
              </div>
            ) : null}

            {isDelivery && suggestAddress && resolveAddress ? (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 font-medium">{labels.addressLegend}</legend>
                <AddressCombobox
                  suggest={suggestAddress}
                  resolve={resolveAddress}
                  onResolved={changeAddress}
                  initialValue={address?.label}
                  locale={locale}
                  labels={overrides}
                />
                <div aria-live="polite" className="flex flex-col gap-1">
                  {usable !== null ? (
                    <>
                      <p className="font-medium">
                        {fee === 0
                          ? labels.freeDelivery
                          : fill(labels.deliveryFee, { price: feeWords })}
                      </p>
                      {deliveredBy ? (
                        <p className="text-sm text-muted-foreground">
                          {deliveryWindowLabel(
                            { min: deliveredBy, max: deliveredBy },
                            locale,
                            timeZone
                          )}
                        </p>
                      ) : null}
                    </>
                  ) : quoteError !== null && !quoting ? (
                    <p className="text-sm font-medium text-destructive">
                      {refusalMessage(quoteError, labels)}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {addressId === undefined
                        ? labels.deliveryChooseAddress
                        : labels.deliveryQuoting}
                    </p>
                  )}
                </div>
                {quoteError !== null &&
                !quoting &&
                addressId !== undefined &&
                RETRY.has(quoteError.code) ? (
                  <button
                    type="button"
                    onClick={() => setQuoteTick((t) => t + 1)}
                    className="min-h-11 self-start rounded-full border border-border px-4 font-medium"
                  >
                    {labels.deliveryRetry}
                  </button>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <div className="flex min-w-32 flex-1 flex-col gap-1">
                    <label htmlFor={`${id}-floor`}>{labels.floor}</label>
                    <input
                      id={`${id}-floor`}
                      ref={(node) => {
                        fields.current.floor = node;
                      }}
                      value={floor}
                      maxLength={DELIVERY_LIMITS.maxFloor}
                      aria-invalid={errors.floor ? 'true' : undefined}
                      aria-describedby={described('floor')}
                      onChange={(event) => setFloor(event.target.value)}
                      className={input}
                    />
                    {errorText('floor')}
                  </div>
                  <div className="flex min-w-32 flex-1 flex-col gap-1">
                    <label htmlFor={`${id}-door_code`}>{labels.doorCode}</label>
                    <input
                      id={`${id}-door_code`}
                      ref={(node) => {
                        fields.current.door_code = node;
                      }}
                      value={doorCode}
                      autoComplete="off"
                      maxLength={DELIVERY_LIMITS.maxDoorCode}
                      aria-invalid={errors.door_code ? 'true' : undefined}
                      aria-describedby={described('door_code')}
                      onChange={(event) => setDoorCode(event.target.value)}
                      className={input}
                    />
                    {errorText('door_code')}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-delivery_comment`}>{labels.deliveryComment}</label>
                  <textarea
                    id={`${id}-delivery_comment`}
                    ref={(node) => {
                      fields.current.delivery_comment = node;
                    }}
                    value={deliveryComment}
                    rows={2}
                    maxLength={DELIVERY_LIMITS.maxComment}
                    aria-invalid={errors.delivery_comment ? 'true' : undefined}
                    aria-describedby={described('delivery_comment')}
                    onChange={(event) => setDeliveryComment(event.target.value)}
                    className="rounded-lg border border-input bg-background p-2 aria-invalid:border-destructive"
                  />
                  {errorText('delivery_comment')}
                </div>
                <label className={choice}>
                  <input
                    type="checkbox"
                    checked={contactless}
                    onChange={(event) => setContactless(event.target.checked)}
                    className="size-5 accent-primary"
                  />
                  <span>{labels.contactless}</span>
                </label>
              </fieldset>
            ) : null}

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-medium">{labels.detailsLegend}</legend>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-name`}>{labels.name}</label>
                <input
                  id={`${id}-name`}
                  ref={(node) => {
                    fields.current.name = node;
                  }}
                  value={name}
                  autoComplete="name"
                  required
                  maxLength={CUSTOMER_LIMITS.maxName}
                  aria-invalid={errors.name ? 'true' : undefined}
                  aria-describedby={described('name')}
                  onChange={(event) => setName(event.target.value)}
                  className={input}
                />
                {errorText('name')}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-phone`}>{labels.phone}</label>
                <input
                  id={`${id}-phone`}
                  ref={(node) => {
                    fields.current.phone = node;
                  }}
                  type="tel"
                  value={phone}
                  autoComplete="tel"
                  inputMode="tel"
                  required
                  aria-invalid={errors.phone ? 'true' : undefined}
                  aria-describedby={described('phone')}
                  onChange={(event) => setPhone(event.target.value)}
                  className={input}
                />
                {errorText('phone')}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-email`}>{labels.email}</label>
                <input
                  id={`${id}-email`}
                  ref={(node) => {
                    fields.current.email = node;
                  }}
                  type="email"
                  value={email}
                  autoComplete="email"
                  maxLength={CUSTOMER_LIMITS.maxEmail}
                  aria-invalid={errors.email ? 'true' : undefined}
                  aria-describedby={described('email', `${id}-email-hint`)}
                  onChange={(event) => setEmail(event.target.value)}
                  className={input}
                />
                <p id={`${id}-email-hint`} className="text-sm text-muted-foreground">
                  {labels.emailHint}
                </p>
                {errorText('email')}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-medium">{labels.preferencesLegend}</legend>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-allergy_note`}>{labels.allergyNote}</label>
                <textarea
                  id={`${id}-allergy_note`}
                  ref={(node) => {
                    fields.current.allergy_note = node;
                  }}
                  value={allergyNote}
                  rows={2}
                  maxLength={CUSTOMER_LIMITS.maxAllergyNote}
                  aria-invalid={errors.allergy_note ? 'true' : undefined}
                  aria-describedby={described('allergy_note', `${id}-allergy-warning`)}
                  onChange={(event) => setAllergyNote(event.target.value)}
                  className="rounded-lg border border-input bg-background p-2 aria-invalid:border-destructive"
                />
                <p id={`${id}-allergy-warning`} className="text-sm font-medium">
                  {labels.allergyWarning}
                </p>
                {errorText('allergy_note')}
              </div>
              {channel === 'dine_in' ? null : (
                <label className={choice}>
                  <input
                    type="checkbox"
                    checked={cutlery}
                    onChange={(event) => setCutlery(event.target.checked)}
                    className="size-5 accent-primary"
                  />
                  <span>{labels.cutlery}</span>
                </label>
              )}
            </fieldset>

            {methods.length > 1 ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 font-medium">{labels.paymentLegend}</legend>
                {methods.map((m) => (
                  <label key={m} className={choice}>
                    <input
                      type="radio"
                      name={`${id}-payment`}
                      checked={m === method}
                      onChange={() => setMethod(m)}
                      className="size-5 accent-primary"
                    />
                    <span>{m === 'vipps' ? labels.payVipps : labels.payAtCounter}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <p
          ref={failureRef}
          tabIndex={-1}
          role="alert"
          className="font-medium text-destructive outline-none empty:hidden"
        >
          {message ?? ''}
        </p>
        <button
          type="submit"
          disabled={closed || empty || method === undefined || (isDelivery && usable === null)}
          aria-disabled={placing ? 'true' : undefined}
          aria-busy={placing ? 'true' : undefined}
          className="min-h-12 w-full rounded-full bg-primary px-4 font-semibold text-primary-foreground aria-disabled:opacity-60 disabled:opacity-40"
        >
          {placing
            ? labels.placing
            : isDelivery && quoting
              ? labels.deliveryQuoting
              : fill(method === 'vipps' ? labels.payWithVipps : labels.placeOrder, { price })}
        </button>
      </div>
    </form>
  );
}
