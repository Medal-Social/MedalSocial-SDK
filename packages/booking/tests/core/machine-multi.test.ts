import { describe, expect, it } from 'vitest';
import {
  createWizard,
  type WizardPerson,
  type WizardService,
  type WizardState,
} from '../../src/core/machine';
import { PARITY_CONFIG } from '../support/parity-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

/**
 * Several services for ONE person, booked as one visit — and the party rule
 * that came with it: each service's `maxPerBooking` caps how many PEOPLE take
 * that service, rather than the strictest service capping the whole party.
 */

const wizard = createWizard(PARITY_CONFIG);
const {
  canAdvance,
  initialState,
  itemStartTimes,
  reduce,
  summaryLine,
  totalPriceOre,
  visitEndTs,
  visitItemPriceOre,
  visitMinutes,
} = wizard;

pinAForeignViewerClock();

const KLIPP: WizardService = {
  id: 'svc-klipp',
  name: 'Klipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 40_000,
  maxPerBooking: 3,
  weekendSurchargePct: 0,
};
const VASK: WizardService = {
  ...KLIPP,
  id: 'svc-vask',
  name: 'Vask',
  durationMinutes: 15,
  priceOre: 10_000,
  weekendSurchargePct: 20,
};
/** A grown-up's service the salon takes one at a time. */
const SKJEGG: WizardService = {
  ...KLIPP,
  id: 'svc-skjegg',
  name: 'Skjegg',
  category: 'herre',
  durationMinutes: 20,
  priceOre: 30_000,
  maxPerBooking: 1,
};
const FARGE: WizardService = {
  ...KLIPP,
  id: 'svc-farge',
  name: 'Farge',
  category: 'farge',
  durationMinutes: 60,
  priceOre: 90_000,
};

const ADULT: WizardPerson = { key: 'self', adult: true };
const KID_1: WizardPerson = { key: 'guest:1' };
const KID_2: WizardPerson = { key: 'guest:2' };

/** 15:00 Oslo on a Thursday and on the Saturday after it. */
const THURSDAY_15 = Date.UTC(2026, 8, 3, 13);
const SATURDAY_15 = Date.UTC(2026, 8, 5, 13);

function seated(people: WizardPerson[]): WizardState {
  return reduce(initialState(), { type: 'choosePeople', people, advance: true });
}

function toggle(
  state: WizardState,
  index: number,
  service: WizardService,
  resourceServiceIds?: readonly string[]
): WizardState {
  return reduce(state, { type: 'toggleServiceFor', index, service, resourceServiceIds });
}

/** One person on Klipp + Vask, still on step 2. */
function klippOgVask(): WizardState {
  return toggle(toggle(seated([KID_1]), 0, KLIPP), 0, VASK);
}

describe('a state from before extras existed', () => {
  /** meda types `extras` optional, and a shell may hold a state saved before 0.3. */
  function withoutExtras(state: WizardState): WizardState {
    const { extras: _dropped, ...rest } = state;
    return rest as WizardState;
  }

  it('takes taps, toggles and a re-seating without throwing', () => {
    let state = withoutExtras(
      reduce(initialState(), { type: 'choosePeople', people: [ADULT, KID_1] })
    );
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: SKJEGG });
    state = withoutExtras(state);
    state = reduce(state, { type: 'toggleServiceFor', index: 1, service: KLIPP });
    state = withoutExtras(state);
    state = reduce(state, { type: 'choosePeople', people: [KID_1, ADULT] });
    expect(state.items.map((item) => item.service.id)).toEqual([KLIPP.id, SKJEGG.id]);
    expect(state.items.every((item) => item.extraServices === undefined)).toBe(true);
  });
});

