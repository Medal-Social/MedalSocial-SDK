import { describe, expect, it } from 'vitest';
import type { WizardItem, WizardService } from '../../src/core/machine';
import {
  createPartySlots,
  findPartySlots,
  firstPartyStartPerResource,
  type PartySlot,
  slotKeysFor,
} from '../../src/core/party-slots';
import type { BookingSlotDto } from '../../src/core/types';
import { PARITY_CONFIG } from '../support/parity-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

const { partyAlternative } = createPartySlots(PARITY_CONFIG);

/**
 * `partyAlternative` groups by the SALON's day, and this suite normally runs in
 * Oslo — where a search that grouped by the viewer's day would sort the same
 * slots into the same buckets and no assertion here would notice until a parent
 * booked from Spain.
 */
pinAForeignViewerClock();

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

const JENTEKLIPP: WizardService = { ...GUTTEKLIPP, id: 'svc-jenteklipp', name: 'Jenteklipp' };

const JONAS: WizardItem = { service: GUTTEKLIPP };
const EMMA: WizardItem = { service: JENTEKLIPP };

/**
 * An Oslo wall-clock instant on Thursday 3 September 2026, or the Friday.
 *
 * The offset is spelled out — the 3rd is inside CEST, so Oslo is UTC+02:00 —
 * because that is the one construction the runner's own zone cannot move.
 */
function at(clock: string, day: 3 | 4 = 3): number {
  return Date.parse(`2026-09-0${day}T${clock}:00+02:00`);
}

/** Availability as the route returns it: one row per stylist per instant. */
function slots(...rows: Array<[resourceId: string | null, clock: string, day?: 3 | 4]>) {
  return rows.map(
    ([resourceId, clock, day]): BookingSlotDto => ({ startTs: at(clock, day ?? 3), resourceId })
  );
}

/** The stylist each line resolved to, in basket order. */
function stylistsOf(slot: PartySlot): string[] {
  return slot.seats.map((seat) => seat.resourceId);
}

/** When each child sits down, on the salon's clock. */
function seatingOf(slot: PartySlot): string[] {
  return slot.seats.map((seat) =>
    new Intl.DateTimeFormat('nb-NO', {
      timeZone: 'Europe/Oslo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(seat.startTs)
  );
}

describe('findPartySlots — sequential', () => {
  /**
   * The report's own example: Sara does Gutteklipp AND Jenteklipp, Marcus only
   * the first. A search that checked the service the visitor tapped first and
   * stopped would hand the family Marcus — who cannot cut Emma — which is a
   * refusal the engine issues at submit, offered here as a slot.
   *
   * Marcus is deliberately the first stylist the catalogue mentions, so a
   * `some`-instead-of-`every` reads him out before it ever reaches Sara.
   */
  it('picks a stylist qualified for every service in the party, not just the first', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-marcus', '15:00'], ['res-sara', '15:00']),
        [JENTEKLIPP.id]: slots(['res-sara', '15:30']),
      },
      'sequential'
    );

    expect(found).toHaveLength(1);
    expect(stylistsOf(found[0])).toEqual(['res-sara', 'res-sara']);
    expect(seatingOf(found[0])).toEqual(['15:00', '15:30']);
  });

  /**
   * «Rett etter hverandre» is a claim about sixty unbroken minutes, and two
   * openings an hour and a half apart are not that. A parent handed this as a
   * party slot would sit in the salon from 15:30 to 16:30 with nothing
   * happening, having been told the visit was an hour.
   */
  it('refuses two openings that are not contiguous', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-sara', '15:00']),
        // 16:30, not 15:30 — the second child's cut has to begin the minute the
        // first one's ends.
        [JENTEKLIPP.id]: slots(['res-sara', '16:30']),
      },
      'sequential'
    );

    expect(found).toEqual([]);
  });

  /** Two stylists who could each take the whole visit are one offer to a
   * parent, not two identical chips: step 3 asks when, and who was step 2's
   * question. */
  it('offers one slot per instant even when several stylists could take it', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-sara', '15:00'], ['res-marcus', '15:00']),
        [JENTEKLIPP.id]: slots(['res-sara', '15:30'], ['res-marcus', '15:30']),
      },
      'sequential'
    );

    expect(found.map((slot) => slot.startTs)).toEqual([at('15:00')]);
  });

  it('returns the instants in the order the day runs', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-sara', '16:00'], ['res-sara', '15:00']),
        [JENTEKLIPP.id]: slots(['res-sara', '16:30'], ['res-sara', '15:30']),
      },
      'sequential'
    );

    expect(found.map((slot) => slot.startTs)).toEqual([at('15:00'), at('16:00')]);
  });
});

