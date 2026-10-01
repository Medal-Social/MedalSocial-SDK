/**
 * Where the manage summary's nulls stop — the wire is nullable throughout and
 * this is the last layer that can decide what a missing value means.
 *
 * `startTs` is the one field with no sensible default. A booking whose time did
 * not parse cannot be shown, moved or cancelled, so it is `null` here and the
 * page falls through to the same «we cannot find this appointment» card an
 * unknown token gets.
 */

import type { BookingManageDto } from '../core/types';
import type { MedalManageSummary } from '../core/wire';

export function toManageDto(summary: MedalManageSummary): BookingManageDto | null {
  const startTs = summary.start_ts === null ? Number.NaN : Date.parse(summary.start_ts);
  if (!Number.isFinite(startTs)) return null;
  const endTs = summary.end_ts === null ? Number.NaN : Date.parse(summary.end_ts);
  return {
    bookingId: summary.booking_id,
    status: summary.status,
    rescheduledFromId: summary.rescheduled_from_id,
    startTs,
    // An unreadable end is the start plus nothing rather than an «Invalid Date»
    // in a calendar file, which every calendar client refuses.
    endTs: Number.isFinite(endTs) ? endTs : startTs,
    serviceId: summary.service_id,
    serviceName: summary.service_name,
    resourceId: summary.resource_id,
    resourceName: summary.resource_name,
    bookedForName: summary.booked_for_name,
    partySequenceId: summary.party_sequence_id,
    amountOre: summary.amount_ore ?? 0,
    cancelWindowHours: summary.cancel_window_hours ?? 0,
    rescheduleWindowHours: summary.reschedule_window_hours ?? 0,
    // Relayed, never recomputed: the engine's own answers to «may this visitor
    // still press the button», produced with the comparison the writes enforce.
    canCancel: summary.can_cancel,
    canReschedule: summary.can_reschedule,
  };
}