describe('toggleServiceFor', () => {
  it('starts with no extras', () => {
    expect(initialState().extras).toEqual([]);
  });

  it('adds a second service as an extra, without moving and without the slot', () => {
    let state = toggle(seated([KID_1]), 0, KLIPP);
    expect(state.step).toBe('service');
    expect(state.items).toEqual([{ service: KLIPP }]);
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });
    state = reduce(state, { type: 'goToStep', step: 'service' });
    expect(state.startTs).toBe(THURSDAY_15);

    const next = toggle(state, 0, VASK);

    expect(next.items[0]?.service).toBe(KLIPP);
    expect(next.items[0]?.extraServices).toEqual([VASK]);
    expect(next.choices).toEqual([KLIPP]);
    expect(next.extras).toEqual([[VASK]]);
    expect(next.step).toBe('service');
    expect(next.startTs).toBeNull();
    expect(next.resolvedResourceId).toBeNull();
    expect(next.error).toBeNull();
  });

  it('seats a guest child when nobody is seated yet, the way pickServiceFor does', () => {
    const next = toggle(initialState(), 0, KLIPP);
    expect(next.people).toEqual([{ key: 'guest:1' }]);
    expect(next.items).toEqual([{ service: KLIPP }]);
    expect(next.step).toBe('who');
  });

  it('ignores a person who is not there', () => {
    const state = seated([KID_1]);
    expect(toggle(state, 3, KLIPP)).toBe(state);
  });

  it('clears the slot on the way off and on the way back on', () => {
    const withSlot = (state: WizardState) =>
      reduce(reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' }), {
        type: 'goToStep',
        step: 'service',
      });

    const off = toggle(withSlot(klippOgVask()), 0, VASK);
    expect(off.startTs).toBeNull();
    const backOn = toggle(off, 0, VASK);
    expect(backOn.items).toEqual([{ service: KLIPP, extraServices: [VASK] }]);
    expect(backOn.startTs).toBeNull();

    // A slot chosen for the shorter visit is not one for the longer one.
    const reOn = toggle(withSlot(off), 0, VASK);
    expect(reOn.startTs).toBeNull();
    expect(reOn.partyResourceIds).toBeNull();
  });

  it('removes an extra', () => {
    const next = toggle(klippOgVask(), 0, VASK);
    expect(next.items).toEqual([{ service: KLIPP }]);
    expect(next.extras).toEqual([[]]);
    expect('extraServices' in (next.items[0] ?? {})).toBe(false);
  });

  it('promotes the extra when the first service is removed', () => {
    const next = toggle(klippOgVask(), 0, KLIPP);
    expect(next.items).toEqual([{ service: VASK }]);
    expect(next.choices).toEqual([VASK]);
    expect(next.extras).toEqual([[]]);
  });

  it('leaves the person unanswered when the only service is removed', () => {
    const next = toggle(toggle(seated([KID_1]), 0, KLIPP), 0, KLIPP);
    expect(next.items).toEqual([]);
    expect(next.choices).toEqual([null]);
    expect(next.step).toBe('service');
    expect(canAdvance(next)).toBe(false);
  });

  it('refuses a service past maxServicesPerPerson and changes nothing else', () => {
    const two = createWizard({
      ...PARITY_CONFIG,
      party: { ...PARITY_CONFIG.party, maxServicesPerPerson: 2 },
    });
    let state = two.reduce(initialState(), { type: 'choosePeople', people: [KID_1] });
    state = two.reduce(state, { type: 'toggleServiceFor', index: 0, service: KLIPP });
    state = two.reduce(state, { type: 'toggleServiceFor', index: 0, service: VASK });

    const refused = two.reduce(state, { type: 'toggleServiceFor', index: 0, service: FARGE });

    expect(refused).toEqual({ ...state, error: 'maxServices' });
  });

  it('lets a grown-up’s one-at-a-time service ride along with two children', () => {
    let state = seated([ADULT, KID_1, KID_2]);
    state = toggle(state, 0, SKJEGG);
    state = toggle(state, 1, KLIPP);
    state = toggle(state, 2, KLIPP);

    expect(state.error).toBeNull();
    expect(state.items.map((item) => item.service.id)).toEqual([SKJEGG.id, KLIPP.id, KLIPP.id]);
  });

  it('refuses a second person on a one-at-a-time service', () => {
    let state = seated([ADULT, KID_1]);
    state = toggle(state, 0, SKJEGG);

    const refused = toggle(state, 1, SKJEGG);

    expect(refused).toEqual({ ...state, error: 'maxParty' });
  });

  it('releases a named stylist who cannot do the new list', () => {
    let state = toggle(seated([KID_1]), 0, KLIPP);
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
    expect(state.stylistAnswered).toBe(true);

    const kept = toggle(state, 0, VASK, [KLIPP.id, VASK.id]);
    expect(kept.resourceId).toBe('res-1');

    const released = toggle(state, 0, VASK, [KLIPP.id]);
    expect(released.resourceId).toBeNull();
    expect(released.stylistAnswered).toBe(false);
  });
});

