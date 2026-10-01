/**
 * The three reducer paths the parity suite reached only through the wizard
 * component: «Bestill ny time», a prefill dispatched as an action, and a
 * service picked for a seat that does not exist.
 */

import { describe, expect, it } from 'vitest';
import { createWizard, initialState, type WizardService } from '../../src/core/machine';
import { PARITY_CONFIG } from '../support/parity-config';

const { reduce } = createWizard(PARITY_CONFIG);

const GUTTEKLIPP: WizardService = {
  id: 'svc-gutteklipp',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
};

describe('reduce — the paths the component suite used to cover', () => {
  it('starts over from a blank wizard', () => {
    const busy = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    expect(reduce(busy, { type: 'startOver' })).toEqual(initialState());
  });

  it('applies a prefill dispatched as an action', () => {
    const next = reduce(initialState(), {
      type: 'prefill',
      prefill: { serviceId: GUTTEKLIPP.id },
      catalogue: { services: [GUTTEKLIPP], resources: [] },
    });
    expect(next.items.map((item) => item.service.id)).toEqual([GUTTEKLIPP.id]);
    expect(next.step).toBe('when');
  });

  it('ignores a service picked for a seat nobody is sitting in', () => {
    const seated = reduce(initialState(), {
      type: 'choosePeople',
      people: [{ key: 'guest:1' }, { key: 'guest:2' }],
    });
    expect(reduce(seated, { type: 'pickServiceFor', index: 5, service: GUTTEKLIPP })).toBe(seated);
  });
});
