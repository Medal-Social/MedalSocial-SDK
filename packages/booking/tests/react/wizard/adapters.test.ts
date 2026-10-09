import { describe, expect, it } from 'vitest';
import { guestChild, type WizardService } from '../../../src/core/machine';
import type { BookingResourceDto } from '../../../src/core/types';
import { createBookingKit } from '../../../src/react/kit';
import { mergeLabels } from '../../../src/react/labels';
import { partySizeWord, recapProps, stylistFace } from '../../../src/react/wizard/adapters';
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
