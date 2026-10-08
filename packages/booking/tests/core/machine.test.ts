import { describe, expect, it } from 'vitest';
import {
  BOOKED_FOR_NAME_MAX_LENGTH,
  createWizard,
  type WizardCatalogue,
  type WizardService,
  type WizardState,
} from '../../src/core/machine';
import { PARITY_CONFIG } from '../support/parity-config';
import { pinAForeignViewerClock } from '../support/viewer-clock';

const {
  applyPrefill,
  canAdvance,
  canGoToStep,
  guestChild,
  initialState,
  isGuestSeat,
  itemPriceOre,
  itemResourceIds,
  itemStartTimes,
  maxPeople: MAX_PEOPLE,
  reduce,
  showsPartyMode,
  summaryLine,
  totalPriceOre,
  visitEndTs,
  visitMinutes,
  visitTailMinutes,
} = createWizard(PARITY_CONFIG);

/**
 * «13:00Z is 15:00 in Oslo» only pins the salon's clock on a machine that is
 * not already in it — and this one is. Without the foreign viewer clock below,
 * `summaryLine` reading `new Date(startTs).toTimeString()` passes every
 * assertion in this file and fails in the hand of a parent booking from Spain.
 */
pinAForeignViewerClock();

/**
 * `maxPerBooking: 3` because that is what the salon actually has: the engine
 * seeds `MAX_PER_BOOKING_BY_CATEGORY = { barn: 3 }`. A fixture carrying a
 * roomier number than production would let the wizard agree with itself about a
 * party size the engine then rejects at submit.
 */
const GUTTEKLIPP: WizardService = {
  id: 'svc-1',
  name: 'Gutteklipp',
  category: 'barn',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 49_000,
  maxPerBooking: 3,
  weekendSurchargePct: 10,
};

/** Emma's half of the report's J2: a second `barn` service, same length and
 * same price, so «2 tjenester · 60 min totalt · 980 kr» is the salon's real
 * arithmetic rather than a fixture arranged to produce it. */
const JENTEKLIPP: WizardService = { ...GUTTEKLIPP, id: 'svc-2b', name: 'Jenteklipp' };

/**
 * A longer kids' service, for the difference between the two modes: a parallel
 * visit is over when the LONGEST cut is, not when the first one is and not when
 * the sum of them would be.
 *
 * `maxPerBooking: 3` like its siblings, because the seed gives that number to
 * the whole `barn` category rather than to the two cuts by name — so a longer
 * children's service is something the salon can add tomorrow, not a fixture
 * bent to make a party of three legal.
 */
const BARNEKLIPP_MED_VASK: WizardService = {
  ...GUTTEKLIPP,
  id: 'svc-2c',
  name: 'Barneklipp med vask',
  durationMinutes: 45,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 59_000,
};

/** The strict counterpart. Everything outside `barn` seeds to the engine's
 * `DEFAULT_MAX_PER_BOOKING = 1`, so a one-at-a-time service is the ordinary case
 * and not a contrived one — and it is the only fixture that can prove the limit
 * is read from the service rather than from a constant in the machine. */
const DAMEKLIPP: WizardService = {
  id: 'svc-2',
  name: 'Dameklipp',
  category: 'voksen',
  durationMinutes: 45,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceOre: 69_000,
  maxPerBooking: 1,
  weekendSurchargePct: 10,
};

/**
 * The stylist catalogue step 2 rendered, as the lookup the bar is handed.
 *
 * `null` for an id it does not know is the case that matters: the machine holds
 * ids that outlive a catalogue reload, and the bar has to survive one without
 * printing `res-1` at the visitor.
 */
const STYLISTS: Record<string, string> = { 'res-1': 'Sara', 'res-2': 'Nadia' };
const stylistName = (resourceId: string) => STYLISTS[resourceId] ?? null;

/** 10:00 Oslo on Thursday 3 September 2026 — the same salon day as the slots
 * below, which is what makes «i dag» the right answer rather than a coincidence
 * of the day the suite happens to run. */
const NOW = Date.UTC(2026, 8, 3, 8);
/** 15:00 Oslo, same day. */
const THURSDAY_15 = Date.UTC(2026, 8, 3, 13);
/** 15:00 Oslo on the Saturday, which is the surcharged one. */
const SATURDAY_15 = Date.UTC(2026, 8, 5, 13);

/** A party of three with a slot, a stylist preference and a filled-in form —
 * i.e. everything a refusal or a reset could plausibly damage. */
function fullState(): WizardState {
  let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
  state = reduce(state, { type: 'addService', service: GUTTEKLIPP });
  state = reduce(state, { type: 'addService', service: GUTTEKLIPP });
  state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
  state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-2' });
  // `pickSlot` lands on step 3 — «Bekreft» — and «fully answered» means
  // standing there with the form filled in.
  state = reduce(state, { type: 'setContact', field: 'phone', value: '40000000' });
  state = reduce(state, { type: 'setConsent', which: 'terms', accepted: true });
  return state;
}