describe('findPartySlots — parallel', () => {
  it('pairs two different stylists free at the same instant', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-marcus', '15:00']),
        [JENTEKLIPP.id]: slots(['res-sara', '15:00']),
      },
      'parallel'
    );

    expect(found).toHaveLength(1);
    expect(stylistsOf(found[0])).toEqual(['res-marcus', 'res-sara']);
    // Both children sit down together — that is the whole offer.
    expect(seatingOf(found[0])).toEqual(['15:00', '15:00']);
  });

  /**
   * The rule no availability data states on its own: one free slot is genuinely
   * free for either child, so a search that did not track who it had already
   * spent would promise Sara to both — and the salon would discover at 15:00
   * that she has two children in one chair.
   */
  it('will not seat two children with the same stylist at once', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-sara', '15:00']),
        [JENTEKLIPP.id]: slots(['res-sara', '15:00']),
      },
      'parallel'
    );

    expect(found).toEqual([]);
  });

  it('needs both of them free at the same minute, not merely on the same day', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots(['res-sara', '15:00']),
        // Marcus has a gap, half an hour after the one that was on offer.
        [JENTEKLIPP.id]: slots(['res-marcus', '15:30']),
      },
      'parallel'
    );

    expect(found).toEqual([]);
  });

  /**
   * Three children, and the only stylist who can take the third is also the
   * first name on the list for the other two. A greedy pass spends Sara on
   * Jonas, runs out at Emma and reports a full salon — while a seating that
   * works was there the whole time.
   */
  it('finds a seating that only exists if it undoes an earlier choice', () => {
    const found = findPartySlots(
      [JONAS, { service: GUTTEKLIPP }, EMMA],
      {
        [GUTTEKLIPP.id]: slots(
          ['res-sara', '15:00'],
          ['res-marcus', '15:00'],
          ['res-lina', '15:00']
        ),
        // Sara is the only one who cuts Jenteklipp.
        [JENTEKLIPP.id]: slots(['res-sara', '15:00']),
      },
      'parallel'
    );

    expect(found).toHaveLength(1);
    // Whoever the first two get, Emma must get Sara and no two children may
    // share a stylist.
    const stylists = stylistsOf(found[0]);
    expect(stylists[2]).toBe('res-sara');
    expect(new Set(stylists).size).toBe(3);
  });
});

describe('findPartySlots — what it will not build on', () => {
  /**
   * The wire type is nullable because `medal-client.ts` types every field the
   * way the serialiser emits it. A slot that arrived without a stylist cannot
   * be paired with a second one — there would be no way to tell two stylists
   * from one stylist promised twice — so it is not a party slot at all.
   */
  it('ignores a slot that does not say whose it is', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      {
        [GUTTEKLIPP.id]: slots([null, '15:00']),
        [JENTEKLIPP.id]: slots([null, '15:30']),
      },
      'sequential'
    );

    expect(found).toEqual([]);
  });

  it('finds nothing for a service the wizard has no availability for', () => {
    const found = findPartySlots(
      [JONAS, EMMA],
      { [GUTTEKLIPP.id]: slots(['res-sara', '15:00']) },
      'sequential'
    );

    expect(found).toEqual([]);
  });

  it('has nothing to seat when the basket is empty', () => {
    expect(
      findPartySlots([], { [GUTTEKLIPP.id]: slots(['res-sara', '15:00']) }, 'sequential')
    ).toEqual([]);
  });
});

