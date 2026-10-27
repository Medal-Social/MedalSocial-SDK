import { describe, expect, it } from 'vitest';
import {
  guestAdult,
  guestChild,
  type WizardPerson,
  type WizardService,
} from '../../../src/core/machine';
import type { BookingResourceDto } from '../../../src/core/types';
import { createBookingKit } from '../../../src/react/kit';
import { mergeLabels } from '../../../src/react/labels';
import {
  partyPeople,
  partySizeWord,
  recapProps,
  seatChoices,
  stylistFace,
  stylistSeats,
} from '../../../src/react/wizard/adapters';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

describe('partySizeWord', () => {
  it('spells two, three and more from the pack', () => {
    const labels = mergeLabels('nb');
    expect(partySizeWord(labels, 2)).toBe('to');
    expect(partySizeWord(labels, 3)).toBe('tre');
    expect(partySizeWord(labels, 4)).toBe('flere');
    expect(partySizeWord(mergeLabels('en'), 2)).toBe('two');
  });

  it('leaves the number to meda where the pack is blank, in either form', () => {
    const labels = mergeLabels('nb', {
      'wizard.party.sizeWord.two': '',
      'wizard.party.sizeWord.three': [],
      'wizard.party.sizeWord.other': ['fl', 'ere'],
    });
    expect(partySizeWord(labels, 2)).toBeUndefined();
    expect(partySizeWord(labels, 3)).toBeUndefined();
    expect(partySizeWord(labels, 5)).toBe('flere');
  });
});

const kit = createBookingKit(PARITY_CONFIG, TEST_LABELS);
const { reduce, initialState } = kit.wizard;

const KLIPP: WizardService = {
  id: 'svc-klipp',
  name: 'Klipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
};

const stylist = (id: string, name: string): BookingResourceDto => ({
  id,
  name,
  photoUrl: `https://example.test/${id}.jpg`,
  bio: null,
  serviceIds: [KLIPP.id],
  sortOrder: 0,
});
const ADA = stylist('res-ada', 'Ada');
const BO = stylist('res-bo', 'Bo');
const RESOURCES = [ADA, BO];
const AT = Date.parse('2026-09-08T13:00:00+02:00');

function oneVisit() {
  const seated = reduce(initialState(), {
    type: 'choosePeople',
    people: [guestChild(1)],
    advance: true,
  });
  return reduce(seated, { type: 'pickService', service: KLIPP });
}

describe('stylistFace', () => {
  it('names a stylist by id, and nobody for no id or one the catalogue lost', () => {
    expect(stylistFace(RESOURCES, 'res-bo')).toEqual({ name: 'Bo', photoUrl: BO.photoUrl });
    expect(stylistFace(RESOURCES, null)).toBeNull();
    expect(stylistFace(RESOURCES, 'res-gone')).toBeNull();
  });
});

describe('recapProps', () => {
  it('names the line’s services, end and stylist', () => {
    const timed = reduce(oneVisit(), { type: 'pickSlot', startTs: AT, resourceId: 'res-ada' });
    const { lines } = recapProps(kit, timed, RESOURCES, []);
    expect(lines).toEqual([
      {
        startTs: AT,
        endTs: AT + 30 * 60_000,
        services: ['Klipp'],
        stylist: { name: 'Ada', photoUrl: ADA.photoUrl },
        who: null,
      },
    ]);
  });

  it('offers each other stylist free at that very minute once, for a first-available visit', () => {
    const timed = reduce(oneVisit(), { type: 'pickSlot', startTs: AT, resourceId: 'res-ada' });
    const { alternatives } = recapProps(kit, timed, RESOURCES, [
      { startTs: AT, resourceId: 'res-ada' },
      { startTs: AT, resourceId: 'res-bo' },
      { startTs: AT, resourceId: 'res-bo' },
      { startTs: AT, resourceId: 'res-gone' },
      { startTs: AT, resourceId: null },
      { startTs: AT + 15 * 60_000, resourceId: 'res-bo' },
    ]);
    expect(alternatives).toEqual([{ resourceId: 'res-bo', name: 'Bo', photoUrl: BO.photoUrl }]);
  });

  it('offers no swap for a stylist the parent named, nor before there is a time', () => {
    const slots = [{ startTs: AT, resourceId: 'res-bo' }];
    const named = reduce(oneVisit(), { type: 'pickResource', resourceId: 'res-ada' });
    const namedTimed = reduce(named, { type: 'pickSlot', startTs: AT, resourceId: 'res-ada' });
    expect(recapProps(kit, namedTimed, RESOURCES, slots).alternatives).toEqual([]);
    const untimed = recapProps(kit, oneVisit(), RESOURCES, slots);
    expect(untimed.alternatives).toEqual([]);
    expect(untimed.lines[0]?.stylist).toBeNull();
  });
});

describe('seatChoices', () => {
  function seated(people: WizardPerson[]) {
    let state = reduce(initialState(), { type: 'choosePeople', people });
    people.forEach((_, index) => {
      state = reduce(state, { type: 'pickServiceFor', index, service: KLIPP });
    });
    return state;
  }

  it('names each seat as the service step does, with its visit and its own stylist', () => {
    let state = seated([
      guestChild(1),
      { key: 'p:mia', name: 'Mia', birthYear: 2019, personId: 'mia' },
      { key: 'self', adult: true },
    ]);
    state = reduce(state, { type: 'pickSeatResource', index: 1, resourceId: 'res-ada' });
    const seats = seatChoices(kit, state);
    expect(seats.map((seat) => seat.who)).toEqual([
      String(TEST_LABELS['wizard.party.child']).replace('{n}', '1'),
      'Mia',
      TEST_LABELS['people.self'],
    ]);
    expect(seats.map((seat) => seat.resourceId)).toEqual([null, 'res-ada', null]);
    expect(seats[0].serviceIds).toEqual([KLIPP.id]);
  });

  it('names a grown-up guest seat', () => {
    const seats = seatChoices(kit, seated([guestChild(1), { key: 'adult', adult: true }]));
    expect(seats[1].who).toBe(TEST_LABELS['people.adult']);
  });
});