describe('wizard machine', () => {
  it('starts on «Hvem skal klippes?» with nothing chosen', () => {
    expect(initialState().step).toBe('who');
    expect(initialState().people).toEqual([]);
    expect(canAdvance(initialState())).toBe(false);
  });

  it('advances automatically when a service is picked — one tap, not two', () => {
    const next = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    expect(next.step).toBe('when');
    expect(next.items).toHaveLength(1);
  });

  // The plan's own test starts from an empty basket, where appending and
  // replacing produce the same single item and so cannot tell them apart. The
  // second pick is the one that distinguishes them, and getting it wrong books
  // the service the visitor changed their mind about alongside the one they chose.
  it('replaces the basket on a second pick rather than appending to it', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickService', service: DAMEKLIPP });
    expect(state.items.map((item) => item.service.id)).toEqual(['svc-2']);
  });

  it('refuses a fourth child — maxPerBooking is the salon rule, not a UI whim', () => {
    let state = initialState();
    for (let i = 0; i < 3; i += 1) {
      state = reduce(state, { type: 'addService', service: GUTTEKLIPP });
    }
    const fourth = reduce(state, { type: 'addService', service: GUTTEKLIPP });
    expect(fourth.items).toHaveLength(3);
    expect(fourth.error).toBe('maxParty');
  });

  // The engine's party rule is per service: `maxPerBooking` caps how many
  // PEOPLE take that service, not the whole party. So a one-at-a-time service
  // rides along with a child's cut in either order — the old strictest-service
  // rule refused both — and only a second person on it is refused, whether the
  // basket or the incoming child is the one that would break the cap.
  it('caps each service by the people taking it, not the party by the strictest', () => {
    const alongside = reduce(reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP }), {
      type: 'addService',
      service: DAMEKLIPP,
    });
    expect(alongside.items).toHaveLength(2);
    expect(alongside.error).toBeNull();

    const strictInBasket = reduce(
      reduce(initialState(), { type: 'pickService', service: DAMEKLIPP }),
      { type: 'addService', service: GUTTEKLIPP }
    );
    expect(strictInBasket.items).toHaveLength(2);
    expect(strictInBasket.error).toBeNull();

    const twice = reduce(strictInBasket, { type: 'addService', service: DAMEKLIPP });
    expect(twice.items).toHaveLength(2);
    expect(twice.error).toBe('maxParty');
  });

  // Length and error alone would also pass for a refusal that reset the step or
  // wiped the contact details on its way out. Whole-state equality is what makes
  // "changes nothing else" mean it.
  it('changes nothing but the error when it refuses', () => {
    const state = fullState();
    const refused = reduce(state, { type: 'addService', service: GUTTEKLIPP });
    expect(refused).toEqual({ ...state, error: 'maxParty' });
  });

  /**
   * A named stylist has to cover EVERY service in the basket — `StylistStep`
   * only offers people who do — so the second child can take the first child's
   * stylist out of reach. Left standing, the preference filters step 3's
   * availability to somebody who cannot take the visit at all: «Fullt» on every
   * day of the week, at a salon with a free chair.
   *
   * The machine cannot look that up — the catalogue is a fetch result the shell
   * holds — so the fact arrives on the action.
   */
  describe('a stylist the added child puts out of reach', () => {
    /** Step 1, step 2, and a parent who asked for res-1 by name. */
    function withNamedStylist(): WizardState {
      return reduce(reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP }), {
        type: 'pickResource',
        resourceId: 'res-1',
      });
    }

    it('drops the preference when the stylist cannot do the added service', () => {
      const added = reduce(withNamedStylist(), {
        type: 'addService',
        service: JENTEKLIPP,
        resourceServiceIds: [GUTTEKLIPP.id],
      });

      expect(added.items).toHaveLength(2);
      // `null` is «Første ledige» — the default, and the answer step 2 will now
      // render as selected instead of showing nothing chosen at all.
      expect(added.resourceId).toBeNull();
    });

    it('keeps the preference when the stylist does both', () => {
      const added = reduce(withNamedStylist(), {
        type: 'addService',
        service: JENTEKLIPP,
        resourceServiceIds: [GUTTEKLIPP.id, JENTEKLIPP.id],
      });

      // A parent adding a sibling has not changed their mind about Sara, and
      // re-asking every family that could have kept her is the cost of getting
      // this wrong in the other direction.
      expect(added.resourceId).toBe('res-1');
    });

    it('keeps the preference when the caller cannot say what the stylist does', () => {
      // The catalogue has not loaded, or the caller is not the wizard. Silence
      // is not evidence that the stylist is unqualified.
      const added = reduce(withNamedStylist(), { type: 'addService', service: JENTEKLIPP });

      expect(added.resourceId).toBe('res-1');
    });

    it('leaves a refused child alone, preference included', () => {
      // `maxParty` changes nothing but the error, and that has to keep holding
      // for the argument that clears the preference: a child who is not coming
      // cannot take anybody out of reach. A second person on the one-at-a-time
      // service is what the per-service rule refuses.
      const state = reduce(reduce(initialState(), { type: 'pickService', service: DAMEKLIPP }), {
        type: 'pickResource',
        resourceId: 'res-1',
      });
      const refused = reduce(state, {
        type: 'addService',
        service: DAMEKLIPP,
        resourceServiceIds: [GUTTEKLIPP.id],
      });

      expect(refused).toEqual({ ...state, error: 'maxParty' });
    });
  });

  it('records the stylist preference and keeps the visitor on the when step', () => {
    const picked = reduce(reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP }), {
      type: 'pickResource',
      resourceId: 'res-1',
    });
    expect(picked.step).toBe('when');
    expect(picked.resourceId).toBe('res-1');

    // «Første ledige» is a choice, not an absence, so it has to survive the same
    // way a named stylist does — a `null` that got coalesced back to a default
    // would be indistinguishable here and wrong at submit.
    const first = reduce(picked, { type: 'pickResource', resourceId: null });
    expect(first.resourceId).toBeNull();
    expect(first.step).toBe('when');
  });

  it('cannot leave the when step until an hour has been chosen', () => {
    // The stylist and the hour are one screen now, so «Første ledige» alone is
    // no longer a way forward: what settles the step is the instant.
    const when = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    expect(when.step).toBe('when');
    expect(canAdvance(when)).toBe(false);

    const anyStylist = reduce(when, { type: 'pickResource', resourceId: null });
    expect(anyStylist.step).toBe('when');
    expect(canAdvance(anyStylist)).toBe(false);

    // Back onto `when` the way a visitor gets there a second time — tapping the
    // segment to change their mind about the hour — rather than by hand, since
    // `pickSlot` moves them straight on to `details` and `canAdvance` would then
    // be answering about the form instead of the slot.
    const chosen = reduce(anyStylist, { type: 'pickSlot', startTs: 1, resourceId: null });
    expect(chosen.step).toBe('details');
    const backOnWhen = reduce(chosen, { type: 'goToStep', step: 'when' });
    expect(backOnWhen.step).toBe('when');
    expect(canAdvance(backOnWhen)).toBe(true);
  });

  // The only backward transition in the machine, and the one that has to leave
  // the visitor somewhere they can act: a slot taken out from under them is a
  // race with another customer, not a dead end.
  it('sends a taken slot back to the when step with the preference intact', () => {
    const state = fullState();
    const taken = reduce(state, { type: 'slotTaken' });
    expect(taken.step).toBe('when');
    expect(taken.error).toBe('slotTaken');
    // The resolved stylist belonged to the slot that vanished; the *preference*
    // is what re-queries availability, so losing it would drop the visitor back
    // onto an unfiltered list they never asked for.
    expect(taken.resolvedResourceId).toBeNull();
    expect(taken.startTs).toBeNull();
    expect(taken.resourceId).toBe('res-1');
    expect(taken.items).toHaveLength(3);
    expect(taken.contact.phone).toBe('40000000');
  });

  /**
   * A stylist preference belongs to the basket it was given for.
   *
   * Step 2 only offers stylists who can do EVERY service in the basket, so a
   * preference kept across a replacement can name somebody the new list does not
   * contain — the card is gone from the screen, nothing reads as selected, and
   * «Neste» is enabled anyway, because `isSatisfied` treats any answer as an
   * answer. The visitor then lands on step 3 with availability filtered to a
   * stylist who cannot do this service, and a salon that is open shows «Ingenting
   * ledig» on every day of the week.
   */
  it('re-asks who, when the basket is replaced rather than added to', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });

    const swapped = reduce(state, { type: 'pickService', service: DAMEKLIPP });
    expect(swapped.resourceId).toBeNull();
    expect(swapped.step).toBe('when');
  });

  it('does not re-ask who, when a sibling joins the visit', () => {
    // The other half of the same rule, and the reason it cannot simply live in
    // `clearedSlot`: a parent adding a second child has not changed their mind
    // about the stylist, and asking again every time is the worse form.
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });

    const party = reduce(state, { type: 'addService', service: GUTTEKLIPP });
    expect(party.resourceId).toBe('res-1');
  });

  /**
   * A slot belongs to the stylist it was chosen from — the same rule
   * `pickService` already enforces for the basket.
   *
   * `isSatisfied('when')` asks only whether `startTs` is non-null, so a slot
   * that survived a change of stylist made `details` reachable again with an
   * instant nobody ever offered for the new one. The visitor could go back,
   * choose Marcus, jump forward on the dots and submit Sara's 13:00 against
   * Marcus — somebody they did not choose, at a time they were never shown for
   * them.
   */
  it('drops the slot when the visitor changes their mind about the stylist', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });
    expect(canGoToStep(state, 'details')).toBe(true);

    const swapped = reduce(state, { type: 'pickResource', resourceId: 'res-2' });
    expect(swapped.resourceId).toBe('res-2');
    expect(swapped.startTs).toBeNull();
    expect(swapped.resolvedResourceId).toBeNull();
    // The half that makes it a wrong booking rather than an untidy state: the
    // dots are drawn from this, so a surviving slot is a tappable way forward.
    expect(canGoToStep(swapped, 'details')).toBe(false);
    expect(swapped.step).toBe('when');
  });

  /**
   * The other half of the same rule, and the one that keeps it from being a
   * trapdoor: re-tapping the card already highlighted is not a change of mind.
   *
   * Step 2 shows the current preference as selected when a visitor comes back
   * to it, so tapping it is the obvious way forward — and the slot was chosen
   * under this very preference, so it is still a time the salon offered them.
   */
  it('keeps the slot when the visitor re-affirms the stylist they already chose', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });

    const again = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
    expect(again.startTs).toBe(THURSDAY_15);
    expect(again.resolvedResourceId).toBe('res-1');
    expect(again.step).toBe('when');

    // «Første ledige» is an answer like any other, so re-affirming a null
    // preference has to behave the same way a named one does.
    let first = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    first = reduce(first, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-2' });
    expect(reduce(first, { type: 'pickResource', resourceId: null }).startTs).toBe(THURSDAY_15);
  });

  /** The same for a family, where the slot also carries a seating chart — one
   * left behind would submit two children to a stylist chosen for neither. */
  it('drops a family’s seating chart too when the stylist changes', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'addService', service: JENTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
    state = reduce(state, {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-1', 'res-1'],
      mode: 'sequential',
    });
    expect(state.partyResourceIds).toEqual(['res-1', 'res-1']);

    const swapped = reduce(state, { type: 'pickResource', resourceId: 'res-2' });
    expect(swapped.partyResourceIds).toBeNull();
    expect(swapped.startTs).toBeNull();
    expect(canGoToStep(swapped, 'details')).toBe(false);
  });

  /**
   * The other four codes the error union always admitted, and which no action
   * could produce until this one.
   *
   * The step must not move. Every one of them is either the visitor's to fix in
   * the form or ours to fix upstream, and leaving `details` would throw away the
   * slot they chose for a failure that is not about the slot.
   */
  it('raises a refused submission without disturbing anything the visitor answered', () => {
    const state = fullState();
    const failed = reduce(state, { type: 'submitFailed', error: 'upstreamError' });

    expect(failed.error).toBe('upstreamError');
    expect(failed.step).toBe('details');
    expect(failed.startTs).toBe(state.startTs);
    expect(failed.resolvedResourceId).toBe('res-2');
    expect(failed.contact.phone).toBe('40000000');
    expect(failed.consentTerms).toBe(true);
  });

  it('clears a refused submission the moment the visitor touches anything', () => {
    // The same rule every other action follows, and the reason the failure lives
    // in the machine rather than beside it: a sentence about a submit that is no
    // longer the one on screen is worse than no sentence at all.
    const failed = reduce(fullState(), { type: 'submitFailed', error: 'invalidInput' });
    expect(reduce(failed, { type: 'setContact', field: 'name', value: 'Kari' }).error).toBeNull();
  });

  // Invisible until the progress dots become tappable, and a real booking bug
  // the moment they are: a slot chosen for a 30-minute Gutteklipp is not a slot
  // for a 45-minute Dameklipp, and nothing else in the state says so.
  it('drops a chosen slot whenever the basket changes under it', () => {
    const swapped = reduce(fullState(), { type: 'pickService', service: DAMEKLIPP });
    expect(swapped.startTs).toBeNull();
    expect(swapped.resolvedResourceId).toBeNull();
    expect(canGoToStep(swapped, 'details')).toBe(false);

    // Adding a sibling doubles the duration being asked for, so it invalidates
    // the slot just as surely as swapping the service does.
    let added = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    added = reduce(added, { type: 'pickSlot', startTs: 1, resourceId: 'res-1' });
    added = reduce(added, { type: 'addService', service: GUTTEKLIPP });
    expect(added.startTs).toBeNull();
    expect(added.resolvedResourceId).toBeNull();
  });

  it('lets the visitor jump back freely but not skip ahead of what they have answered', () => {
    const fresh = initialState();
    // Backwards is always open — nothing precedes the first step — which is the
    // case the dots exist for.
    expect(canGoToStep(fresh, 'who')).toBe(true);
    // Step 2 needs step 1's answer.
    expect(canGoToStep(fresh, 'service')).toBe(false);
    expect(canGoToStep(fresh, 'when')).toBe(false);
    expect(canGoToStep(fresh, 'details')).toBe(false);
    // A refused jump is the caller's bug, not the visitor's, so it leaves the
    // state alone rather than raising copy nobody would show.
    expect(reduce(fresh, { type: 'goToStep', step: 'details' })).toBe(fresh);

    const filled = fullState();
    expect(filled.step).toBe('details');
    expect(canGoToStep(filled, 'details')).toBe(true);
    expect(reduce(filled, { type: 'goToStep', step: 'service' }).step).toBe('service');
  });

  it('holds the marketing opt-in and the notes, which only it can', () => {
    // Both were unreachable before: `setConsent` wrote `consentTerms` and
    // nothing wrote `notes` at all, so the step that renders a marketing
    // checkbox and «Noe vi bør vite?» would have had to keep its own state
    // beside the machine — the exact split this file exists to prevent.
    let state = reduce(initialState(), { type: 'setConsent', which: 'marketing', accepted: true });
    expect(state.consentMarketing).toBe(true);
    // Marketing is not terms. Confusing them would let a newsletter tick unlock
    // submit, which is the one crossing that actually matters here.
    expect(state.consentTerms).toBe(false);

    state = reduce(state, { type: 'setConsent', which: 'terms', accepted: true });
    expect(state.consentTerms).toBe(true);
    expect(state.consentMarketing).toBe(true);

    state = reduce(state, { type: 'setNotes', value: 'Redd for klippemaskin' });
    expect(state.notes).toBe('Redd for klippemaskin');
  });

  it('reads the summary bar off the state, so the bar can never disagree with it', () => {
    const state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    // Four parts from the first tap onwards, so the bar keeps its shape as the
    // visitor fills it in rather than growing under their thumb. The price is
    // the one that is never a dash: the moment there is a service there is a
    // number, and it is the same `totalPriceOre` step 4's button quotes.
    //
    // The space in «490 kr» is the non-breaking one `formatPrice` writes, and
    // it is load-bearing: an ordinary space lets a narrow phone wrap the amount
    // away from its unit at the very bottom of the screen.
    expect(summaryLine(state, stylistName)).toBe('Gutteklipp · Første ledige · Velg tid · 490 kr');
  });

  it('will not submit until phone and consent are given', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: null });
    state = reduce(state, { type: 'pickSlot', startTs: 1, resourceId: 'res-1' });
    // `pickSlot` lands on `details`: what this is about is its own two
    // requirements.
    expect(state.step).toBe('details');
    expect(canAdvance(state)).toBe(false);
    state = reduce(state, { type: 'setContact', field: 'phone', value: '40000000' });
    expect(canAdvance(state)).toBe(false);
    state = reduce(state, { type: 'setConsent', which: 'terms', accepted: true });
    expect(canAdvance(state)).toBe(true);
    // Appended to the plan's test, which passes unchanged against a `canAdvance`
    // that has dropped the phone requirement altogether: consent is the last
    // thing it sets, so consent alone accounts for every expectation above.
    // Blanking the number is what proves the number is required — and a number
    // of pure whitespace is what proves it is trimmed before it is believed.
    state = reduce(state, { type: 'setContact', field: 'phone', value: '   ' });
    expect(canAdvance(state)).toBe(false);
  });

  // Not in the plan's list. The plan pins only the *unchosen* half of the time
  // part (`—`), which leaves what a chosen time looks like to the implementer —
  // and unasserted behaviour is how a summary bar drifts from the slot the
  // visitor actually tapped. 13:00Z is 15:00 in Oslo, so this also pins the
  // clock to the salon's rather than the viewer's or the CI runner's.
  //
  // «i dag» rather than a bare «15:00»: the bar is read after a minute of
  // scrolling, often having tapped between two days on step 3, and the hour on
  // its own is the one part of the summary a visitor can misread in silence.
  it('swaps the dashes for the stylist and the chosen day, on the salon clock', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-1' });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });
    expect(summaryLine(state, stylistName, NOW)).toBe('Gutteklipp · Sara · i dag 15:00 · 490 kr');
  });

  /**
   * «Første ledige» is a null *preference*, and the bar has nobody to name until
   * the slot resolves it — which is exactly when it does. Nothing else in this
   * file fails if the stylist part reads `state.resourceId` alone, which would
   * leave the common path dashed all the way to the confirmation screen.
   *
   * The Saturday is doing a second job: it is the only assertion here that
   * fails if the price part stops reading `startTs`, since 490 kr is what an
   * unsurcharged bar quotes on every other day of the week.
   */
  it('names the stylist the slot resolved to, and prices the day it fell on', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: null });
    expect(summaryLine(state, stylistName, NOW)).toBe(
      'Gutteklipp · Første ledige · Velg tid · 490 kr'
    );

    state = reduce(state, { type: 'pickSlot', startTs: SATURDAY_15, resourceId: 'res-2' });
    expect(summaryLine(state, stylistName, NOW)).toBe('Gutteklipp · Nadia · lørdag 15:00 · 539 kr');
  });

  /** An id the catalogue cannot name is a dash, not `res-9` under the visitor's
   * thumb: the machine holds ids that outlive a reload of the stylist list. */
  it('leaves the stylist part unfilled when the catalogue cannot name the id', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-9' });
    expect(summaryLine(state, stylistName, NOW)).toBe('Gutteklipp · — · Velg tid · 490 kr');
  });

  /**
   * The two fields `WizardItem` declared and nothing could write.
   *
   * Step 4 held them in a `useState` of its own before this, which left the
   * confirmation card — whose `items` prop exists precisely to carry
   * «Gutteklipp for Jonas» — with no way to learn the name the parent had just
   * typed into the form one screen earlier.
   */
  it('writes the child’s answers onto the line item they belong to', () => {
    let state = fullState();
    state = reduce(state, {
      type: 'setItemField',
      index: 1,
      field: 'bookedForName',
      value: ' Emma ',
    });
    state = reduce(state, {
      type: 'setItemField',
      index: 1,
      field: 'bookedForBirthYear',
      value: 2017,
    });

    expect(state.items[1].bookedForName).toBe('Emma');
    expect(state.items[1].bookedForBirthYear).toBe(2017);
    // By index and not by service: all three children in `fullState` chose the
    // same Gutteklipp, so a write that matched on the service would put Emma's
    // name on her brothers' bookings too.
    expect(state.items[0]).toEqual({ service: GUTTEKLIPP });
    expect(state.items[2]).toEqual({ service: GUTTEKLIPP });
  });

  /**
   * Absent, never blank — the same rule `types.ts` states for the submission,
   * enforced where the value is first stored rather than where it is last read.
   *
   * `toEqual` alone cannot see the difference: it ignores keys whose value is
   * `undefined`, so a machine that stored `bookedForName: ''` would fail the
   * equality but one that stored `bookedForName: undefined` would pass it while
   * still serialising the key. The `in` checks are the ones that mean it.
   */
  it('drops the key rather than storing an empty answer', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForName',
      value: 'Jonas',
    });
    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForBirthYear',
      value: 2017,
    });
    expect(state.items[0]).toEqual({
      service: GUTTEKLIPP,
      bookedForName: 'Jonas',
      bookedForBirthYear: 2017,
    });

    // Whitespace is what «Hvem skal klippes?» holds after a parent taps into it
    // and back out; `null` is what an emptied year field serialises to; `NaN` is
    // what parsing «tjue» out of one yields. The engine refuses all three.
    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForName',
      value: '   ',
    });
    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForBirthYear',
      value: null,
    });
    expect('bookedForName' in state.items[0]).toBe(false);
    expect('bookedForBirthYear' in state.items[0]).toBe(false);

    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForBirthYear',
      value: Number.NaN,
    });
    expect('bookedForBirthYear' in state.items[0]).toBe(false);
  });

  /** An index that names no line item is the caller's bug, and gets the answer a
   * refused `goToStep` gets: the identical object, so React re-renders nothing
   * and no phantom fourth child is conjured into a party of three. */
  it('ignores a write aimed at a line item that does not exist', () => {
    const state = fullState();
    const missed = reduce(state, {
      type: 'setItemField',
      index: 7,
      field: 'bookedForName',
      value: 'Ingen',
    });
    expect(missed).toBe(state);
    expect(missed.items).toHaveLength(3);
  });
});