describe('the per-service party rule on the one-tap actions', () => {
  it('pickServiceFor no longer refuses a one-at-a-time service nobody else takes', () => {
    let state = seated([ADULT, KID_1, KID_2]);
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: SKJEGG });
    state = reduce(state, { type: 'pickServiceFor', index: 1, service: KLIPP });
    state = reduce(state, { type: 'pickServiceFor', index: 2, service: KLIPP });

    expect(state.error).toBeNull();
    expect(state.items).toHaveLength(3);
  });

  it('pickServiceFor still refuses a second person on it', () => {
    let state = seated([ADULT, KID_1]);
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: SKJEGG });

    const refused = reduce(state, { type: 'pickServiceFor', index: 1, service: SKJEGG });

    expect(refused).toEqual({ ...state, error: 'maxParty' });
  });

  it('addService lets a different one-at-a-time service join, and refuses the same one twice', () => {
    let state = reduce(initialState(), { type: 'pickService', service: KLIPP });
    state = reduce(state, { type: 'addService', service: SKJEGG });
    expect(state.items).toHaveLength(2);
    expect(state.error).toBeNull();

    const refused = reduce(state, { type: 'addService', service: SKJEGG });
    expect(refused).toEqual({ ...state, error: 'maxParty' });
  });
});

describe('one-tap compatibility', () => {
  it('pickService after toggles replaces everything and moves on', () => {
    const next = reduce(klippOgVask(), { type: 'pickService', service: FARGE });
    expect(next.items).toEqual([{ service: FARGE }]);
    expect(next.extras).toEqual([[]]);
    expect(next.step).toBe('when');
  });

  it('pickServiceFor in a family replaces that person’s list with just the service', () => {
    let state = seated([KID_1, KID_2]);
    state = toggle(toggle(state, 0, KLIPP), 0, VASK);
    state = toggle(state, 1, KLIPP);

    const next = reduce(state, { type: 'pickServiceFor', index: 0, service: FARGE });

    expect(next.items[0]).toEqual({ service: FARGE });
    expect(next.extras).toEqual([[], []]);
    expect(next.step).toBe('service');
  });

  it('carries a person’s extras with them when step 1 changes', () => {
    let state = seated([KID_1, KID_2]);
    state = toggle(state, 0, KLIPP);
    state = toggle(toggle(state, 1, FARGE), 1, VASK);

    const next = reduce(state, { type: 'choosePeople', people: [KID_2] });

    expect(next.people).toEqual([KID_2]);
    expect(next.extras).toEqual([[VASK]]);
    expect(next.items).toEqual([{ service: FARGE, extraServices: [VASK] }]);
  });

  it('carries extras by key when step 1 reorders the party', () => {
    let state = seated([KID_1, KID_2]);
    state = toggle(toggle(state, 0, KLIPP), 0, VASK);
    state = toggle(state, 1, FARGE);

    const next = reduce(state, { type: 'choosePeople', people: [KID_2, KID_1] });

    expect(next.extras).toEqual([[], [VASK]]);
    expect(next.items).toEqual([{ service: FARGE }, { service: KLIPP, extraServices: [VASK] }]);
  });

  it('keeps extras aligned when the family takes over the guest seats', () => {
    const child: WizardPerson = { key: 'p:p-1', personId: 'p-1', name: 'Kari' };
    let state = seated([{ key: 'adult', adult: true }, KID_1, child]);
    state = toggle(toggle(state, 0, SKJEGG), 0, KLIPP);
    state = toggle(state, 1, KLIPP);
    state = toggle(toggle(state, 2, FARGE), 2, VASK);

    const next = reduce(state, { type: 'seatFamily' });

    expect(next.people.map((person) => person.key)).toEqual(['self', 'p:p-1']);
    expect(next.choices).toEqual([SKJEGG, FARGE]);
    expect(next.extras).toEqual([[KLIPP], [VASK]]);
    expect(next.items.map((item) => item.extraServices)).toEqual([[KLIPP], [VASK]]);
  });

  it('starts a person added to the party with no extras', () => {
    const state = toggle(toggle(seated([KID_1]), 0, KLIPP), 0, VASK);
    const next = reduce(state, { type: 'addPerson', person: KID_2 });
    expect(next.extras).toEqual([[VASK], []]);
  });

  it('startOver forgets every extra', () => {
    expect(reduce(klippOgVask(), { type: 'startOver' }).extras).toEqual([]);
  });
});