describe('partyAlternative', () => {
  const parallelAt = (clock: string, day: 3 | 4 = 3): PartySlot => ({
    startTs: at(clock, day),
    mode: 'parallel',
    seats: [
      { startTs: at(clock, day), resourceId: 'res-marcus' },
      { startTs: at(clock, day), resourceId: 'res-sara' },
    ],
  });

  const sequentialAt = (clock: string, day: 3 | 4 = 3): PartySlot => ({
    startTs: at(clock, day),
    mode: 'sequential',
    seats: [
      { startTs: at(clock, day), resourceId: 'res-sara' },
      { startTs: at(clock, day) + 30 * 60_000, resourceId: 'res-sara' },
    ],
  });

  it('offers the earliest parallel slot on a day that has no sequential one', () => {
    const offered = partyAlternative({
      sequential: [],
      parallel: [parallelAt('16:00'), parallelAt('15:00')],
      dayTs: at('09:00'),
    });

    expect(offered?.startTs).toBe(at('15:00'));
    // The mode travels with it: accepting the offer has to seat the submission
    // side by side rather than back to back.
    expect(offered?.mode).toBe('parallel');
  });

  /** The fallback is a rescue from an empty day, not a second opinion. Shown
   * beside slots that do exist it would answer a question nobody asked. */
  it('says nothing when the day has sequential slots of its own', () => {
    expect(
      partyAlternative({
        sequential: [sequentialAt('17:00')],
        parallel: [parallelAt('15:00')],
        dayTs: at('09:00'),
      })
    ).toBeNull();
  });

  /**
   * Both halves are about THE day being looked at. A sequential slot on Friday
   * does not fill Thursday, and a parallel slot on Friday does not rescue it —
   * the sentence names a day («…rett etter hverandre torsdag…») and would be
   * false either way.
   */
  it('looks only at the day the visitor is standing on', () => {
    const fridayOnly = partyAlternative({
      sequential: [sequentialAt('15:00', 4)],
      parallel: [parallelAt('15:00')],
      dayTs: at('09:00'),
    });
    expect(fridayOnly?.startTs).toBe(at('15:00'));

    expect(
      partyAlternative({
        sequential: [],
        parallel: [parallelAt('15:00', 4)],
        dayTs: at('09:00'),
      })
    ).toBeNull();
  });
});

/**
 * «Neste ledige» on a family's stylist cards. The single-service answer is the
 * first minute a stylist can take ONE child; Bjarne's first Gutteklipp at 09:00
 * is no use to a family whose Jenteklipp he cannot take at 09:30.
 */
describe('firstPartyStartPerResource', () => {
  const basket = {
    [GUTTEKLIPP.id]: slots(
      ['res-bjarne', '09:00'],
      ['res-bjarne', '11:00'],
      ['res-sara', '10:00'],
      ['res-marcus', '09:00']
    ),
    [JENTEKLIPP.id]: slots(['res-bjarne', '11:30'], ['res-sara', '10:30'], ['res-sara', '09:30']),
  };

  it('gives each stylist the first minute the whole party fits them back to back', () => {
    expect(firstPartyStartPerResource([JONAS, EMMA], basket)).toEqual({
      // 09:00 is free for Jonas, but Emma is not free with him at 09:30.
      'res-bjarne': at('11:00'),
      'res-sara': at('10:00'),
    });
  });

  it('gives no entry to a stylist the party never fits in the window', () => {
    expect(firstPartyStartPerResource([JONAS, EMMA], basket)).not.toHaveProperty('res-marcus');
  });

  /** The card and the time step cannot disagree: the first party slot offered
   * once the stylist is picked IS the card’s time. */
  it('agrees with the time step’s own search narrowed to that stylist', () => {
    const times = firstPartyStartPerResource([JONAS, EMMA], basket);
    for (const [resourceId, ts] of Object.entries(times)) {
      const narrowed = Object.fromEntries(
        Object.entries(basket).map(([id, list]) => [
          id,
          list.filter((slot) => slot.resourceId === resourceId),
        ])
      );
      expect(findPartySlots([JONAS, EMMA], narrowed, 'sequential')[0]?.startTs).toBe(ts);
    }
  });

  it('matches the single-service answer for one child', () => {
    expect(firstPartyStartPerResource([JONAS], basket)).toEqual({
      'res-bjarne': at('09:00'),
      'res-sara': at('10:00'),
      'res-marcus': at('09:00'),
    });
  });

  it('answers nothing for an empty basket', () => {
    expect(firstPartyStartPerResource([], basket)).toEqual({});
  });
});