/**
 * J2 — «the killer feature», and the one journey where the wizard has to decide
 * something the engine cannot: two children are two bookings, and everything
 * below is about them staying one visit.
 */
/**
 * The gap between two children on one chair, which is not the first cut's
 * length.
 *
 * Availability is asked per service and each opening is judged on its own, so
 * two instants half an hour apart both come back free even when the salon
 * reserves cleanup after the first and prep before the second. Seating the
 * second child by duration alone puts them inside that reserved time — the
 * engine refuses the combined submission, and the family is offered the same
 * impossible visit every time they look.
 */
describe('seating a family around the salon’s buffers', () => {
  const CUT: WizardService = {
    ...GUTTEKLIPP,
    durationMinutes: 30,
    bufferAfterMinutes: 10,
  };
  const COLOUR: WizardService = {
    ...GUTTEKLIPP,
    id: 'svc-colour',
    durationMinutes: 45,
    bufferBeforeMinutes: 5,
  };
  const MINUTE = 60_000;

  it('measures how much earlier the FAMILY has to start than one child would', () => {
    // The schedule endpoint answers for one service, so its cutoff is «the last
    // start a CUT fits». The family's own last start is earlier by the part of
    // the chain hanging off the end of that first child's busy span: the second
    // child's prep, duration and cleanup.
    expect(visitTailMinutes([{ service: CUT }, { service: COLOUR }], 'sequential')).toBe(
      5 + 45 + 0
    );
  });

  it('does not substitute the first child’s cleanup for the last one’s', () => {
    // `visitMinutes - firstDuration` was the first attempt. `visitMinutes`
    // deliberately excludes the LAST child's cleanup, so that subtraction keeps
    // the first child's in its place — and where the later service has the
    // bigger cleanup the cutoff comes out too late, saying «Fullt» about an
    // afternoon that is over.
    const messy: WizardService = { ...GUTTEKLIPP, durationMinutes: 20, bufferAfterMinutes: 30 };
    const tail = visitTailMinutes([{ service: CUT }, { service: messy }], 'sequential');

    expect(tail).toBe(0 + 20 + 30);
    // The number the naive subtraction would have produced, kept here so the
    // difference is the assertion rather than a coincidence.
    const naive = visitMinutes([{ service: CUT }, { service: messy }], 'sequential') - 30;
    expect(tail).toBeGreaterThan(naive);
  });

  it('takes the longest chair for a parallel visit, not the sum', () => {
    expect(visitTailMinutes([{ service: CUT }, { service: COLOUR }], 'parallel')).toBe(
      5 + 45 + 0 - (0 + 30 + 10)
    );
  });

  it('is nothing at all for one child', () => {
    expect(visitTailMinutes([{ service: CUT }], 'sequential')).toBe(0);
  });

  it('seats the next child after the cleanup AND the prep, not just the cut', () => {
    const starts = itemStartTimes(
      [{ service: CUT }, { service: COLOUR }],
      THURSDAY_15,
      'sequential'
    );

    // 30 for the cut, 10 to clear the chair, 5 to prepare it again.
    expect(starts).toEqual([THURSDAY_15, THURSDAY_15 + 45 * MINUTE]);
  });

  it('counts those minutes in how long the family is here', () => {
    // The visit runs from the first cut starting to the last one ending, and
    // the second child cannot sit down until the chair is ready.
    expect(visitMinutes([{ service: CUT }, { service: COLOUR }], 'sequential')).toBe(90);
  });

  it('does not charge the family for the buffer after the last child', () => {
    // They have left by then. A single booking is its own duration, whatever
    // the salon does with the chair afterwards.
    expect(visitMinutes([{ service: CUT }], 'sequential')).toBe(30);
  });

  it('leaves a parallel visit alone, because those are two different chairs', () => {
    const starts = itemStartTimes([{ service: CUT }, { service: COLOUR }], THURSDAY_15, 'parallel');

    expect(starts).toEqual([THURSDAY_15, THURSDAY_15]);
    expect(visitMinutes([{ service: CUT }, { service: COLOUR }], 'parallel')).toBe(45);
  });

  it('is unchanged for a salon that keeps no buffers', () => {
    const bare = { ...GUTTEKLIPP, durationMinutes: 30 };
    const starts = itemStartTimes(
      [{ service: bare }, { service: bare }],
      THURSDAY_15,
      'sequential'
    );

    expect(starts).toEqual([THURSDAY_15, THURSDAY_15 + 30 * MINUTE]);
  });
});

