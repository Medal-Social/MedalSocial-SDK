import { describe, expect, it } from 'vitest';
import { resolveBookingConfig } from '../../src/core/config';
import { isEmailAddress } from '../../src/core/email';
import {
  canAdvance,
  canGoToStep,
  createWizard,
  initialState,
  type WizardService,
  type WizardState,
} from '../../src/core/machine';
import { PARITY_CONFIG } from '../support/parity-config';

const SERVICE: WizardService = {
  id: 'svc',
  name: 'Klipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
};

/** Every step answered, the details step with a phone and the terms ticked. */
function onDetails(email: string): WizardState {
  return {
    ...initialState(),
    step: 'details',
    items: [{ service: SERVICE }],
    startTs: Date.UTC(2026, 8, 3, 13),
    contact: { phone: '40000000', name: '', email },
    consentTerms: true,
  };
}

describe('details.emailRequired', () => {
  it('leaves the address optional by default, standalone and bound', () => {
    expect(canAdvance(onDetails(''))).toBe(true);
    expect(createWizard(PARITY_CONFIG).canAdvance(onDetails(''))).toBe(true);
    // A hand-built `WizardConfig` with no `details` keeps the old rule.
    const { details: _details, ...withoutDetails } = PARITY_CONFIG;
    expect(createWizard(withoutDetails).canAdvance(onDetails(''))).toBe(true);
  });

  it('needs a valid address under the rule', () => {
    expect(canAdvance(onDetails(''), { emailRequired: true })).toBe(false);
    expect(canAdvance(onDetails('   '), { emailRequired: true })).toBe(false);
    expect(canAdvance(onDetails('kari@'), { emailRequired: true })).toBe(false);
    expect(canAdvance(onDetails(' kari@example.no '), { emailRequired: true })).toBe(true);
  });

  it('is bound by createWizard from the config', () => {
    const wizard = createWizard(
      resolveBookingConfig({ ...PARITY_CONFIG, details: { emailRequired: true } })
    );
    expect(wizard.canAdvance(onDetails(''))).toBe(false);
    expect(wizard.canAdvance(onDetails('kari@example.no'))).toBe(true);
  });

  it('never blocks reaching the details step, where the address is typed', () => {
    const state = { ...onDetails(''), step: 'when' as const };
    expect(canGoToStep(state, 'details', { emailRequired: true })).toBe(true);
    const wizard = createWizard(
      resolveBookingConfig({ ...PARITY_CONFIG, details: { emailRequired: true } })
    );
    expect(wizard.canGoToStep(state, 'details')).toBe(true);
    expect(wizard.reduce(state, { type: 'goToStep', step: 'details' }).step).toBe('details');
  });
});

describe('isEmailAddress', () => {
  it('takes an ordinary address and refuses blank or malformed ones', () => {
    expect(isEmailAddress('kari@example.no')).toBe(true);
    expect(isEmailAddress('  kari@example.no  ')).toBe(true);
    expect(isEmailAddress('')).toBe(false);
    expect(isEmailAddress('  ')).toBe(false);
    expect(isEmailAddress('kari@')).toBe(false);
    expect(isEmailAddress('kari@example')).toBe(false);
    expect(isEmailAddress('kari example@x.no')).toBe(false);
  });
});