/**
 * One person, several services, one visit. The server answers a visit's
 * availability as ONE list — spans as long as the whole visit, on stylists who
 * do every part of it — and the wizard stores it under the visit's key. A
 * search that still read the first service's own list would offer a stylist who
 * can cut but not wash, at a minute where only the cut fits.
 */
describe('party seating — a person with several services', () => {
  const KLIPP: WizardService = { ...GUTTEKLIPP, id: 'svc-klipp', name: 'Klipp' };
  const VASK: WizardService = {
    ...GUTTEKLIPP,
    id: 'svc-vask',
    name: 'Vask',
    durationMinutes: 15,
    bufferAfterMinutes: 5,
  };
  const SKJEGG: WizardService = {
    ...GUTTEKLIPP,
    id: 'svc-skjegg',
    name: 'Skjegg',
    bufferBeforeMinutes: 10,
  };
  const KLIPP_VASK: WizardItem = { service: KLIPP, extraServices: [VASK] };
  const VISIT = `${KLIPP.id}+${VASK.id}`;

  it('reads the visit’s own slots, not its first service’s', () => {
    const found = findPartySlots(
      [KLIPP_VASK],
      {
        [KLIPP.id]: slots(['res-marcus', '10:00']),
        [VISIT]: slots(['res-sara', '15:00']),
      },
      'sequential'
    );
    expect(found.map((slot) => slot.startTs)).toEqual([at('15:00')]);
    expect(stylistsOf(found[0])).toEqual(['res-sara']);
  });

  it('finds nothing when only the first service’s slots are stored', () => {
    expect(
      findPartySlots([KLIPP_VASK], { [KLIPP.id]: slots(['res-sara', '15:00']) }, 'sequential')
    ).toEqual([]);
  });

  /** 30 + 15 of visit, Vask's 5 of cleanup, Skjegg's 10 of prep: 60 minutes on. */
  it('seats the next person after the whole visit and its buffers', () => {
    const found = findPartySlots(
      [KLIPP_VASK, { service: SKJEGG }],
      {
        [VISIT]: slots(['res-sara', '15:00']),
        [SKJEGG.id]: slots(['res-sara', '15:45'], ['res-sara', '16:00']),
      },
      'sequential'
    );
    expect(found).toHaveLength(1);
    expect(seatingOf(found[0])).toEqual(['15:00', '16:00']);
    expect(stylistsOf(found[0])).toEqual(['res-sara', 'res-sara']);
  });

  it('seats a visit in parallel from that visit’s slots', () => {
    const found = findPartySlots(
      [{ service: SKJEGG }, KLIPP_VASK],
      {
        [SKJEGG.id]: slots(['res-sara', '15:00'], ['res-marcus', '15:00']),
        // Marcus can cut at 15:00 but not cut AND wash: only the visit's list knows.
        [KLIPP.id]: slots(['res-marcus', '15:00']),
        [VISIT]: slots(['res-sara', '15:00']),
      },
      'parallel'
    );
    expect(found).toHaveLength(1);
    expect(stylistsOf(found[0])).toEqual(['res-marcus', 'res-sara']);
  });

  it('gives each stylist their first start for a basket holding a visit', () => {
    expect(
      firstPartyStartPerResource([KLIPP_VASK, { service: SKJEGG }], {
        [VISIT]: slots(['res-sara', '15:00'], ['res-bjarne', '09:00']),
        [SKJEGG.id]: slots(['res-sara', '16:00'], ['res-bjarne', '09:45']),
      })
    ).toEqual({ 'res-sara': at('15:00') });
  });

  it('lists each distinct visit key once, in basket order', () => {
    expect(slotKeysFor([KLIPP_VASK, { service: SKJEGG }, KLIPP_VASK, { service: KLIPP }])).toEqual([
      VISIT,
      SKJEGG.id,
      KLIPP.id,
    ]);
    expect(slotKeysFor([])).toEqual([]);
  });
});
