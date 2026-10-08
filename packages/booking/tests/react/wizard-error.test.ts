import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/core/machine';
import { BOOKING_LABELS } from '../../src/react/labels';
import { forMedaScreen, wizardErrorText } from '../../src/react/wizard-error';

describe('the wizard’s error sentence', () => {
  it('fills the per-person ceiling into the maxServices refusal', () => {
    expect(wizardErrorText(BOOKING_LABELS.nb, 'maxServices', 2)).toBe(
      'Du kan velge opptil 2 tjenester per person.'
    );
    expect(wizardErrorText(BOOKING_LABELS.en, 'maxServices', 4)).toBe(
      'You can choose up to 4 services per person.'
    );
  });

  it('reads every other code through meda’s map', () => {
    expect(wizardErrorText(BOOKING_LABELS.nb, 'maxParty', 2)).toBe(
      BOOKING_LABELS.nb['details.error.maxParty']
    );
  });
});

describe('the state a meda screen is handed', () => {
  it('withholds the code meda has no sentence for', () => {
    expect(forMedaScreen({ ...initialState(), error: 'maxServices' }).error).toBeNull();
  });

  it('hands every other state over as it is', () => {
    const state = { ...initialState(), error: 'slotTaken' as const };
    expect(forMedaScreen(state)).toBe(state);
  });
});
