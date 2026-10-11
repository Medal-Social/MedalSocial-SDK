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

describe('party.adultTogether — a stylist named after the seats', () => {
  it('takes an automatic «Samtidig» back to one after another, and «first available» gives it back', () => {
    const both = seat(together, [guestChild(1), ADULT]);
    expect(both.partyMode).toBe('parallel');
    const named = together.reduce(both, { type: 'pickResource', resourceId: 'res-ada' });
    expect(named.partyMode).toBe('sequential');
    expect(named.resourceId).toBe('res-ada');
    const anyone = together.reduce(named, { type: 'pickResource', resourceId: null });
    expect(anyone.partyMode).toBe('parallel');
  });

  it('leaves a mode the parent picked alone when they name a stylist', () => {
    const both = seat(together, [guestChild(1), ADULT]);
    const picked = together.reduce(both, { type: 'setPartyMode', mode: 'sequential' });
    const named = together.reduce(picked, { type: 'pickResource', resourceId: 'res-ada' });
    expect(named.partyMode).toBe('sequential');
    expect(named.partyModeChosen).toBe(true);
  });
});

describe('pickSeatResource', () => {
  const two = () => {
    let state = seat(together, [guestChild(1), ADULT]);
    state = together.reduce(state, { type: 'pickServiceFor', index: 0, service: KLIPP });
    return together.reduce(state, { type: 'pickServiceFor', index: 1, service: KLIPP });
  };

  it('keeps a stylist per seat, clears the slot, and lets «anyone» release it', () => {
    const timed = together.reduce(two(), {
      type: 'pickPartySlot',
      startTs: Date.parse('2026-09-08T13:00:00+02:00'),
      resourceIds: ['res-a', 'res-b'],
      mode: 'parallel',
    });
    const asked = together.reduce(timed, {
      type: 'pickSeatResource',
      index: 0,
      resourceId: 'res-ada',
    });
    expect(asked.seatResourceIds).toEqual({ 'guest:1': 'res-ada' });
    expect(asked.startTs).toBeNull();
    const released = together.reduce(asked, {
      type: 'pickSeatResource',
      index: 0,
      resourceId: null,
    });
    expect(released).not.toHaveProperty('seatResourceIds');
  });

  it('refuses a stylist somebody else in the party asked for', () => {
    const asked = together.reduce(two(), {
      type: 'pickSeatResource',
      index: 0,
      resourceId: 'res-ada',
    });
    expect(
      together.reduce(asked, { type: 'pickSeatResource', index: 1, resourceId: 'res-ada' })
    ).toBe(asked);
    // Re-affirming one's own is fine.
    expect(
      together.reduce(asked, { type: 'pickSeatResource', index: 0, resourceId: 'res-ada' })
        .seatResourceIds
    ).toEqual({ 'guest:1': 'res-ada' });
  });

  it('ignores a seat that is not there', () => {
    const state = two();
    expect(
      together.reduce(state, { type: 'pickSeatResource', index: 5, resourceId: 'res-ada' })
    ).toBe(state);
  });

  it('drops the wishes when the basket changes', () => {
    const asked = together.reduce(two(), {
      type: 'pickSeatResource',
      index: 0,
      resourceId: 'res-ada',
    });
    const changed = together.reduce(asked, {
      type: 'choosePeople',
      people: [guestChild(1), guestChild(2)],
    });
    expect(changed).not.toHaveProperty('seatResourceIds');
  });
});
