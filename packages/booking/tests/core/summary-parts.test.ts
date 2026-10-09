/**
 * `summaryParts`: the bar's words in two lines — what (and with whom), then
 * when and for how much — always the same parts as `summaryLine`, so the
 * one-line bar and the two-line bar can never disagree.
 */

import { describe, expect, it } from 'vitest';
import { resolveBookingConfig } from '../../src/core/config';
import { createWizard, guestChild, initialState, type WizardService } from '../../src/core/machine';
import { PARITY_CONFIG } from '../support/parity-config';

const wizard = createWizard(PARITY_CONFIG);
const { reduce, summaryLine, summaryParts } = wizard;

const GUTTEKLIPP: WizardService = {
  id: 'svc-gutteklipp',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
};

const TUESDAY_13 = Date.parse('2026-09-08T13:00:00+02:00');
const NOW = Date.parse('2026-09-08T08:00:00+02:00');
const nobody = () => null;
const ada = (id: string) => (id === 'res-ada' ? 'Ada Demo' : null);

function oneChild(withService = false) {
  const seated = reduce(initialState(), {
    type: 'choosePeople',
    people: [guestChild(1)],
    advance: true,
  });
  return withService ? reduce(seated, { type: 'pickService', service: GUTTEKLIPP }) : seated;
}

describe('summaryParts', () => {
  it('is empty before anything is chosen', () => {
    expect(summaryParts(initialState(), nobody)).toEqual({ line: '', detail: '' });
  });

  it('says who before there is a service, with no second line', () => {
    const state = oneChild();
    expect(summaryParts(state, nobody)).toEqual({ line: summaryLine(state, nobody), detail: '' });
  });

  it('splits the one-line summary into what and when, word for word', () => {
    const chosen = oneChild(true);
    const timed = reduce(chosen, { type: 'pickSlot', startTs: TUESDAY_13, resourceId: 'res-ada' });
    for (const state of [chosen, timed]) {
      const { line, detail } = summaryParts(state, ada, NOW);
      expect(`${line} · ${detail}`).toBe(summaryLine(state, ada, NOW));
    }
    const { line, detail } = summaryParts(timed, ada, NOW);
    expect(line).toBe('Gutteklipp · Ada Demo');
    expect(detail).toContain('13:00');
  });
});

describe('resolveBookingConfig — screens', () => {
  it('turns every opt-in screen feature off by default', () => {
    expect(resolveBookingConfig({ timeZone: 'Europe/Oslo' }).screens).toEqual({
      recap: false,
      soonest: false,
      dayFullness: false,
      summaryDetail: false,
      hideDisabledNext: false,
      firstAvailableFaces: false,
      stylistEdgeFade: false,
      guestParty: false,
      childMenuFirst: false,
    });
  });

  it('takes the ones a site asks for, key by key', () => {
    const screens = resolveBookingConfig({
      timeZone: 'Europe/Oslo',
      screens: { recap: true, guestParty: true },
    }).screens;
    expect(screens.recap).toBe(true);
    expect(screens.guestParty).toBe(true);
    expect(screens.soonest).toBe(false);
  });
});
