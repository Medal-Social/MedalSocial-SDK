import { describe, expect, it } from 'vitest';
import { MedalApiError, MedalConfigError } from '../../../src/next/medal';
import { isSlotTaken } from '../../../src/next/routes/shared';

/**
 * The engine says «that slot is gone» only as `CONFLICT` with `SLOT_TAKEN` in
 * the message — the SDK has no finer code — so the one place that reads the
 * message is this helper, used by the create route (its `slotTaken` answer and
 * the slot-cache expiry) and the manage route.
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
});
