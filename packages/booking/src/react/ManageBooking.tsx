import {
  type ManageErrorCode,
  type ManagePricing,
  type ManageResult,
  ManageScreen,
} from '@medalsocial/meda/booking';
import { useCallback, useMemo, useState } from 'react';
import { fill, labelText } from '../core/labels';
import type { BookingManageDto, BookingServiceDto, BookingSlotDto } from '../core/types';
import { type BookingOverrides, useBookingKit } from './Provider';
import { screenLabels } from './screen-labels';

const DAY_MS = 86_400_000;

/**
 * How far either side of the appointment to ask for openings: centred on the
 * booking rather than on today, because somebody moving an appointment three
 * weeks out wants the days around it. Always covers the appointment's own day.
 */
const LOOK_BACK_MS = 2 * DAY_MS;
const LOOK_AHEAD_MS = 7 * DAY_MS;

/** The engine's English stand-in for a deleted catalogue row; never printed. */
const UNKNOWN_SERVICE = 'Unknown service';

const CODES: readonly string[] = [
  'windowPassed',
  'slotTaken',
  'notFound',
  'conflict',
  'invalidInput',
];

/** Anything the route did not name is an outage as far as this page is concerned. */
function asErrorCode(code: unknown): ManageErrorCode {
  return CODES.includes(code as string) ? (code as ManageErrorCode) : 'unavailable';
}

export interface ManageBookingProps extends BookingOverrides {
  booking: BookingManageDto;
  /**
   * The business's number. Absent = `config.contact.phone`; `null` renders
   * every phone sentence unlinked (a `tel:` that dials nothing is worse than
   * plain text, and worst here, where the phone is the last way to change it).
   */
  phone?: string | null;
  /** The address under the booking and in the calendar entry. Absent = `config.contact.address`. */
  address?: string | null;
  /** The catalogue entry for the booked service, for the weekend note. `null` = no note. */
  service?: BookingServiceDto | null;
  /**
   * Where the two mutations POST: `${config.paths.api}/manage/<token>`, built by
   * the server that holds the token. A path, not the token, so no prop, state
   * or error payload ever names the credential. The default matches no route
   * and so fails loudly rather than posting a tokenless action.
   */
  actionPath?: string;
  /**
   * This page's own manage path (`paths.managePath(token)`), for the calendar
   * entry's «change or cancel» line. `null` = no such line.
   */
  selfManagePath?: string | null;
  /** Where «book a new time» goes. Absent = `config.paths.booking`. */
  bookHref?: string;
  /**
   * The site's origin, to make the calendar entry's manage link absolute. Absent
   * = the link stays root-relative, so server and client render the same.
   */
  siteUrl?: string;
}

/**
 * `<ManageBooking>` — the page at the end of the «manage your booking» link.
 *
 * Renders meda's `ManageScreen` and does what it leaves to the caller: loads
 * the openings around the appointment from `${paths.api}/availability`, posts
 * cancel and reschedule to `actionPath`, maps the route's error codes, puts the
 * freshly minted manage link in the address bar after a move, and builds the
 * calendar entry (UID = the booking the entry was created under).
 *
 * The change windows are the engine's: `canCancel` / `canReschedule` are
 * relayed, never recomputed.
 */
