/**
 * `party.adultTogether`: a party with a grown-up in it starts «Samtidig» —
 * the child in one chair, the parent in the next — until the parent picks a
 * mode themselves, or names one stylist.
 */

import { describe, expect, it } from 'vitest';
import { resolveBookingConfig } from '../../src/core/config';
import {
  createWizard,
  guestChild,
  initialState,
  type WizardPerson,
  type WizardService,
} from '../../src/core/machine';

const ADULT: WizardPerson = { key: 'adult', adult: true };
const KLIPP: WizardService = {
  id: 'svc-klipp',
  name: 'Klipp',
  category: 'annet',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
};
const together = createWizard(
  resolveBookingConfig({ timeZone: 'Europe/Oslo', party: { adultTogether: true } })
);
const seat = (wizard: ReturnType<typeof createWizard>, people: WizardPerson[]) =>
  wizard.reduce(initialState(), { type: 'choosePeople', people });

describe('party.adultTogether', () => {
  it('is off by default: a child and a parent stay «rett etter hverandre»', () => {
    const plain = createWizard(resolveBookingConfig({ timeZone: 'Europe/Oslo' }));
    expect(seat(plain, [guestChild(1), ADULT]).partyMode).toBe('sequential');
  });

  it('starts a party with a grown-up «Samtidig», and only a party', () => {
    expect(seat(together, [guestChild(1), ADULT]).partyMode).toBe('parallel');
    expect(seat(together, [guestChild(1), guestChild(2)]).partyMode).toBe('sequential');
    expect(seat(together, [ADULT]).partyMode).toBe('sequential');
  });

  it('goes back to one after another when the grown-up leaves the party', () => {
    const both = seat(together, [guestChild(1), ADULT]);
    const children = together.reduce(both, {
      type: 'choosePeople',
      people: [guestChild(1), guestChild(2)],
    });
    expect(children.partyMode).toBe('sequential');
  });

  it('leaves a mode the parent picked alone from then on', () => {
    const picked = together.reduce(seat(together, [guestChild(1)]), {
      type: 'setPartyMode',
      mode: 'sequential',
    });
    expect(picked.partyModeChosen).toBe(true);
    const withAdult = together.reduce(picked, {
      type: 'choosePeople',
      people: [guestChild(1), ADULT],
    });
    expect(withAdult.partyMode).toBe('sequential');
  });

  it('counts a party slot found in a mode as the parent’s choice', () => {
    let both = seat(together, [guestChild(1), ADULT]);
    both = together.reduce(both, { type: 'pickServiceFor', index: 0, service: KLIPP });
    both = together.reduce(both, { type: 'pickServiceFor', index: 1, service: KLIPP });
    expect(both.items).toHaveLength(2);
    const slot = together.reduce(both, {
      type: 'pickPartySlot',
      startTs: Date.parse('2026-09-08T13:00:00+02:00'),
      resourceIds: ['res-a', 'res-b'],
      mode: 'parallel',
    });
    expect(slot.partyResourceIds).toEqual(['res-a', 'res-b']);
    expect(slot.partyModeChosen).toBe(true);
  });

  it('keeps a party with a named stylist one after another', () => {
    const named = together.reduce(initialState(), { type: 'pickResource', resourceId: 'res-ada' });
    const both = together.reduce(named, { type: 'choosePeople', people: [guestChild(1), ADULT] });
    expect(both.partyMode).toBe('sequential');
    expect(both.resourceId).toBe('res-ada');
  });

  it('does nothing on a site without parallel seating', () => {
    const sequentialOnly = createWizard(
      resolveBookingConfig({
        timeZone: 'Europe/Oslo',
        party: { adultTogether: true, allowParallel: false },
      })
    );
    expect(seat(sequentialOnly, [guestChild(1), ADULT]).partyMode).toBe('sequential');
  });
});
