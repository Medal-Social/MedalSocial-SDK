import { describe, expect, it } from 'vitest';
import { createDto, RESOURCE_ID_SHAPE } from '../../src/core/dto';
import { PARITY_CONFIG } from '../support/parity-config';

const dto = createDto(PARITY_CONFIG);

describe('createDto', () => {
  it('groups a free-string category into the configured list', () => {
    expect(dto.normaliseServiceCategory('herre')).toBe('herre');
    expect(dto.normaliseServiceCategory('negler')).toBe('annet');
  });

  it('files a service with no category under the fallback', () => {
    const service = dto.toBookingServiceDto({
      id: 'svc',
      name: null,
      description: null,
      category: null,
      duration_minutes: null,
      buffer_before_minutes: null,
      buffer_after_minutes: null,
      price_ore: null,
      bookable_online: true,
      max_per_booking: null,
      weekend_surcharge_pct: null,
    });
    expect(service).toMatchObject({ category: 'annet', name: '', maxPerBooking: 1 });
  });

  it('builds an avatar path only for an id the route would accept', () => {
    expect(dto.avatarPath('res-1')).toBe('/api/booking/avatar/res-1');
    expect(dto.avatarPath('../etc')).toBeNull();
    expect(RESOURCE_ID_SHAPE.test('a'.repeat(65))).toBe(false);
  });

  it('drops a slot with no readable start', () => {
    expect(
      dto.toBookingSlotDto({ start_ts: null, end_ts: null, resource_id: 'r' } as never)
    ).toEqual([]);
    expect(
      dto.toBookingSlotDto({ start_ts: 'nope', end_ts: null, resource_id: 'r' } as never)
    ).toEqual([]);
    expect(
      dto.toBookingSlotDto({
        start_ts: '2026-09-02T08:00:00.000Z',
        end_ts: null,
        resource_id: null,
      } as never)
    ).toEqual([{ startTs: Date.UTC(2026, 8, 2, 8), resourceId: null }]);
  });
});