describe('wizard machine — a family in one visit', () => {
  /** Jonas and Emma, the report's own party. */
  function family(): WizardState {
    const one = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    return reduce(one, { type: 'addService', service: JENTEKLIPP });
  }

  it('offers the party mode picker only once a second child is added', () => {
    const one = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    expect(showsPartyMode(one)).toBe(false);

    const two = reduce(one, { type: 'addService', service: JENTEKLIPP });
    expect(showsPartyMode(two)).toBe(true);
    // «Samme frisør, rett etter hverandre» is the report's default, and it is
    // the default from the start rather than from the moment the picker appears
    // — a party whose mode was undefined until step 2 would have nothing for
    // the step-1 summary bar to quote a duration from.
    expect(two.partyMode).toBe('sequential');
  });

  it('sums the party into the summary bar', () => {
    const state = family();
    // The space in «980 kr» is the non-breaking one `formatPrice` writes, as
    // everywhere else in this file.
    expect(summaryLine(state, stylistName)).toContain('2 tjenester · 60 min totalt · 980\u00a0kr');
  });

  /**
   * Three parts, and deliberately not five: a family bar drops the stylist and
   * the hour rather than dashing them.
   *
   * `toContain` above cannot see the difference — a bar that appended « · — · —»
   * would still contain the report's sentence — and the difference is the whole
   * decision. A parallel party has two stylists and no single one to name, so
   * that part could only ever be a dash nothing would ever fill in.
   */
  it('leaves the stylist and the hour off a family bar, even once both are chosen', () => {
    let state = reduce(family(), { type: 'pickResource', resourceId: 'res-1' });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });

    expect(summaryLine(state, stylistName, NOW)).toBe('2 tjenester · 60 min totalt · 980\u00a0kr');
    // One child keeps all four, which is what makes this a party rule rather
    // than the bar quietly losing two parts for everybody.
    const alone = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    expect(summaryLine(alone, stylistName, NOW)).toBe(
      'Gutteklipp · Første ledige · Velg tid · 490\u00a0kr'
    );
  });

  /**
   * The surcharge still arrives, on the whole party. `totalPriceOre` reads
   * `startTs`, so a family that picks the Saturday pays 10 % more each — which
   * is 1 078 kr, not two prices that happen to add up to the list total.
   */
  it('prices the family for the day it falls on', () => {
    const saturday = reduce(family(), { type: 'pickSlot', startTs: SATURDAY_15, resourceId: null });
    expect(summaryLine(saturday, stylistName, NOW)).toBe(
      '2 tjenester · 60 min totalt · 1\u00a0078\u00a0kr'
    );
  });

  /**
   * What ONE line costs, which is the number the confirmation card prints
   * against each child — and `totalPriceOre` is the sum of exactly this, so the
   * card's lines add up to its total by construction rather than by review.
   *
   * The percentage belongs to the SERVICE: Medal carries
   * `weekend_surcharge_pct` per row, so a basket holding two different ones
   * pays each child's own. A single percentage applied to the basket total
   * would charge the second child here at the first one's rate.
   */
  it('charges each service its own weekend percentage, and totals those same lines', () => {
    const UTEN_TILLEGG: WizardService = {
      ...JENTEKLIPP,
      id: 'svc-2d',
      name: 'Lugg',
      weekendSurchargePct: 0,
    };

    expect(itemPriceOre(GUTTEKLIPP, SATURDAY_15)).toBe(53_900); // 490 kr + 10 %
    expect(itemPriceOre(UTEN_TILLEGG, SATURDAY_15)).toBe(49_000); // no surcharge configured
    // A weekday charges neither, and a basket with no slot chosen yet is the
    // base price rather than a guess at a surcharge.
    expect(itemPriceOre(GUTTEKLIPP, THURSDAY_15)).toBe(49_000);
    expect(itemPriceOre(GUTTEKLIPP, null)).toBe(49_000);

    const mixed = [{ service: GUTTEKLIPP }, { service: UTEN_TILLEGG }];
    expect(totalPriceOre(mixed, SATURDAY_15)).toBe(53_900 + 49_000);
  });

  /**
   * The two modes are two different visits. Quoting the sum for a parallel
   * party would tell a parent to set aside an hour for something that takes
   * half of one — which is the entire reason «To frisører samtidig» is worth
   * offering at all.
   */
  it('measures a parallel visit by its longest cut, not by its first and not by the sum', () => {
    const mixed = [{ service: GUTTEKLIPP }, { service: BARNEKLIPP_MED_VASK }];
    expect(visitMinutes(mixed, 'sequential')).toBe(75);
    // 45, not 30: the family leaves when the LONGEST cut finishes, so reading
    // the first line's duration would send them home while a child was still
    // in the chair.
    expect(visitMinutes(mixed, 'parallel')).toBe(45);
    // The .ics spans the same minutes it says it does — one function, so a
    // calendar entry cannot end before the visit the bar promised.
    expect(visitEndTs(mixed, THURSDAY_15, 'parallel')).toBe(THURSDAY_15 + 45 * 60_000);
  });

  it('says the shorter total in the bar once the family chooses two chairs', () => {
    const parallel = reduce(family(), { type: 'setPartyMode', mode: 'parallel' });
    // 30, not 60 — and the price does not move, because two chairs is two
    // haircuts either way.
    expect(summaryLine(parallel, stylistName, NOW)).toBe(
      '2 tjenester · 30 min totalt · 980\u00a0kr'
    );
  });

  /**
   * «To frisører samtidig» and «jeg vil til Sara» cannot both be true. Leaving
   * the preference in place would filter the availability query down to one
   * stylist and then ask it for two, so every slot the search could find would
   * be with somebody the visitor did not pick — and step 2 would still be
   * showing Sara as selected.
   */
  it('drops a named stylist when the family asks for two of them', () => {
    let state = reduce(family(), { type: 'pickResource', resourceId: 'res-1' });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });

    const parallel = reduce(state, { type: 'setPartyMode', mode: 'parallel' });
    expect(parallel.resourceId).toBeNull();
    // And the slot goes with it: an hour found «rett etter hverandre» seats the
    // second child half an hour after the first, which is not what the visitor
    // has just asked for.
    expect(parallel.startTs).toBeNull();
    expect(parallel.resolvedResourceId).toBeNull();
    expect(canGoToStep(parallel, 'details')).toBe(false);

    // Going back the other way keeps the mode a choice rather than a trapdoor,
    // and leaves the basket alone.
    const back = reduce(parallel, { type: 'setPartyMode', mode: 'sequential' });
    expect(back.partyMode).toBe('sequential');
    expect(back.items).toHaveLength(2);
  });

  /**
   * A sequential party is one stylist twice over, and the state has to say so
   * in both places: `itemResourceIds` for the submission, `resolvedResourceId`
   * for the one name on the summary bar and the confirmation card.
   */
  it('seats a sequential party with one stylist and names them for the whole visit', () => {
    const seated = reduce(family(), {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-1', 'res-1'],
      mode: 'sequential',
    });

    expect(seated.step).toBe('details');
    expect(seated.startTs).toBe(THURSDAY_15);
    expect(itemResourceIds(seated)).toEqual(['res-1', 'res-1']);
    expect(seated.resolvedResourceId).toBe('res-1');
  });

  /**
   * The parallel case, and the one `pickSlot` could never carry: two children
   * seen at the same minute are seen by two different people, so there is no
   * single id that describes the visit.
   *
   * `resolvedResourceId` staying null is the load-bearing half. Naming either
   * stylist as *the* one would put «hos Marcus» against Emma's line on the
   * confirmation card, and Emma is with Sara.
   */
  it('seats a parallel party with a stylist each, and names neither for the visit', () => {
    const seated = reduce(family(), {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-2', 'res-1'],
      mode: 'parallel',
    });

    expect(itemResourceIds(seated)).toEqual(['res-2', 'res-1']);
    expect(seated.resolvedResourceId).toBeNull();
  });

  /**
   * Step 3's rescue, taken up: «men begge kan tas samtidig kl. 15:00» appears
   * while the machine still says `sequential`, and the slot behind it seats
   * both children at the same minute.
   *
   * So the mode travels with the slot. Without it the submission would put Emma
   * half an hour after Jonas — with a stylist who was free at the hour itself,
   * and is not free half an hour later — and the confirmation card would read
   * back «15:30 Emma» for a booking the salon made at 15:00.
   */
  it('switches the mode when the parent accepts the simultaneous alternative', () => {
    const state = family();
    expect(state.partyMode).toBe('sequential');

    const accepted = reduce(state, {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-2', 'res-1'],
      mode: 'parallel',
    });

    expect(accepted.partyMode).toBe('parallel');
    // Which is what makes the seating right: both children at the hour itself,
    // read off the same `itemStartTimes` step 4 submits with.
    expect(itemStartTimes(accepted.items, THURSDAY_15, accepted.partyMode)).toEqual([
      THURSDAY_15,
      THURSDAY_15,
    ]);
  });

  /**
   * A seating chart that names a different number of children than the basket
   * holds is the caller's bug, and gets the answer a refused `goToStep` gets:
   * the identical object. Booking on it would submit a stylist for a child who
   * is not coming, or none at all for one who is.
   */
  it('refuses a seating chart that does not fit the family', () => {
    const state = family();
    const mismatched = reduce(state, {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-1'],
      mode: 'sequential',
    });

    expect(mismatched).toBe(state);
    expect(mismatched.startTs).toBeNull();
  });

  /**
   * A chart outlives neither the basket it was drawn for nor the slot it came
   * with. Left behind, `itemResourceIds` would hand the submission a stylist
   * for a line item that no longer exists.
   */
  it('tears up the seating chart when the family or the slot changes', () => {
    const seated = reduce(family(), {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-1', 'res-2'],
      mode: 'sequential',
    });

    const third = reduce(seated, { type: 'addService', service: JENTEKLIPP });
    expect(third.partyResourceIds).toBeNull();
    expect(itemResourceIds(third)).toEqual([null, null, null]);

    const stolen = reduce(seated, { type: 'slotTaken' });
    expect(stolen.partyResourceIds).toBeNull();
    expect(stolen.step).toBe('when');
  });

  /**
   * Pre-release review: a regular slot after a party slot replaces it whole.
   * The seating chart was the other half of THAT slot; left behind, the
   * details step and the submission would still seat each child with the
   * stylists of a time the visitor has just changed.
   */
  it('drops the seating chart when a regular slot replaces a party slot', () => {
    const seated = reduce(family(), {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-1', 'res-2'],
      mode: 'sequential',
    });
    expect(itemResourceIds(seated)).toEqual(['res-1', 'res-2']);

    const later = THURSDAY_15 + 60 * 60_000;
    const regular = reduce(seated, { type: 'pickSlot', startTs: later, resourceId: 'res-3' });

    expect(regular.partyResourceIds).toBeNull();
    expect(regular.startTs).toBe(later);
    expect(regular.resolvedResourceId).toBe('res-3');
    expect(regular.step).toBe('details');
    // What the submission and the confirmation card read: the new slot's stylist.
    expect(itemResourceIds(regular)).toEqual(['res-3', 'res-3']);

    // «Første ledige» on the new slot: nobody from the old chart survives.
    const open = reduce(seated, { type: 'pickSlot', startTs: later, resourceId: null });
    expect(itemResourceIds(open)).toEqual([null, null]);
  });

  /**
   * Second review: a family seated side by side cannot take a one-stylist
   * slot — it would put both children with one stylist at the same minute.
   * The wizard never sends it (a party's time step offers party slots only);
   * a headless caller gets the identical object back. A back-to-back family
   * can: one stylist, one child after the other, is what that mode means.
   */
  it('refuses a one-stylist slot for a family seated side by side', () => {
    const parallel = reduce(family(), { type: 'setPartyMode', mode: 'parallel' });
    const seated = reduce(parallel, {
      type: 'pickPartySlot',
      startTs: THURSDAY_15,
      resourceIds: ['res-1', 'res-2'],
      mode: 'parallel',
    });

    expect(reduce(parallel, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' })).toBe(
      parallel
    );
    expect(reduce(seated, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' })).toBe(
      seated
    );
    expect(itemResourceIds(seated)).toEqual(['res-1', 'res-2']);

    const sequential = reduce(family(), {
      type: 'pickSlot',
      startTs: THURSDAY_15,
      resourceId: 'res-1',
    });
    expect(sequential.partyMode).toBe('sequential');
    expect(itemResourceIds(sequential)).toEqual(['res-1', 'res-1']);
  });

  /**
   * `itemResourceIds` is the single reader, so the ordinary single booking has
   * to come out of it too — one answer per line, «Første ledige» included.
   */
  it('answers for a booking that never became a party', () => {
    let alone = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    expect(itemResourceIds(alone)).toEqual([null]);

    alone = reduce(alone, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });
    expect(itemResourceIds(alone)).toEqual(['res-1']);
  });
});