describe('timing a visit of several services', () => {
  const VASK_CLEANUP: WizardService = { ...VASK, bufferAfterMinutes: 5 };
  const SKJEGG_PREP: WizardService = { ...SKJEGG, durationMinutes: 30, bufferBeforeMinutes: 5 };

  it('one person on Klipp + Vask is in the chair for both', () => {
    const items = klippOgVask().items;
    expect(visitMinutes(items, 'sequential')).toBe(45);
    expect(visitEndTs(items, THURSDAY_15, 'sequential')).toBe(THURSDAY_15 + 45 * 60_000);
  });

  it('seats the next person after the whole visit and its buffers', () => {
    const items = [{ service: KLIPP, extraServices: [VASK_CLEANUP] }, { service: SKJEGG_PREP }];
    expect(itemStartTimes(items, THURSDAY_15, 'sequential')).toEqual([
      THURSDAY_15,
      THURSDAY_15 + 55 * 60_000,
    ]);
    expect(visitMinutes(items, 'sequential')).toBe(45 + 5 + 5 + 30);
  });

  it('a parallel party is as long as its longest visit', () => {
    const items = [{ service: KLIPP, extraServices: [VASK] }, { service: SKJEGG }];
    expect(visitMinutes(items, 'parallel')).toBe(45);
    expect(itemStartTimes(items, THURSDAY_15, 'parallel')).toEqual([THURSDAY_15, THURSDAY_15]);
  });

  it('counts the whole visit in the tail a family adds', () => {
    const items = [{ service: SKJEGG }, { service: KLIPP, extraServices: [VASK_CLEANUP] }];
    expect(wizard.visitTailMinutes(items, 'sequential')).toBe(45 + 5);
  });
});

describe('pricing a visit of several services', () => {
  it('sums every service in the total', () => {
    expect(totalPriceOre(klippOgVask().items, THURSDAY_15)).toBe(50_000);
  });

  it('applies each service’s own weekend surcharge', () => {
    const [item] = klippOgVask().items;
    if (item === undefined) throw new Error('no item');
    // Klipp has none, Vask 20 %.
    expect(visitItemPriceOre(item, SATURDAY_15)).toBe(40_000 + 12_000);
    expect(visitItemPriceOre(item, THURSDAY_15)).toBe(50_000);
    expect(totalPriceOre([item], SATURDAY_15)).toBe(52_000);
  });
});

describe('the summary line for one person with several services', () => {
  it('names both services', () => {
    expect(summaryLine(klippOgVask(), () => null, THURSDAY_15)).toContain('Klipp + Vask');
  });
});

describe('a family link at a site that seats fewer than the service allows', () => {
  it('stops at the party ceiling, without an error', () => {
    const two = createWizard({ ...PARITY_CONFIG, party: { ...PARITY_CONFIG.party, maxPeople: 2 } });
    const state = two.applyPrefill(
      two.initialState(),
      { serviceId: KLIPP.id, party: 3 },
      { services: [KLIPP], resources: [] }
    );
    // Klipp takes three; the site seats two.
    expect(KLIPP.maxPerBooking).toBe(3);
    expect(state.items).toHaveLength(2);
    expect(state.error).toBeNull();
  });
});
