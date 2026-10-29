/**
 * Checkout: one form, in the order a guest thinks it through — how they get
 * the food (shown only when there is a choice), when (as soon as possible, or
 * a slot), their details, allergies and cutlery, and how they pay — then the
 * order button with the total.
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
 * Delivery is not offered here yet: it needs an address and a quote (plan 8c).
 */
import type {
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
import { refusalMessage } from '../core/errors';
import { addIsoDays, localIsoDate } from '../core/hours';
import { labelLocale } from '../core/labels';
import { createMoney, type Money } from '../core/money';
import { openingLine, wallClock } from '../core/opening';
import { fill, mergeLabels, type OrderingLabels } from '../core/ui-labels';
import { ClosedNotice } from './ClosedNotice';
import { cx } from './cx';

/** The channels this checkout offers, in the order it lists them. */
const OFFERED: readonly OrderingChannel[] = ['takeaway', 'dine_in'];

export interface CheckoutDetails {
  name?: string;
  phone?: string;
  email?: string;
  allergyNote?: string;
  cutlery?: boolean;
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
  /** The free slots of a day. Left out: only «as soon as possible». */
  loadSlots?: (query: { channel: OrderingChannel; date: string }) => Promise<OrderingSlot[]>;
  onPlace: (request: PlaceOrderRequest) => Promise<RouteResult<OrderingOrderCreated>>;
  onPlaced: (order: OrderingOrderCreated) => void;
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

type FieldErrors = Partial<Record<CustomerField | 'slot', string>>;

function channelLabel(channel: OrderingChannel, labels: OrderingLabels): string {
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

  const channels = OFFERED.filter(
    (c) => location.channels[c].enabled && (c !== 'dine_in' || table !== undefined)
  );
  const [chosenChannel, setChannel] = useState<OrderingChannel | undefined>(startChannel);
  const channel =
    chosenChannel !== undefined && channels.includes(chosenChannel) ? chosenChannel : channels[0];
  const state = channel === undefined ? undefined : location.channels[channel];
  const canAsap = state?.open === true;
  const canSchedule = loadSlots !== undefined && channel !== 'dine_in';

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

  const methods = (['vipps', 'pay_at_counter'] as const).filter((m) => location.payment_methods[m]);
  const [chosenMethod, setMethod] = useState<OrderingPaymentMethod | undefined>(undefined);
  const method =
    chosenMethod !== undefined && methods.includes(chosenMethod) ? chosenMethod : methods[0];

  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const fields = useRef<Partial<Record<keyof FieldErrors, HTMLElement | null>>>({});
  const failureRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (timing !== 'scheduled' || loadSlots === undefined || channel === undefined) return;
    let current = true;
    setSlots(null);
    setSlot('');
    loadSlots({ channel, date }).then(
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
  }, [timing, loadSlots, channel, date]);

  const opens =
    state === undefined ? null : openingLine(state.opens_at, clock, timeZone, locale, labels);
  const closed = channel === undefined || timing === null;
  const empty = cart.lines.length === 0;
  const price = money.formatOre(cart.totalOre);

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
    const field = checkCustomer(customer, allergyNote);
    if (field !== null)
      next[field] = refusalMessage(
        { code: 'INVALID_CUSTOMER', details: { reason: field } },
        labels
      );
    setErrors(next);
    setFailure(null);
    const first = (['slot', 'name', 'phone', 'email', 'allergy_note'] as const).find(
      (k) => next[k]
    );
    if (first !== undefined) {
      fields.current[first]?.focus();
      return;
    }

    const note = allergyNote.trim();
    const request: PlaceOrderRequest = {
      channel,
      ...(timing === 'scheduled' ? { timing: { kind: 'scheduled', at: slot } } : {}),
      ...(channel === 'dine_in' && table ? { table_token: table.token } : {}),
      lines: cart.lines.map(toOrderLine),
      customer,
      preferences: {
        cutlery: channel === 'dine_in' ? false : cutlery,
        ...(note ? { allergy_note: note } : {}),
      },
      payment_method: method,
    };
    setPlacing(true);
    let result: RouteResult<OrderingOrderCreated>;
    try {
      result = await onPlace(request);
    } catch {
      result = { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'onPlace threw' } };
    }
    if (result.ok) {
      onPlaced(result.data);
      // The page navigates away; the button stays busy until it does.
      return;
    }
    setPlacing(false);
    const { error } = result;
    onRefused?.(error);
    const reason = error.details?.reason;
    if (error.code === 'INVALID_CUSTOMER' && reason && reason in fields.current) {
      setErrors({ [reason]: refusalMessage(error, labels) });
      fields.current[reason as CustomerField]?.focus();
      return;
    }
    setFailure(refusalMessage(error, labels, { opens }));
    failureRef.current?.focus();
  }

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
                  {slots === null ? labels.slotsLoading : slots.length === 0 ? labels.noSlots : ''}
                </p>
                {errorText('slot')}
              </div>
            </div>
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

      <div className="flex flex-col gap-2">
        <p
          ref={failureRef}
          tabIndex={-1}
          role="alert"
          className="font-medium text-destructive outline-none empty:hidden"
        >
          {failure ?? ''}
        </p>
        <button
          type="submit"
          disabled={closed || empty || method === undefined}
          aria-disabled={placing ? 'true' : undefined}
          aria-busy={placing ? 'true' : undefined}
          className="min-h-12 w-full rounded-full bg-primary px-4 font-semibold text-primary-foreground aria-disabled:opacity-60 disabled:opacity-40"
        >
          {placing
            ? labels.placing
            : fill(method === 'vipps' ? labels.payWithVipps : labels.placeOrder, { price })}
        </button>
      </div>
    </form>
  );
}