/**
 * «Bestill igjen» — a link from `/min-side` that names a service, a stylist and
 * a child, so the parent only has to pick a time.
 *
 * Every rule below is a rule about a URL the site did not write: the card that
 * built the link may be a year old, the stylist may have left, the service may
 * have been renamed under a new id. Nothing in it is trusted further than the
 * catalogue the wizard would have let the visitor tap anyway.
 */
describe('applyPrefill', () => {
  /** Two stylists, by what they can do: Sara covers the kids' menu, Marcus only
   * one half of it — which is what makes «Marcus for a Gutteklipp» a link the
   * wizard has to refuse rather than a stylist it has to hide on step 3. */
  const SARA = { id: 'res-sara', serviceIds: [GUTTEKLIPP.id, JENTEKLIPP.id] };
  const MARCUS = { id: 'res-marcus', serviceIds: [JENTEKLIPP.id] };
  const CATALOGUE: WizardCatalogue = {
    services: [GUTTEKLIPP, JENTEKLIPP, DAMEKLIPP],
    resources: [SARA, MARCUS],
  };

  it('puts a known service in the basket and stops on step 2, where a question is still open', () => {
    const state = applyPrefill(initialState(), { serviceId: GUTTEKLIPP.id }, CATALOGUE);

    expect(state.items).toEqual([{ service: GUTTEKLIPP }]);
    expect(state.resourceId).toBeNull();
    expect(state.step).toBe('when');
  });

  it('keeps the visitor on the when step when the stylist is known and can do the service', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: SARA.id },
      CATALOGUE
    );

    expect(state.items).toEqual([{ service: GUTTEKLIPP }]);
    expect(state.resourceId).toBe(SARA.id);
    expect(state.step).toBe('when');
    expect(state.startTs).toBeNull();
  });

  it('ignores a service the catalogue does not have, and returns the very same state', () => {
    const before = initialState();
    const state = applyPrefill(
      before,
      { serviceId: 'svc-gone', resourceId: SARA.id, who: 'Jonas' },
      CATALOGUE
    );

    expect(state).toBe(before);
    expect(state).toEqual(initialState());
  });

  it('ignores a stylist who cannot do the service, and leaves step 2 open', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: MARCUS.id },
      CATALOGUE
    );

    expect(state.items).toEqual([{ service: GUTTEKLIPP }]);
    expect(state.resourceId).toBeNull();
    expect(state.step).toBe('when');
  });

  it('ignores a stylist the catalogue does not have', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: 'res-gone' },
      CATALOGUE
    );

    expect(state.resourceId).toBeNull();
    expect(state.step).toBe('when');
  });

  it('writes the child’s name onto the line, trimmed and cut to the engine’s bound', () => {
    const named = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, who: '  Jonas  ' },
      CATALOGUE
    );
    expect(named.items[0].bookedForName).toBe('Jonas');

    const long = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, who: 'J'.repeat(BOOKED_FOR_NAME_MAX_LENGTH + 50) },
      CATALOGUE
    );
    expect(long.items[0].bookedForName).toHaveLength(BOOKED_FOR_NAME_MAX_LENGTH);
  });

  it('stores no name at all for a blank one, rather than an empty string the engine refuses', () => {
    const state = applyPrefill(initialState(), { serviceId: GUTTEKLIPP.id, who: '   ' }, CATALOGUE);

    expect(state.items[0]).not.toHaveProperty('bookedForName');
  });

  it('is a no-op for an empty prefill, down to the object identity', () => {
    const before = initialState();
    const snapshot = structuredClone(before);

    expect(applyPrefill(before, {}, CATALOGUE)).toBe(before);
    expect(applyPrefill(before, { serviceId: null, resourceId: null, who: null }, CATALOGUE)).toBe(
      before
    );
    expect(applyPrefill(before, { serviceId: '', resourceId: '', who: '' }, CATALOGUE)).toBe(
      before
    );
    expect(before).toEqual(snapshot);
  });

  /**
   * The stylist list is fetched FOR a service, so it cannot exist at the moment
   * the link is read — the wizard applies the link once with no stylists and
   * once more when they land. Fills only blanks, so the second pass finishes
   * what the first began and touches nothing else.
   */
  it('can be applied again once the stylists are known, and finishes the job', () => {
    const first = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: SARA.id, who: 'Jonas' },
      { services: CATALOGUE.services, resources: [] }
    );
    expect(first.step).toBe('when');
    expect(first.resourceId).toBeNull();

    const second = applyPrefill(
      first,
      { serviceId: GUTTEKLIPP.id, resourceId: SARA.id, who: 'Jonas' },
      CATALOGUE
    );
    expect(second.items).toEqual([{ service: GUTTEKLIPP, bookedForName: 'Jonas' }]);
    expect(second.resourceId).toBe(SARA.id);
    expect(second.step).toBe('when');
  });

  it('never overwrites an answer the visitor has already given', () => {
    // A basket they filled themselves stays theirs.
    const chosen = reduce(initialState(), { type: 'pickService', service: DAMEKLIPP });
    const kept = applyPrefill(chosen, { serviceId: GUTTEKLIPP.id, who: 'Jonas' }, CATALOGUE);
    expect(kept.items).toEqual([{ service: DAMEKLIPP, bookedForName: 'Jonas' }]);

    // A name they typed themselves is not replaced by the link's «who».
    const named = reduce(reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP }), {
      type: 'setItemField',
      index: 0,
      field: 'bookedForName',
      value: 'Emma',
    });
    expect(applyPrefill(named, { who: 'Jonas' }, CATALOGUE)).toBe(named);

    // A stylist and a slot they picked are not moved by a late second pass.
    const seated = fullState();
    expect(applyPrefill(seated, { resourceId: 'res-2' }, CATALOGUE)).toBe(seated);

    // «Første ledige», tapped, is an answer too — and since the stylist and the
    // hour share one screen, the only thing that says so is `stylistAnswered`.
    const firstFree = reduce(reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP }), {
      type: 'pickResource',
      resourceId: null,
    });
    const late = applyPrefill(firstFree, { resourceId: SARA.id }, CATALOGUE);
    expect(late).toBe(firstFree);
  });
});