describe('several guest grown-ups', () => {
  const none = () => null;
  const labelsOf = (people: WizardPerson[], k = kit) =>
    partyPeople(k, people, none, none).map((person) => person.label);

  it('numbers them «Person 1», «Person 2» on the service step’s tabs', () => {
    expect(labelsOf([guestAdult(1), guestAdult(2)])).toEqual(['Person 1', 'Person 2']);
  });

  it('numbers only the grown-ups sharing the generic word, not the children or «Meg selv»', () => {
    expect(labelsOf([guestChild(1), guestAdult(1), guestAdult(2), guestAdult(3)])).toEqual([
      String(TEST_LABELS['wizard.party.child']).replace('{n}', '1'),
      'Person 1',
      'Person 2',
      'Person 3',
    ]);
    expect(labelsOf([{ key: 'self', adult: true }, guestAdult(2), guestAdult(3)])).toEqual([
      TEST_LABELS['people.self'],
      'Person 1',
      'Person 2',
    ]);
  });

  it('keeps one grown-up — alone or beside «Meg selv» — as `people.adult`', () => {
    expect(labelsOf([guestChild(1), guestAdult(1)])[1]).toBe(TEST_LABELS['people.adult']);
    expect(labelsOf([{ key: 'self', adult: true }, guestAdult(2)])).toEqual([
      TEST_LABELS['people.self'],
      TEST_LABELS['people.adult'],
    ]);
  });

  it('reads the number from the pack, in English too', () => {
    const custom = createBookingKit(
      PARITY_CONFIG,
      mergeLabels('nb', TEST_LABELS, { 'wizard.party.adult': ['Gjest ', '{n}'] })
    );
    expect(labelsOf([guestAdult(1), guestAdult(2)], custom)).toEqual(['Gjest 1', 'Gjest 2']);
    expect(mergeLabels('en')['wizard.party.adult']).toBe('Person {n}');
  });

  it('keeps a site’s own `people.adult` for several grown-ups unless it opts in', () => {
    const site = mergeLabels('nb', { 'people.adult': 'Person' });
    expect(site['wizard.party.adult']).toBeUndefined();
    const own = createBookingKit(PARITY_CONFIG, site);
    expect(labelsOf([guestAdult(1), guestAdult(2)], own)).toEqual(['Person', 'Person']);

    const optedIn = mergeLabels(
      'nb',
      { 'people.adult': 'Person' },
      { 'wizard.party.adult': 'Person {n}' }
    );
    const numbered = createBookingKit(PARITY_CONFIG, optedIn);
    expect(labelsOf([guestAdult(1), guestAdult(2)], numbered)).toEqual(['Person 1', 'Person 2']);
    // A whole pack merged again keeps what the first merge decided.
    expect(mergeLabels('nb', site)['wizard.party.adult']).toBeUndefined();
    expect(mergeLabels('nb', optedIn)['wizard.party.adult']).toBe('Person {n}');
  });

  it('reads the built-in number in an earlier pack as no choice, a site’s own as one', () => {
    // A whole pack under a later `people.adult`: the word wins.
    expect(
      mergeLabels('nb', mergeLabels('en'), { 'people.adult': 'Gjest' })['wizard.party.adult']
    ).toBeUndefined();
    // A numbered word of the site's own stays, wherever the rename comes from.
    expect(
      mergeLabels('nb', { 'wizard.party.adult': 'Gjest {n}' }, { 'people.adult': 'Gjest' })[
        'wizard.party.adult'
      ]
    ).toBe('Gjest {n}');
  });

  it('falls back to `people.adult` for a pack without the key', () => {
    const { 'wizard.party.adult': _numbered, ...older } = TEST_LABELS;
    const legacy = createBookingKit(PARITY_CONFIG, older as typeof TEST_LABELS);
    expect(labelsOf([guestAdult(1), guestAdult(2)], legacy)).toEqual([
      TEST_LABELS['people.adult'],
      TEST_LABELS['people.adult'],
    ]);
  });

  it('names the seats in «who cuts whom» the same way', () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [guestAdult(1), guestAdult(2)],
    });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: KLIPP });
    state = reduce(state, { type: 'pickServiceFor', index: 1, service: KLIPP });
    expect(seatChoices(kit, state).map((seat) => seat.who)).toEqual(['Person 1', 'Person 2']);
  });
});

describe('stylistSeats', () => {
  const on = createBookingKit(
    { ...PARITY_CONFIG, screens: { ...PARITY_CONFIG.screens, seatStylists: true } },
    TEST_LABELS
  );
  const two = () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [guestChild(1), guestChild(2)],
    });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: KLIPP });
    return reduce(state, { type: 'pickServiceFor', index: 1, service: KLIPP });
  };
  const onSeat = () => undefined;

  it('offers the seats only seen at once, and only with the switch on', () => {
    const sequential = two();
    const parallel = reduce(sequential, { type: 'setPartyMode', mode: 'parallel' });
    expect(stylistSeats(on, sequential, onSeat)).toEqual({});
    expect(stylistSeats(kit, parallel, onSeat)).toEqual({});
    const seen = stylistSeats(on, parallel, onSeat);
    expect(seen.seats).toHaveLength(2);
    expect(seen.onSeat).toBe(onSeat);
  });
});
