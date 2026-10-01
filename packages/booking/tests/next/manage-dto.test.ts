import { describe, expect, it } from 'vitest';
import { toManageDto } from '../../src/next/manage-dto';
import { inBackground } from '../../src/next/options';

/** Where the manage summary's nulls stop. */

const SUMMARY = {
  booking_id: 'b-1',
  contact_id: null,
  status: 'confirmed' as const,
  cancelled_by: null,
  cancel_reason: null,
  rescheduled_from_id: 'b-0',
  start_ts: '2026-09-10T08:00:00.000Z',
  end_ts: '2026-09-10T08:30:00.000Z',
  service_id: 'svc-1',
  service_name: 'Klipp',
  resource_id: 'res-1',
  resource_name: 'Kari',
  booked_for_name: 'Ola',
  party_sequence_id: 'p-1',
  amount_ore: 45_000,
  payment_status: null,
  payment_mode: 'none' as const,
  time_zone: 'Europe/Oslo',
  cancel_window_hours: 24,
  reschedule_window_hours: 12,
  can_cancel: true,
  can_reschedule: false,
};

describe('toManageDto', () => {
  it('relays every field, in the page’s own terms', () => {
    expect(toManageDto(SUMMARY as never)).toEqual({
      bookingId: 'b-1',
      status: 'confirmed',
      rescheduledFromId: 'b-0',
      startTs: Date.parse('2026-09-10T08:00:00.000Z'),
      endTs: Date.parse('2026-09-10T08:30:00.000Z'),
      serviceId: 'svc-1',
      serviceName: 'Klipp',
      resourceId: 'res-1',
      resourceName: 'Kari',
      bookedForName: 'Ola',
      partySequenceId: 'p-1',
      amountOre: 45_000,
      cancelWindowHours: 24,
      rescheduleWindowHours: 12,
      canCancel: true,
      canReschedule: false,
    });
  });

  it('has no booking without a readable start', () => {
    expect(toManageDto({ ...SUMMARY, start_ts: null } as never)).toBeNull();
    expect(toManageDto({ ...SUMMARY, start_ts: 'soon' } as never)).toBeNull();
  });

  it('ends an unreadable end at the start, and zeroes the missing numbers', () => {
    for (const end_ts of [null, 'later']) {
      const dto = toManageDto({
        ...SUMMARY,
        end_ts,
        amount_ore: null,
        cancel_window_hours: null,
        reschedule_window_hours: null,
      } as never);
      expect(dto).toMatchObject({
        endTs: dto?.startTs,
        amountOre: 0,
        cancelWindowHours: 0,
        rescheduleWindowHours: 0,
      });
    }
  });
});

describe('inBackground', () => {
  it('swallows a failure, handed off or awaited', async () => {
    const failing = () => Promise.reject(new Error('cache down'));
    await expect(inBackground({}, failing())).resolves.toBeUndefined();
    let handed: Promise<unknown> | undefined;
    await inBackground(
      {
        defer: (work) => {
          handed = work;
          return true;
        },
      },
      failing()
    );
    await expect(handed).resolves.toBeUndefined();
  });
});