/**
 * The marketing pages' vocabulary (`?tjeneste=&frisor=&antall=`) rides the same
 * prefill as «Bestill igjen»: named stylists are matched by id or display name,
 * and a party size pre-creates that many children on a kids' service.
 */
describe('applyPrefill from a deep link', () => {
  const SARA = { id: 'res-sara', name: 'sara (Salong Demo)', serviceIds: [GUTTEKLIPP.id] };
  const MARCUS = { id: 'res-marcus', name: 'Marcus', serviceIds: [DAMEKLIPP.id] };
  const CATALOGUE: WizardCatalogue = {
    services: [GUTTEKLIPP, JENTEKLIPP, DAMEKLIPP],
    resources: [SARA, MARCUS],
  };

  it('matches the stylist by display name, case-insensitively', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: 'SARA' },
      CATALOGUE
    );
    expect(state.resourceId).toBe(SARA.id);
    expect(state.stylistAnswered).toBe(true);
  });

  it('matches the stylist by id and by slug', () => {
    for (const resourceId of [SARA.id, 'sara']) {
      const state = applyPrefill(
        initialState(),
        { serviceId: GUTTEKLIPP.id, resourceId },
        CATALOGUE
      );
      expect(state.resourceId).toBe(SARA.id);
    }
  });

  it('ignores a stylist who cannot do the service, silently', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: 'marcus' },
      CATALOGUE
    );
    expect(state.items.map((item) => item.service.id)).toEqual([GUTTEKLIPP.id]);
    expect(state.resourceId).toBeNull();
    expect(state.error).toBeNull();
  });

  it('ignores an unknown stylist', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: 'nobody' },
      CATALOGUE
    );
    expect(state.resourceId).toBeNull();
    expect(state.step).toBe('when');
  });

  it('pre-creates the requested number of children on a kids service', () => {
    const state = applyPrefill(initialState(), { serviceId: GUTTEKLIPP.id, party: 2 }, CATALOGUE);
    expect(state.items).toHaveLength(2);
    expect(state.items.every((item) => item.service.id === GUTTEKLIPP.id)).toBe(true);
    expect(state.error).toBeNull();
  });

  it('clamps the party to the service limit, without raising an error', () => {
    const state = applyPrefill(initialState(), { serviceId: GUTTEKLIPP.id, party: 9 }, CATALOGUE);
    expect(state.items).toHaveLength(GUTTEKLIPP.maxPerBooking);
    expect(state.error).toBeNull();
  });

  it('treats a party of 1 or less as one child', () => {
    for (const party of [1, 0, -3, null]) {
      const state = applyPrefill(initialState(), { serviceId: GUTTEKLIPP.id, party }, CATALOGUE);
      expect(state.items).toHaveLength(1);
    }
  });

  it('does not multiply a grown-up service', () => {
    const state = applyPrefill(initialState(), { serviceId: DAMEKLIPP.id, party: 2 }, CATALOGUE);
    expect(state.items).toHaveLength(1);
  });

  it('combines service, stylist and party into one step-3 state', () => {
    const state = applyPrefill(
      initialState(),
      { serviceId: GUTTEKLIPP.id, resourceId: 'sara', party: 2 },
      CATALOGUE
    );
    expect(state.items).toHaveLength(2);
    expect(state.resourceId).toBe(SARA.id);
    expect(state.step).toBe('when');
  });

  it('terminates on a fractional limit instead of spinning', () => {
    const odd = { ...GUTTEKLIPP, id: 'svc-odd', maxPerBooking: 2.5 };
    const state = applyPrefill(
      initialState(),
      { serviceId: odd.id, party: 3 },
      { services: [odd], resources: [] }
    );
    expect(state.items.length).toBeGreaterThanOrEqual(1);
    expect(state.items.length).toBeLessThanOrEqual(3);
  });
});