export function ManageBooking({
  booking,
  phone,
  address,
  service = null,
  actionPath,
  selfManagePath = null,
  bookHref,
  siteUrl,
  ...overrides
}: ManageBookingProps) {
  const { kit, classNames, components } = useBookingKit(overrides);
  const { config, labels } = kit;
  const { contact, paths } = config;
  const tel = phone === undefined ? contact.phone : phone;
  const where = address === undefined ? contact.address : address;
  const post = actionPath ?? `${paths.api}/manage`;

  const [slots, setSlots] = useState<BookingSlotDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  const { serviceId, resourceId, startTs } = booking;
  /**
   * The openings, locked to the booked service and stylist — which is what lets
   * the confirm name the stylist without a second lookup.
   */
  const loadSlots = useCallback(async () => {
    if (serviceId === null) {
      setFailed(true);
      return;
    }
    setFailed(false);
    const query = new URLSearchParams({
      service_id: serviceId,
      from_ts: String(Math.max(Date.now(), startTs - LOOK_BACK_MS)),
      to_ts: String(startTs + LOOK_AHEAD_MS),
      ...(resourceId ? { resource_id: resourceId } : {}),
    });
    try {
      const response = await fetch(`${paths.api}/availability?${query}`);
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const body = (await response.json()) as { slots?: BookingSlotDto[] };
      // Always a fresh array: the screen hides the one it held when a move lost
      // its slot until a NEW one arrives, and a cached body could hand back the same.
      setSlots([...(body.slots ?? [])]);
    } catch {
      setFailed(true);
    }
  }, [serviceId, resourceId, startTs, paths.api]);

  /** One POST. The screen holds the buttons down for the round trip. */
  const mutate = useCallback(
    async (body: Record<string, unknown>): Promise<ManageResult & { manageToken?: string }> => {
      try {
        const response = await fetch(post, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          manageToken?: string;
        } | null;
        if (!response.ok) return { ok: false, code: asErrorCode(payload?.error) };
        return { ok: true, manageToken: payload?.manageToken };
      } catch {
        return { ok: false, code: 'unavailable' };
      }
    },
    [post]
  );

  const onCancel = useCallback(
    async (reason: string | null): Promise<ManageResult> => {
      const result = await mutate({ action: 'cancel', ...(reason ? { reason } : {}) });
      return result.ok ? { ok: true } : result;
    },
    [mutate]
  );

  const onReschedule = useCallback(
    async (slot: BookingSlotDto): Promise<ManageResult> => {
      const result = await mutate({ action: 'reschedule', startTs: slot.startTs });
      if (!result.ok) return result;
      // The token the visitor arrived with belongs to the row the move
      // cancelled; the new one is minted once and omitted from an idempotent
      // replay. No token means no link rather than a broken one.
      const manageHref = result.manageToken ? kit.paths.managePath(result.manageToken) : null;
      // The ADDRESS BAR too: a refresh would otherwise reload the dead token,
      // and this screen holds the only copy of the new one. `replaceState`, so
      // nothing unmounts and Back does not return to the dead token.
      if (manageHref !== null) window.history.replaceState(null, '', manageHref);
      return { ok: true, manageHref };
    },
    [mutate, kit.paths]
  );

  const pricing = useMemo<ManagePricing | null>(
    () =>
      service && {
        priceAt: (ts) => kit.wizard.totalPriceOre([{ service }], ts),
        weekendSurchargePct: service.weekendSurchargePct,
      },
    [service, kit.wizard]
  );

  /**
   * «Add to calendar». REQUEST / SEQUENCE:1 when this booking is itself a move,
   * under the UID the entry was created with (`rescheduledFromId`); PUBLISH / 0
   * otherwise. The way back in travels with the entry: a REQUEST without it
   * would delete the manage link from the customer's calendar.
   */
  const icsHref = useMemo(() => {
    const serviceLabel =
      booking.serviceName === UNKNOWN_SERVICE
        ? labelText(labels['manage.serviceFallback'])
        : booking.serviceName;
    const name = booking.bookedForName;
    const moved = booking.rescheduledFromId !== null;
    const manageUrl =
      selfManagePath && (siteUrl ? new URL(selfManagePath, siteUrl).toString() : selfManagePath);
    return kit.ics.icsDataUrl(
      kit.ics.buildIcs({
        uid: booking.rescheduledFromId ?? booking.bookingId,
        startTs: booking.startTs,
        endTs: booking.endTs,
        summary: fill(labels[name ? 'manage.ics.titleFor' : 'manage.ics.title'], {
          service: serviceLabel,
          name: name ?? '',
          business: contact.name,
        }),
        description: [
          fill(labels['manage.ics.price'], { price: kit.money.formatMinor(booking.amountOre) }),
          ...(manageUrl ? [fill(labels['manage.ics.manage'], { url: manageUrl })] : []),
        ].join('\n'),
        ...(where ? { location: where } : {}),
        method: moved ? 'REQUEST' : 'PUBLISH',
        sequence: moved ? 1 : 0,
      })
    );
  }, [booking, labels, selfManagePath, siteUrl, where, contact.name, kit]);

  return (
    <ManageScreen
      labels={screenLabels(labels)}
      format={kit.format}
      dayparts={kit.dayparts}
      booking={booking}
      phone={tel}
      address={where}
      bookingHref={bookHref ?? paths.booking}
      portalHref={paths.portal}
      icsHref={icsHref}
      icsFileName={labelText(labels['manage.ics.fileName'])}
      pricing={pricing}
      reschedule={{ slots, failed }}
      onRequestSlots={loadSlots}
      onCancel={onCancel}
      onReschedule={onReschedule}
      classNames={classNames.manage}
      timeClassNames={classNames.time}
      components={{ DayChip: components.DayChip, TimeChip: components.TimeChip }}
    />
  );
}
