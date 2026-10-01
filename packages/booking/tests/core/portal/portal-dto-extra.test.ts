import { describe, expect, it } from 'vitest';
import {
  createPortalDto,
  monthOrNull,
  rebookSuggestions,
  toPortalProfileDto,
} from '../../../src/core/portal/dto';
import { SECOND_CONFIG } from '../../support/second-config';

describe('createPortalDto', () => {
  it('hands back the pure projections and builds manage paths for THIS site', () => {
    const dto = createPortalDto(SECOND_CONFIG);
    expect(dto.toPortalProfileDto).toBe(toPortalProfileDto);
    expect(dto.rebookSuggestions).toBe(rebookSuggestions);
    expect(dto.monthOrNull).toBe(monthOrNull);
    const booking = dto.toPortalBookingDto({
      booking_id: 'bk',
      status: 'confirmed',
      start_ts: 0,
      end_ts: 0,
      start_ts_iso: '',
      end_ts_iso: '',
      service_id: null,
      service_name: null,
      resource_id: null,
      resource_name: null,
      booked_for_name: null,
      booked_for_person_id: null,
      booked_for_birth_year: null,
      booked_for_birth_month: null,
      amount_ore: null,
      payment_mode: 'none',
      payment_status: 'none',
      notes: null,
      manage_token: 'tok',
      can_manage: true,
    });
    expect(booking.managePath).toBe('/book/manage/tok');
  });
});