/**
 * Three steps, not four. The login used to be a screen of its own between the
 * hour and «Bekreft»; it is an offer in a sheet now, so the tap that chooses an
 * hour is the tap that reaches the form — and nothing about who the parent is
 * can stand between them.
 */
describe('the wizard without a login step', () => {
  it('goes from the hour straight to the details', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });

    expect(state.step).toBe('details');
    expect(canGoToStep(state, 'details')).toBe(true);
  });

  it('has no step called login to jump to', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickSlot', startTs: THURSDAY_15, resourceId: 'res-1' });
    // The step is gone from the type as well as from the order; a caller still
    // naming it is refused like any other unreachable jump.
    const jumped = reduce(state, { type: 'goToStep', step: 'login' as never });

    expect(jumped).toBe(state);
  });
});

/**
 * SP10: step 1 — who is coming — and step 2 answered per person.
 */
describe('wizard machine: who, then what for each of them', () => {
  const THEO = { key: 'p:p-theo', personId: 'p-theo', name: 'Theo', birthYear: 2019 };
  const EMMA = {
    key: 'p:p-emma',
    personId: 'p-emma',
    name: 'Emma',
    birthYear: 2021,
    birthMonth: 4,
  };

  it('seats a guest chip and moves to step 2 in one tap', () => {
    const next = reduce(initialState(), {
      type: 'choosePeople',
      people: [guestChild(1), guestChild(2)],
      advance: true,
    });

    expect(next.step).toBe('service');
    expect(next.people.map((person) => person.key)).toEqual(['guest:1', 'guest:2']);
    // Nobody has a service yet, so there is no basket and step 3 is shut.
    expect(next.items).toEqual([]);
    expect(canGoToStep(next, 'service')).toBe(true);
    expect(canGoToStep(next, 'when')).toBe(false);
  });

  it('holds a ticked child without moving, so «Neste» is the parent’s', () => {
    const next = reduce(initialState(), { type: 'choosePeople', people: [THEO] });

    expect(next.step).toBe('who');
    expect(canAdvance(next)).toBe(true);
    expect(summaryLine(next, () => null)).toBe('Theo');
  });

  it('refuses more than three people', () => {
    const four = [1, 2, 3, 4].map(guestChild);
    const next = reduce(initialState(), { type: 'choosePeople', people: four });

    expect(MAX_PEOPLE).toBe(3);
    expect(next.error).toBe('maxParty');
    expect(next.people).toEqual([]);
  });

  it('is the old one-tap service card for a party of one, and books it for that child', () => {
    let state = reduce(initialState(), { type: 'choosePeople', people: [EMMA], advance: true });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: JENTEKLIPP });

    expect(state.step).toBe('when');
    expect(state.items).toEqual([
      {
        service: JENTEKLIPP,
        bookedForName: 'Emma',
        bookedForBirthYear: 2021,
        bookedForPersonId: 'p-emma',
        bookedForBirthMonth: 4,
      },
    ]);
  });

  it('builds a family’s basket only once every child has a service, in the order of step 1', () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [THEO, EMMA],
      advance: true,
    });
    state = reduce(state, { type: 'pickServiceFor', index: 1, service: JENTEKLIPP });
    expect(state.items).toEqual([]);
    expect(state.step).toBe('service');
    expect(canAdvance(state)).toBe(false);

    state = reduce(state, { type: 'pickServiceFor', index: 0, service: GUTTEKLIPP });
    expect(state.items.map((item) => [item.service.id, item.bookedForPersonId])).toEqual([
      [GUTTEKLIPP.id, 'p-theo'],
      [JENTEKLIPP.id, 'p-emma'],
    ]);
    // Still on step 2: a family presses «Neste» rather than being moved on.
    expect(state.step).toBe('service');
    expect(canAdvance(state)).toBe(true);
  });

  // Per service, not per party: one child on a one-at-a-time service is fine
  // in a family of two; the sibling taking the same one is the refusal.
  it('refuses a service more of the family would take than its limit allows', () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [THEO, EMMA],
      advance: true,
    });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: DAMEKLIPP });
    expect(state.error).toBeNull();
    expect(state.choices).toEqual([DAMEKLIPP, null]);

    state = reduce(state, { type: 'pickServiceFor', index: 1, service: DAMEKLIPP });

    expect(state.error).toBe('maxParty');
    expect(state.choices).toEqual([DAMEKLIPP, null]);
  });

  it('keeps a child’s service when a sibling is added on step 1, and drops the slot', () => {
    let state = reduce(initialState(), { type: 'choosePeople', people: [THEO], advance: true });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: GUTTEKLIPP });
    state = reduce(state, { type: 'pickResource', resourceId: 'res-sara' });
    state = reduce(state, {
      type: 'pickSlot',
      startTs: Date.UTC(2026, 8, 2, 11),
      resourceId: 'res-sara',
    });

    state = reduce(state, { type: 'choosePeople', people: [THEO, EMMA], advance: true });

    expect(state.choices).toEqual([GUTTEKLIPP, null]);
    expect(state.items).toEqual([]);
    expect(state.startTs).toBeNull();
    // Adding a sibling is not a change of mind about Sara.
    expect(state.resourceId).toBe('res-sara');
  });

  it('releases a named stylist who cannot do the service a sibling gets', () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [THEO, EMMA],
      advance: true,
    });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: GUTTEKLIPP });
    state = { ...state, resourceId: 'res-marcus', stylistAnswered: true };
    state = reduce(state, {
      type: 'pickServiceFor',
      index: 1,
      service: JENTEKLIPP,
      resourceServiceIds: [GUTTEKLIPP.id],
    });

    expect(state.resourceId).toBeNull();
    expect(state.stylistAnswered).toBe(false);
  });

  it('keeps the names «Bekreft» was told when a guest goes back and re-taps the same chip', () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [guestChild(1)],
      advance: true,
    });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: GUTTEKLIPP });
    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForName',
      value: 'Jonas',
    });

    state = reduce(state, { type: 'choosePeople', people: [guestChild(1)], advance: true });

    expect(state.people[0].name).toBe('Jonas');
    expect(state.items[0].bookedForName).toBe('Jonas');
  });

  it('attaches and detaches a saved child on a guest line (a family chip on «Bekreft»)', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForPersonId',
      value: 'p-theo',
    });
    expect(state.items[0].bookedForPersonId).toBe('p-theo');

    state = reduce(state, {
      type: 'setItemField',
      index: 0,
      field: 'bookedForPersonId',
      value: null,
    });
    expect(state.items[0]).not.toHaveProperty('bookedForPersonId');
  });

  it('gives a basket built without step 1 its people, so step 1 is answered', () => {
    let state = reduce(initialState(), { type: 'pickService', service: GUTTEKLIPP });
    state = reduce(state, { type: 'addService', service: JENTEKLIPP });

    expect(state.people.map((person) => person.key)).toEqual(['guest:1', 'guest:2']);
    expect(canGoToStep(state, 'who')).toBe(true);
    expect(canGoToStep(state, 'when')).toBe(true);
  });
});

