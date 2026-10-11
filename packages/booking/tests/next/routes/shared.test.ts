import { describe, expect, it } from 'vitest';
import { MedalApiError, MedalConfigError } from '../../../src/next/medal';
import { isSlotTaken } from '../../../src/next/routes/shared';

/**
 * The engine says «that time cannot be booked» as `CONFLICT` with a structured
 * `details.reason` (and a message prefix older engines carry alone). This
 * helper is the one place that reads either, for the create route (its
 * `slotTaken` answer and the slot-cache expiry) and the manage route.
 */
describe('isSlotTaken', () => {
  it('recognises the engine’s taken-slot conflict', () => {
    expect(isSlotTaken(new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: 2026-09-02T09:00'))).toBe(
      true
    );
  });

  it('is not fooled by another conflict, another code, or another kind of error', () => {
    expect(isSlotTaken(new MedalApiError(409, 'CONFLICT', 'DUPLICATE_IDEMPOTENCY_KEY'))).toBe(
      false
    );
    expect(isSlotTaken(new MedalApiError(400, 'VALIDATION_ERROR', 'SLOT_TAKEN'))).toBe(false);
    expect(isSlotTaken(new MedalConfigError('SLOT_TAKEN'))).toBe(false);
    expect(isSlotTaken(new Error('SLOT_TAKEN'))).toBe(false);
    expect(isSlotTaken(null)).toBe(false);
  });

  it('reads the structured reason first, and the message only when there is none to read', () => {
    const conflict = (message: string, details?: unknown) =>
      new MedalApiError(409, 'CONFLICT', message, details);

    for (const reason of ['slot_taken', 'in_past', 'outside_horizon', 'off_grid']) {
      expect(isSlotTaken(conflict('whatever', { reason }))).toBe(true);
    }
    // A reason that is not one of them wins over the message.
    expect(isSlotTaken(conflict('SLOT_TAKEN', { reason: 'party_limit' }))).toBe(false);
    // No usable reason — null details, no `reason`, a reason that is not a
    // string — falls back to the message.
    expect(isSlotTaken(conflict('IN_PAST: gone', null))).toBe(true);
    expect(isSlotTaken(conflict('OFF_GRID: every 30', { horizonDays: 60 }))).toBe(true);
    expect(isSlotTaken(conflict('OUTSIDE_HORIZON: 60 days', { reason: 7 }))).toBe(true);
    expect(isSlotTaken(conflict('DUPLICATE_IDEMPOTENCY_KEY', null))).toBe(false);
  });
});