/**
 * A family appearing over a guest's answer (review of SP10): the count chips'
 * seats are ones the parent's step 1 cannot draw, so they go — while nothing
 * is held on them.
 */
describe('wizard machine: seatFamily and addPerson', () => {
  const THEO = { key: 'p:p-theo', personId: 'p-theo', name: 'Theo', birthYear: 2019 };
  const EMMA = { key: 'p:p-emma', personId: 'p-emma', name: 'Emma', birthYear: 2021 };

  it('knows the guest seats', () => {
    expect(isGuestSeat(guestChild(2))).toBe(true);
    expect(isGuestSeat({ key: 'new:1:0', name: 'Mia' })).toBe(true);
    expect(isGuestSeat({ key: 'adult', adult: true })).toBe(true);
    expect(isGuestSeat(THEO)).toBe(false);
    expect(isGuestSeat({ key: 'self', adult: true })).toBe(false);
  });

  it('drops the guest seats on step 2 and goes back to step 1 for the children', () => {
    const chips = reduce(initialState(), {
      type: 'choosePeople',
      people: [guestChild(1), guestChild(2)],
      advance: true,
    });
    expect(chips.step).toBe('service');

    const next = reduce(chips, { type: 'seatFamily' });

    expect(next.people).toEqual([]);
    expect(next.items).toEqual([]);
    expect(next.step).toBe('who');
  });

  it('turns a guest «Voksen» into «Meg selv», keeping the service chosen', () => {
    let state = reduce(initialState(), {
      type: 'choosePeople',
      people: [{ key: 'adult', adult: true }],
      advance: true,
    });
    state = reduce(state, { type: 'pickServiceFor', index: 0, service: GUTTEKLIPP });
    state = reduce(state, { type: 'goToStep', step: 'who' });

    const next = reduce(state, { type: 'seatFamily' });

    expect(next.people).toEqual([{ key: 'self', adult: true }]);
    expect(next.choices).toEqual([GUTTEKLIPP]);
    expect(next.step).toBe('who');
  });

  it('leaves a basket with an hour alone — from step 3 on, the seats are chairs', () => {
    const state = { ...fullState(), step: 'details' as const };
    expect(reduce(state, { type: 'seatFamily' })).toBe(state);
  });

  it('is the same state when there is nothing to drop', () => {
    const state = reduce(initialState(), { type: 'choosePeople', people: [THEO] });
    expect(reduce(state, { type: 'seatFamily' })).toBe(state);
  });

  it('adds a person to the party as it is when the action lands', () => {
    let state = reduce(initialState(), { type: 'choosePeople', people: [THEO] });
    // Meanwhile — while Medal was saving Mia — the parent ticked Emma.
    state = reduce(state, { type: 'choosePeople', people: [THEO, EMMA] });
    const mia = { key: 'p:p-mia', personId: 'p-mia', name: 'Mia', birthYear: 2021 };

    const next = reduce(state, { type: 'addPerson', person: mia });

    expect(next.people.map((person) => person.key)).toEqual(['p:p-theo', 'p:p-emma', 'p:p-mia']);
    expect(reduce(next, { type: 'addPerson', person: mia })).toBe(next);
    const fourth = reduce(next, {
      type: 'addPerson',
      person: { key: 'p:p-ida', personId: 'p-ida', name: 'Ida', birthYear: 2016 },
    });
    expect(fourth.people).toHaveLength(MAX_PEOPLE);
    expect(fourth.error).toBe('maxParty');
  });

  it('starts each person seated after a held link on its service, where it suits them', () => {
    let state = reduce(initialState(), { type: 'holdService', service: GUTTEKLIPP });
    state = reduce(state, {
      type: 'choosePeople',
      people: [THEO, { key: 'self', adult: true }],
      // «Samme som sist» would say otherwise; the link wins.
      services: [null, null],
    });

    // A kids' cut for Theo; nothing for the grown-up.
    expect(state.choices).toEqual([GUTTEKLIPP, null]);
    expect(state.step).toBe('who');
  });
});
